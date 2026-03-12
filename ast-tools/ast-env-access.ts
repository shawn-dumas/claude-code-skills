import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { EnvAccessAnalysis, EnvAccessInstance, EnvAccessType } from './types';

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
 * containing "eslint-disable" or "tree-shak" (covers tree-shaking, tree-shake).
 */
function hasTreeShakingComment(node: Node, sf: SourceFile): boolean {
  const line = node.getStartLineNumber();
  const fullText = sf.getFullText();
  const lines = fullText.split('\n');

  // Check the same line and the preceding line
  for (let i = Math.max(0, line - 2); i < Math.min(lines.length, line); i++) {
    const lineText = lines[i];
    if (lineText.includes('eslint-disable') || lineText.includes('tree-shak')) {
      return true;
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
    if (moduleSpecifier.includes('env/clientEnv') || moduleSpecifier.includes('lib/env/clientEnv')) {
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
    if (moduleSpecifier.includes('env/serverEnv') || moduleSpecifier.includes('lib/env/serverEnv')) {
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

function findEnvPropertyAccesses(sf: SourceFile): EnvAccessInstance[] {
  const accesses: EnvAccessInstance[] = [];

  sf.forEachDescendant(node => {
    // --- DIRECT_PROCESS_ENV: process.env.ANYTHING ---
    if (Node.isPropertyAccessExpression(node)) {
      const text = node.getText();
      const line = node.getStartLineNumber();
      const column = sf.getLineAndColumnAtPos(node.getStart()).column;

      // Match process.env.PROPERTY (3-level property access)
      if (text.startsWith('process.env.') && text.split('.').length === 3) {
        const propertyName = text.split('.')[2];
        const isGuard = hasTreeShakingComment(node, sf);
        accesses.push({
          type: 'DIRECT_PROCESS_ENV',
          line,
          column,
          text: truncateText(text, 120),
          propertyName,
          containingFunction: getContainingFunctionName(node),
          isViolation: !isGuard,
          isTreeShakingGuard: isGuard,
        });
        return;
      }

      // Match clientEnv.PROPERTY
      const exprNode = node.getExpression();
      const propName = node.getName();
      if (Node.isIdentifier(exprNode) && exprNode.getText() === 'clientEnv') {
        accesses.push({
          type: 'CLIENT_ENV_ACCESS',
          line,
          column,
          text: truncateText(text, 120),
          propertyName: propName,
          containingFunction: getContainingFunctionName(node),
          isViolation: false,
          isTreeShakingGuard: false,
        });
        return;
      }

      // Match serverEnv.PROPERTY
      if (Node.isIdentifier(exprNode) && exprNode.getText() === 'serverEnv') {
        accesses.push({
          type: 'SERVER_ENV_ACCESS',
          line,
          column,
          text: truncateText(text, 120),
          propertyName: propName,
          containingFunction: getContainingFunctionName(node),
          isViolation: false,
          isTreeShakingGuard: false,
        });
        return;
      }
    }

    // --- RAW_ENV_IMPORT: const env = process.env ---
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (init && Node.isPropertyAccessExpression(init)) {
        const initText = init.getText();
        if (initText === 'process.env') {
          const line = node.getStartLineNumber();
          const column = sf.getLineAndColumnAtPos(node.getStart()).column;
          accesses.push({
            type: 'RAW_ENV_IMPORT',
            line,
            column,
            text: truncateText(node.getText(), 120),
            propertyName: null,
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
            isTreeShakingGuard: false,
          });
        }
      }
    }
  });

  return accesses;
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

  const summary = computeSummary(accesses);
  const violationCount = accesses.filter(a => a.isViolation).length;
  const compliantCount = accesses.filter(a => !a.isViolation).length;

  return {
    filePath: relativePath,
    accesses,
    summary,
    violationCount,
    compliantCount,
  };
}

function analyzeEnvAccessDirectory(dirPath: string): EnvAccessAnalysis[] {
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
