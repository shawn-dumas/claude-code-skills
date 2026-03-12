import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { StorageAccessAnalysis, StorageAccessInstance, StorageAccessType } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): Record<StorageAccessType, number> {
  return {
    DIRECT_LOCAL_STORAGE: 0,
    DIRECT_SESSION_STORAGE: 0,
    TYPED_STORAGE_READ: 0,
    TYPED_STORAGE_WRITE: 0,
    TYPED_STORAGE_REMOVE: 0,
    JSON_PARSE_UNVALIDATED: 0,
    COOKIE_ACCESS: 0,
  };
}

const VIOLATION_TYPES: ReadonlySet<StorageAccessType> = new Set([
  'DIRECT_LOCAL_STORAGE',
  'DIRECT_SESSION_STORAGE',
  'JSON_PARSE_UNVALIDATED',
]);

// ---------------------------------------------------------------------------
// JSON.parse Zod guard detection
// ---------------------------------------------------------------------------

/**
 * Check whether a JSON.parse() call expression is immediately wrapped in a
 * Zod .parse() or .safeParse() call. Patterns we recognize:
 *
 *   schema.parse(JSON.parse(...))
 *   schema.safeParse(JSON.parse(...))
 *
 * The JSON.parse CallExpression is a direct argument of a CallExpression
 * whose callee ends with .parse or .safeParse.
 */
function isJsonParseZodGuarded(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  // JSON.parse(...) is a direct argument of someSchema.parse(...) or .safeParse(...)
  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression();
    if (Node.isPropertyAccessExpression(callee)) {
      const methodName = callee.getName();
      if (methodName === 'parse' || methodName === 'safeParse') {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Storage object method patterns
// ---------------------------------------------------------------------------

const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem', 'clear']);

// ---------------------------------------------------------------------------
// Per-category classifiers
// ---------------------------------------------------------------------------

interface StorageNodeContext {
  line: number;
  column: number;
}

const DIRECT_STORAGE_TYPE_MAP: Record<string, StorageAccessType> = {
  localStorage: 'DIRECT_LOCAL_STORAGE',
  sessionStorage: 'DIRECT_SESSION_STORAGE',
};

const COOKIE_METHODS = new Set(['get', 'set', 'remove']);

/** Classify direct localStorage/sessionStorage method calls and cookie access via property access. */
function classifyStorageMethodCall(node: Node, ctx: StorageNodeContext): StorageAccessInstance | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;

  const objText = callee.getExpression().getText();
  const methodName = callee.getName();

  const directType = DIRECT_STORAGE_TYPE_MAP[objText];
  if (directType && STORAGE_METHODS.has(methodName)) {
    return {
      type: directType,
      line: ctx.line,
      column: ctx.column,
      text: truncateText(node.getText(), 80),
      containingFunction: getContainingFunctionName(node),
      isViolation: true,
    };
  }

  if (objText === 'Cookies' && COOKIE_METHODS.has(methodName)) {
    return {
      type: 'COOKIE_ACCESS',
      line: ctx.line,
      column: ctx.column,
      text: truncateText(node.getText(), 80),
      containingFunction: getContainingFunctionName(node),
      isViolation: false,
    };
  }

  return null;
}

/** Classify bare typedStorage function calls: readStorage, writeStorage, removeStorage. */
function classifyTypedStorageCall(node: Node, ctx: StorageNodeContext): StorageAccessInstance | null {
  if (!Node.isCallExpression(node)) return null;

  const calleeText = node.getExpression().getText();

  const typeMap: Record<string, StorageAccessType> = {
    readStorage: 'TYPED_STORAGE_READ',
    writeStorage: 'TYPED_STORAGE_WRITE',
    removeStorage: 'TYPED_STORAGE_REMOVE',
  };

  const type = typeMap[calleeText];
  if (!type) return null;

  return {
    type,
    line: ctx.line,
    column: ctx.column,
    text: truncateText(node.getText(), 80),
    containingFunction: getContainingFunctionName(node),
    isViolation: false,
  };
}

/** Classify JSON.parse calls that are not Zod-guarded. */
function classifyJsonParse(node: Node, ctx: StorageNodeContext): StorageAccessInstance | null {
  if (!Node.isCallExpression(node)) return null;

  const calleeText = node.getExpression().getText();
  if (calleeText !== 'JSON.parse') return null;

  if (isJsonParseZodGuarded(node)) return null;

  return {
    type: 'JSON_PARSE_UNVALIDATED',
    line: ctx.line,
    column: ctx.column,
    text: truncateText(node.getText(), 80),
    containingFunction: getContainingFunctionName(node),
    isViolation: true,
  };
}

/** Get the text for a non-standard storage property access, including the parent call if applicable. */
function getStoragePropertyText(node: Node): string {
  const parent = node.getParent();
  const isNonStandardCall = parent && Node.isCallExpression(parent) && parent.getExpression() === node;
  return truncateText(isNonStandardCall ? parent.getText() : node.getText(), 80);
}

/** Classify property access on localStorage/sessionStorage (non-method) and document.cookie. */
function classifyStoragePropertyAccess(node: Node, ctx: StorageNodeContext): StorageAccessInstance | null {
  if (!Node.isPropertyAccessExpression(node)) return null;

  const objText = node.getExpression().getText();
  const propName = node.getName();

  const directType = DIRECT_STORAGE_TYPE_MAP[objText];
  if (directType && !STORAGE_METHODS.has(propName)) {
    return {
      type: directType,
      line: ctx.line,
      column: ctx.column,
      text: getStoragePropertyText(node),
      containingFunction: getContainingFunctionName(node),
      isViolation: true,
    };
  }

  if (objText === 'document' && propName === 'cookie') {
    return {
      type: 'COOKIE_ACCESS',
      line: ctx.line,
      column: ctx.column,
      text: truncateText(node.getText(), 80),
      containingFunction: getContainingFunctionName(node),
      isViolation: false,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main analysis walker
// ---------------------------------------------------------------------------

function findAccesses(sf: SourceFile): StorageAccessInstance[] {
  const accesses: StorageAccessInstance[] = [];

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;
    const ctx: StorageNodeContext = { line, column };

    const result =
      classifyStorageMethodCall(node, ctx) ??
      classifyTypedStorageCall(node, ctx) ??
      classifyJsonParse(node, ctx) ??
      classifyStoragePropertyAccess(node, ctx);

    if (result) {
      accesses.push(result);
    }
  });

  // Sort by line number
  accesses.sort((a, b) => a.line - b.line || a.column - b.column);

  return accesses;
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(accesses: StorageAccessInstance[]): Record<StorageAccessType, number> {
  const summary = emptySummary();
  for (const a of accesses) {
    summary[a.type]++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeStorageAccess(filePath: string): StorageAccessAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const accesses = findAccesses(sf);
  const summary = computeSummary(accesses);

  let violationCount = 0;
  let compliantCount = 0;
  for (const a of accesses) {
    if (VIOLATION_TYPES.has(a.type)) {
      violationCount++;
    } else {
      compliantCount++;
    }
  }

  return {
    filePath: relativePath,
    accesses,
    summary,
    violationCount,
    compliantCount,
  };
}

export function analyzeStorageAccessDirectory(dirPath: string): StorageAccessAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: StorageAccessAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeStorageAccess(fp);
    // Skip files with zero accesses
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
      'Usage: npx tsx scripts/AST/ast-storage-access.ts <path...> [--pretty]\n' +
        '\n' +
        'Inventory browser storage access patterns.\n' +
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
    const results = analyzeStorageAccessDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeStorageAccess(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-storage-access.ts') || process.argv[1].endsWith('ast-storage-access'));

if (isDirectRun) {
  main();
}
