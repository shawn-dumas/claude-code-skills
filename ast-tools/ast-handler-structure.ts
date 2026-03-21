/**
 * ast-handler-structure: detect API handlers with inline logic and multi-method handling.
 *
 * Scans Next.js API handler files and emits:
 * - HANDLER_INLINE_LOGIC: handler body exceeds the inline logic threshold
 *   without delegating to a .logic.ts file
 * - HANDLER_MULTI_METHOD: handler serves 2+ distinct HTTP methods
 */

import path from 'path';
import fs from 'fs';
import { Node } from 'ts-morph';
import type { SourceFile } from 'ts-morph';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { FileFilter } from './shared';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import type { HandlerStructureObservation, HandlerStructureAnalysis, ObservationResult } from './types';

// ---------------------------------------------------------------------------
// Logic file detection
// ---------------------------------------------------------------------------

/**
 * Check imports for a .logic.ts delegation target.
 * Returns the import source string if found, null otherwise.
 */
function findLogicDelegation(sf: SourceFile): string | null {
  for (const imp of sf.getImportDeclarations()) {
    const source = imp.getModuleSpecifierValue();
    if (source.endsWith('.logic') || source.includes('.logic/')) {
      return source;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler function detection
// ---------------------------------------------------------------------------

/**
 * Find the main handler function in an API route file.
 *
 * Looks for:
 * 1. A named function 'handler' (the convention in this codebase)
 * 2. The function wrapped in the default export middleware chain
 */
function findHandlerFunction(sf: SourceFile): Node | null {
  // Look for `async function handler(` or `function handler(`
  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (name === 'handler') return func;
  }

  // Look for `const handler = async (` or `const handler = (`
  for (const stmt of sf.getVariableStatements()) {
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      if (decl.getName() === 'handler') {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          return init;
        }
      }
    }
  }

  // Fallback: look for the default export and trace back to the function
  const defaultExport = sf.getDefaultExportSymbol();
  if (!defaultExport) return null;

  // Check for `export default function handler(`
  for (const func of sf.getFunctions()) {
    if (func.isDefaultExport()) return func;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Line counting
// ---------------------------------------------------------------------------

/**
 * Count non-trivial lines in the handler body.
 * Excludes: blank lines, comment-only lines, and (if delegation exists)
 * the delegation call line itself.
 */
function countNonTrivialLines(bodyText: string, delegatesTo: string | null): number {
  const lines = bodyText.split('\n');
  let count = 0;
  let inBlockComment = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Track block comments
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    if (line.startsWith('/*')) {
      if (!line.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }

    // Skip blank lines
    if (line === '') continue;

    // Skip single-line comments
    if (line.startsWith('//')) continue;

    // Skip import statements (should not appear in function body, but be safe)
    if (line.startsWith('import ')) continue;

    // Skip the opening/closing braces of the function body
    if (line === '{' || line === '}') continue;

    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// HTTP method detection
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/**
 * Search for HTTP method handling patterns in the handler body.
 * Detects:
 * - req.method === 'GET' / request.method === 'POST'
 * - case 'GET': (switch statements)
 * - method === 'GET' (variable comparison)
 */
function findHttpMethods(sf: SourceFile): string[] {
  const methods = new Set<string>();
  const text = sf.getFullText();

  for (const method of HTTP_METHODS) {
    // Pattern: req.method === 'METHOD' or request.method === 'METHOD'
    // Also handles !== for exclusion patterns, but we still detect the method
    const patterns = [
      `req.method === '${method}'`,
      `req.method === "${method}"`,
      `request.method === '${method}'`,
      `request.method === "${method}"`,
      `method === '${method}'`,
      `method === "${method}"`,
      `case '${method}'`,
      `case "${method}"`,
    ];

    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        methods.add(method);
        break;
      }
    }
  }

  // Also check withMethod(['GET', 'POST', ...]) pattern
  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== 'withMethod') return;

    const args = node.getArguments();
    if (args.length === 0) return;

    const firstArg = args[0];
    if (!Node.isArrayLiteralExpression(firstArg)) return;

    for (const elem of firstArg.getElements()) {
      if (Node.isStringLiteral(elem)) {
        const val = elem.getLiteralValue();
        if ((HTTP_METHODS as readonly string[]).includes(val)) {
          methods.add(val);
        }
      }
    }
  });

  return [...methods].sort();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeHandlerStructure(filePath: string): HandlerStructureAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const observations: HandlerStructureObservation[] = [];

  const threshold = astConfig.handlerStructure.inlineLogicThreshold;

  // Check for .logic.ts delegation
  const delegatesTo = findLogicDelegation(sf);

  // Find the handler function
  const handlerNode = findHandlerFunction(sf);

  if (handlerNode) {
    // Get the handler body text
    let bodyText: string;
    if (Node.isFunctionDeclaration(handlerNode)) {
      const body = handlerNode.getBody();
      bodyText = body ? body.getText() : '';
    } else if (Node.isArrowFunction(handlerNode)) {
      bodyText = handlerNode.getBody().getText();
    } else if (Node.isFunctionExpression(handlerNode)) {
      bodyText = handlerNode.getBody().getText();
    } else {
      bodyText = '';
    }

    const handlerLines = countNonTrivialLines(bodyText, delegatesTo);

    if (handlerLines > threshold) {
      const handlerLine = handlerNode.getStartLineNumber();
      observations.push({
        kind: 'HANDLER_INLINE_LOGIC' as const,
        file: relativePath,
        line: handlerLine,
        evidence: {
          handlerLines,
          delegatesTo,
          threshold,
        },
      });
    }
  }

  // Check for multi-method handling
  const methods = findHttpMethods(sf);

  // withMethod(['POST']) counts as 1 method from the middleware.
  // We only emit HANDLER_MULTI_METHOD when the handler itself routes
  // between 2+ methods (not when middleware restricts to one method).
  // Filter: if all methods come from withMethod, check if handler body
  // also switches on req.method.
  const bodyMethods = findBodyMethodReferences(sf);
  if (bodyMethods.length >= 2) {
    const handlerLine = handlerNode ? handlerNode.getStartLineNumber() : 1;
    observations.push({
      kind: 'HANDLER_MULTI_METHOD' as const,
      file: relativePath,
      line: handlerLine,
      evidence: {
        methods: bodyMethods,
      },
    });
  }

  return {
    filePath: relativePath,
    observations,
  };
}

/**
 * Find HTTP method references specifically in the handler body
 * (not from withMethod middleware).
 */
function findBodyMethodReferences(sf: SourceFile): string[] {
  const methods = new Set<string>();
  const text = sf.getFullText();

  for (const method of HTTP_METHODS) {
    const patterns = [
      `req.method === '${method}'`,
      `req.method === "${method}"`,
      `request.method === '${method}'`,
      `request.method === "${method}"`,
      `case '${method}'`,
      `case "${method}"`,
    ];

    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        methods.add(method);
        break;
      }
    }
  }

  return [...methods].sort();
}

export function analyzeHandlerStructureDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): HandlerStructureAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: HandlerStructureAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-handler-structure', fp, () => analyzeHandlerStructure(fp), options);
    results.push(analysis);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractHandlerStructureObservations(
  analysis: HandlerStructureAnalysis,
): ObservationResult<HandlerStructureObservation> {
  return {
    filePath: analysis.filePath,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-handler-structure.ts <path...> [--pretty] [--no-cache] [--kind <kind>] [--count]\n' +
        '\n' +
        'Detect API handlers with inline logic (no .logic.ts delegation) and multi-method handling.\n' +
        '\n' +
        '  <path...>     One or more .ts files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: HandlerStructureAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeHandlerStructureDirectory(targetPath, { noCache }));
    } else {
      const result = cached('ast-handler-structure', absolute, () => analyzeHandlerStructure(targetPath), { noCache });
      allResults.push(result);
    }
  }

  const cacheStats = getCacheStats();
  if (cacheStats.hits > 0 || cacheStats.misses > 0) {
    process.stderr.write(`Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses\n`);
  }

  const result = allResults.length === 1 ? allResults[0] : allResults;
  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-handler-structure.ts') || process.argv[1].endsWith('ast-handler-structure'));

if (isDirectRun) {
  main();
}
