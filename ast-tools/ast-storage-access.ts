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
// Main analysis walker
// ---------------------------------------------------------------------------

function findAccesses(sf: SourceFile): StorageAccessInstance[] {
  const accesses: StorageAccessInstance[] = [];

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // --- Direct localStorage / sessionStorage method calls ---
    // e.g., localStorage.getItem('key'), sessionStorage.setItem('key', 'val')
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        const objText = callee.getExpression().getText();
        const methodName = callee.getName();

        // localStorage.getItem / setItem / removeItem / clear
        if (objText === 'localStorage' && STORAGE_METHODS.has(methodName)) {
          accesses.push({
            type: 'DIRECT_LOCAL_STORAGE',
            line,
            column,
            text: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
          return;
        }

        // sessionStorage.getItem / setItem / removeItem / clear
        if (objText === 'sessionStorage' && STORAGE_METHODS.has(methodName)) {
          accesses.push({
            type: 'DIRECT_SESSION_STORAGE',
            line,
            column,
            text: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
          return;
        }

        // --- typedStorage functions ---
        // readStorage(...), writeStorage(...), removeStorage(...)
        // These may appear as bare calls (no property access) -- handled below

        // --- Cookies.get / Cookies.set / Cookies.remove (js-cookie) ---
        if (objText === 'Cookies' && (methodName === 'get' || methodName === 'set' || methodName === 'remove')) {
          accesses.push({
            type: 'COOKIE_ACCESS',
            line,
            column,
            text: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: false,
          });
          return;
        }
      }

      // --- Bare function calls: readStorage, writeStorage, removeStorage, JSON.parse ---
      const calleeText = node.getExpression().getText();

      if (calleeText === 'readStorage') {
        accesses.push({
          type: 'TYPED_STORAGE_READ',
          line,
          column,
          text: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
          isViolation: false,
        });
        return;
      }

      if (calleeText === 'writeStorage') {
        accesses.push({
          type: 'TYPED_STORAGE_WRITE',
          line,
          column,
          text: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
          isViolation: false,
        });
        return;
      }

      if (calleeText === 'removeStorage') {
        accesses.push({
          type: 'TYPED_STORAGE_REMOVE',
          line,
          column,
          text: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
          isViolation: false,
        });
        return;
      }

      // --- JSON.parse ---
      if (calleeText === 'JSON.parse') {
        if (!isJsonParseZodGuarded(node)) {
          accesses.push({
            type: 'JSON_PARSE_UNVALIDATED',
            line,
            column,
            text: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
        }
        return;
      }
    }

    // --- Property access on localStorage / sessionStorage (non-method) ---
    // e.g., localStorage.length, or bare property reads
    // We need to avoid double-counting method calls already handled above.
    if (Node.isPropertyAccessExpression(node)) {
      const objText = node.getExpression().getText();
      const propName = node.getName();

      if (objText === 'localStorage' && !STORAGE_METHODS.has(propName)) {
        // Check this is not the callee of a call we already handled
        const parent = node.getParent();
        if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
          // This is the callee of a call expression -- method call on localStorage
          // with a non-standard method. Still a direct access.
          accesses.push({
            type: 'DIRECT_LOCAL_STORAGE',
            line,
            column,
            text: truncateText(parent.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
        } else {
          accesses.push({
            type: 'DIRECT_LOCAL_STORAGE',
            line,
            column,
            text: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
        }
        return;
      }

      if (objText === 'sessionStorage' && !STORAGE_METHODS.has(propName)) {
        const parent = node.getParent();
        if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
          accesses.push({
            type: 'DIRECT_SESSION_STORAGE',
            line,
            column,
            text: truncateText(parent.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
        } else {
          accesses.push({
            type: 'DIRECT_SESSION_STORAGE',
            line,
            column,
            text: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
            isViolation: true,
          });
        }
        return;
      }

      // --- document.cookie ---
      if (objText === 'document' && propName === 'cookie') {
        accesses.push({
          type: 'COOKIE_ACCESS',
          line,
          column,
          text: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
          isViolation: false,
        });
        return;
      }
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

function analyzeStorageAccessDirectory(dirPath: string): StorageAccessAnalysis[] {
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
