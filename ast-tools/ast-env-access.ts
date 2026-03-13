import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { EnvAccessAnalysis, EnvAccessInstance, EnvAccessType, EnvObservation } from './types';
import { astConfig } from './ast-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): Record<EnvAccessType, number> {
  return {
    DIRECT_PROCESS_ENV: 0,
    CLIENT_ENV_ACCESS: 0,
    SERVER_ENV_ACCESS: 0,
    CLIENT_ENV_IMPORT: 0,
    SERVER_ENV_IMPORT: 0,
    RAW_ENV_IMPORT: 0,
  };
}

/**
 * Check whether a node has a nearby comment (same line or preceding line)
 * containing tree-shaking markers from config.
 */
function hasTreeShakingComment(node: Node, sf: SourceFile): boolean {
  const line = node.getStartLineNumber();
  const fullText = sf.getFullText();
  const lines = fullText.split('\n');

  // Check the same line and the preceding line
  for (let i = Math.max(0, line - 2); i < Math.min(lines.length, line); i++) {
    const lineText = lines[i];
    for (const marker of astConfig.env.treeShakingCommentMarkers) {
      if (lineText.includes(marker)) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Import detection
// ---------------------------------------------------------------------------

function findEnvImports(sf: SourceFile): EnvAccessInstance[] {
  const accesses: EnvAccessInstance[] = [];

  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const line = importDecl.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(importDecl.getStart()).column;
    const text = truncateText(importDecl.getText(), 120);

    // CLIENT_ENV_IMPORT: import of clientEnv from env module
    const matchesClientEnvPath = astConfig.env.clientEnvPathPatterns.some(pattern => moduleSpecifier.includes(pattern));
    if (matchesClientEnvPath) {
      const namedImports = importDecl.getNamedImports();
      const hasClientEnv = namedImports.some(ni => ni.getName() === 'clientEnv');
      if (hasClientEnv) {
        accesses.push({
          type: 'CLIENT_ENV_IMPORT',
          line,
          column,
          text,
          propertyName: null,
          containingFunction: '<module>',
          isViolation: false,
          isTreeShakingGuard: false,
        });
      }
    }

    // SERVER_ENV_IMPORT: import of serverEnv from env module
    const matchesServerEnvPath = astConfig.env.serverEnvPathPatterns.some(pattern => moduleSpecifier.includes(pattern));
    if (matchesServerEnvPath) {
      const namedImports = importDecl.getNamedImports();
      const hasServerEnv = namedImports.some(ni => ni.getName() === 'serverEnv');
      if (hasServerEnv) {
        accesses.push({
          type: 'SERVER_ENV_IMPORT',
          line,
          column,
          text,
          propertyName: null,
          containingFunction: '<module>',
          isViolation: false,
          isTreeShakingGuard: false,
        });
      }
    }
  }

  return accesses;
}

// ---------------------------------------------------------------------------
// Property access and raw env detection
// ---------------------------------------------------------------------------

/**
 * Try to classify a PropertyAccessExpression as a direct process.env access
 * (process.env.PROPERTY) and return an EnvAccessInstance, or null.
 */
function classifyDirectProcessEnv(
  node: import('ts-morph').PropertyAccessExpression,
  sf: SourceFile,
): EnvAccessInstance | null {
  const text = node.getText();
  if (!text.startsWith('process.env.') || text.split('.').length !== 3) return null;

  const propertyName = text.split('.')[2];
  const isGuard = hasTreeShakingComment(node, sf);
  return {
    type: 'DIRECT_PROCESS_ENV',
    line: node.getStartLineNumber(),
    column: sf.getLineAndColumnAtPos(node.getStart()).column,
    text: truncateText(text, 120),
    propertyName,
    containingFunction: getContainingFunctionName(node),
    isViolation: !isGuard,
    isTreeShakingGuard: isGuard,
  };
}

/**
 * Try to classify a PropertyAccessExpression as a typed env wrapper access
 * (clientEnv.PROPERTY or serverEnv.PROPERTY) and return an EnvAccessInstance, or null.
 */
function classifyEnvWrapperAccess(
  node: import('ts-morph').PropertyAccessExpression,
  sf: SourceFile,
): EnvAccessInstance | null {
  const exprNode = node.getExpression();
  if (!Node.isIdentifier(exprNode)) return null;

  const accessType = astConfig.env.wrapperIdentifiers[exprNode.getText()] as EnvAccessType | undefined;
  if (!accessType) return null;

  return {
    type: accessType,
    line: node.getStartLineNumber(),
    column: sf.getLineAndColumnAtPos(node.getStart()).column,
    text: truncateText(node.getText(), 120),
    propertyName: node.getName(),
    containingFunction: getContainingFunctionName(node),
    isViolation: false,
    isTreeShakingGuard: false,
  };
}

/**
 * Try to classify a VariableDeclaration as a raw env import
 * (const env = process.env) and return an EnvAccessInstance, or null.
 */
function classifyRawEnvImport(node: import('ts-morph').VariableDeclaration, sf: SourceFile): EnvAccessInstance | null {
  const init = node.getInitializer();
  if (!init || !Node.isPropertyAccessExpression(init) || init.getText() !== 'process.env') return null;

  return {
    type: 'RAW_ENV_IMPORT',
    line: node.getStartLineNumber(),
    column: sf.getLineAndColumnAtPos(node.getStart()).column,
    text: truncateText(node.getText(), 120),
    propertyName: null,
    containingFunction: getContainingFunctionName(node),
    isViolation: true,
    isTreeShakingGuard: false,
  };
}

function findEnvPropertyAccesses(sf: SourceFile): EnvAccessInstance[] {
  const accesses: EnvAccessInstance[] = [];

  sf.forEachDescendant(node => {
    if (Node.isPropertyAccessExpression(node)) {
      const match = classifyDirectProcessEnv(node, sf) ?? classifyEnvWrapperAccess(node, sf);
      if (match) {
        accesses.push(match);
        return;
      }
    }

    if (Node.isVariableDeclaration(node)) {
      const match = classifyRawEnvImport(node, sf);
      if (match) {
        accesses.push(match);
      }
    }
  });

  return accesses;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractEnvObservations(sf: SourceFile): EnvObservation[] {
  const observations: EnvObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());

  // Check imports for env wrapper imports
  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const line = importDecl.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(importDecl.getStart()).column;

    // Check for clientEnv or serverEnv imports
    const matchesClientEnvPath = astConfig.env.clientEnvPathPatterns.some(pattern => moduleSpecifier.includes(pattern));
    const matchesServerEnvPath = astConfig.env.serverEnvPathPatterns.some(pattern => moduleSpecifier.includes(pattern));

    if (matchesClientEnvPath || matchesServerEnvPath) {
      const namedImports = importDecl.getNamedImports();
      for (const ni of namedImports) {
        const name = ni.getName();
        if (name === 'clientEnv' || name === 'serverEnv') {
          observations.push({
            kind: 'ENV_WRAPPER_IMPORT',
            file: relativePath,
            line,
            column,
            evidence: {
              wrapperName: name,
              moduleSpecifier,
            },
          });
        }
      }
    }
  }

  // Check for property accesses and raw env imports
  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    if (Node.isPropertyAccessExpression(node)) {
      const text = node.getText();

      // Check for direct process.env access
      if (text.startsWith('process.env.') && text.split('.').length === 3) {
        const propertyName = text.split('.')[2];
        const hasGuard = hasTreeShakingComment(node, sf);
        observations.push({
          kind: 'PROCESS_ENV_ACCESS',
          file: relativePath,
          line,
          column,
          evidence: {
            propertyName,
            hasTreeShakingComment: hasGuard,
          },
        });
        return;
      }

      // Check for env wrapper access (clientEnv.FOO, serverEnv.BAR)
      const exprNode = node.getExpression();
      if (Node.isIdentifier(exprNode)) {
        const wrapperName = exprNode.getText();
        if (astConfig.env.wrapperIdentifiers[wrapperName]) {
          observations.push({
            kind: 'ENV_WRAPPER_ACCESS',
            file: relativePath,
            line,
            column,
            evidence: {
              wrapperName,
              propertyName: node.getName(),
            },
          });
          return;
        }
      }
    }

    // Check for raw env import (const env = process.env)
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (init && Node.isPropertyAccessExpression(init) && init.getText() === 'process.env') {
        observations.push({
          kind: 'RAW_ENV_IMPORT',
          file: relativePath,
          line,
          column,
          evidence: {},
        });
      }
    }
  });

  // Sort by line number
  observations.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

  return observations;
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(accesses: EnvAccessInstance[]): Record<EnvAccessType, number> {
  const summary = emptySummary();
  for (const a of accesses) {
    summary[a.type]++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeEnvAccess(filePath: string): EnvAccessAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const importAccesses = findEnvImports(sf);
  const propertyAccesses = findEnvPropertyAccesses(sf);
  const accesses = [...importAccesses, ...propertyAccesses].sort((a, b) => a.line - b.line || a.column - b.column);
  const observations = extractEnvObservations(sf);

  const summary = computeSummary(accesses);
  const violationCount = accesses.filter(a => a.isViolation).length;
  const compliantCount = accesses.filter(a => !a.isViolation).length;

  return {
    filePath: relativePath,
    accesses,
    summary,
    violationCount,
    compliantCount,
    observations,
  };
}

export function analyzeEnvAccessDirectory(dirPath: string): EnvAccessAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: EnvAccessAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeEnvAccess(fp);
    if (analysis.accesses.length > 0) {
      results.push(analysis);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-env-access.ts <path...> [--pretty]\n' +
        '\n' +
        'Inventory environment variable access patterns.\n' +
        '\n' +
        '  <path...>  One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty   Format JSON output with indentation\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const targetPath = args.paths[0];
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  if (!fs.existsSync(absolute)) {
    fatal(`Path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(absolute);

  if (stat.isDirectory()) {
    const results = analyzeEnvAccessDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeEnvAccess(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-env-access.ts') || process.argv[1].endsWith('ast-env-access'));

if (isDirectRun) {
  main();
}
