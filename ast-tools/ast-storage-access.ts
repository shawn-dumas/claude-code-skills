import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import { getSourceFile, PROJECT_ROOT } from './project';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import type { StorageAccessAnalysis, StorageAccessInstance, StorageAccessType, StorageObservation } from './types';
import { astConfig } from './ast-config';
import { cached } from './ast-cache';

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
// Observation extraction
// ---------------------------------------------------------------------------

export function extractStorageObservations(sf: SourceFile): StorageObservation[] {
  const observations: StorageObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // Direct storage method calls (localStorage.getItem, sessionStorage.setItem, etc.)
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        const objText = callee.getExpression().getText();
        const methodName = callee.getName();

        // Check for direct storage calls
        const storageType = astConfig.storage.directStorageTypeMap[objText];
        if (storageType && astConfig.storage.directStorageMethods.has(methodName)) {
          observations.push({
            kind: 'DIRECT_STORAGE_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              storageType: objText as 'localStorage' | 'sessionStorage',
              method: methodName,
            },
          });
          return;
        }

        // Check for cookie method calls (Cookies.get, Cookies.set, etc.)
        if (objText === 'Cookies' && astConfig.storage.cookieMethods.has(methodName)) {
          observations.push({
            kind: 'COOKIE_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              method: methodName,
            },
          });
          return;
        }
      }

      // Check for typed storage helper calls (readStorage, writeStorage, removeStorage)
      const calleeText = node.getExpression().getText();
      const helperType = astConfig.storage.typedStorageHelpers[calleeText];
      if (helperType) {
        observations.push({
          kind: 'TYPED_STORAGE_CALL',
          file: relativePath,
          line,
          column,
          evidence: {
            helperName: calleeText,
          },
        });
        return;
      }

      // Check for JSON.parse calls
      if (calleeText === 'JSON.parse') {
        const isGuarded = isJsonParseZodGuarded(node);
        observations.push({
          kind: isGuarded ? 'JSON_PARSE_ZOD_GUARDED' : 'JSON_PARSE_CALL',
          file: relativePath,
          line,
          column,
          evidence: {
            isZodGuarded: isGuarded,
          },
        });
        return;
      }
    }

    // Storage property access (localStorage.length, document.cookie)
    if (Node.isPropertyAccessExpression(node)) {
      const objText = node.getExpression().getText();
      const propName = node.getName();

      // Check for non-method property access on localStorage/sessionStorage
      const storageType = astConfig.storage.directStorageTypeMap[objText];
      if (storageType && !astConfig.storage.directStorageMethods.has(propName)) {
        observations.push({
          kind: 'STORAGE_PROPERTY_ACCESS',
          file: relativePath,
          line,
          column,
          evidence: {
            storageType: objText as 'localStorage' | 'sessionStorage',
            method: propName,
          },
        });
        return;
      }

      // Check for document.cookie access
      if (objText === 'document' && propName === 'cookie') {
        observations.push({
          kind: 'COOKIE_CALL',
          file: relativePath,
          line,
          column,
          evidence: {
            method: 'cookie',
          },
        });
      }
    }
  });

  // Sort by line number
  observations.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

  return observations;
}

// ---------------------------------------------------------------------------
// JSON.parse Zod guard detection
// ---------------------------------------------------------------------------

/**
 * Check whether a JSON.parse() call is Zod-guarded via any of four patterns:
 *
 * 1. Comment exemption: `// json-parse-exempt:` on same or preceding line
 * 2. Direct argument: `schema.parse(JSON.parse(...))`
 * 3. z.preprocess callback: `z.preprocess(d => JSON.parse(d), schema)`
 * 4. Variable capture: `const raw = JSON.parse(x); schema.parse(raw);`
 *
 * Ordered cheapest-first. False negatives are acceptable; false positives are not.
 */
function isJsonParseZodGuarded(node: Node): boolean {
  if (hasExemptComment(node)) return true;
  if (isDirectZodArgument(node)) return true;
  if (isInsideZodPreprocess(node)) return true;
  if (isVariableCapturedThenZodParsed(node)) return true;
  return false;
}

/** Pattern 1: `// json-parse-exempt:` on same line or line above. */
function hasExemptComment(node: Node): boolean {
  const sf = node.getSourceFile();
  const fullText = sf.getFullText();
  const lines = fullText.split('\n');
  const lineIndex = node.getStartLineNumber() - 1;
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 1); i--) {
    if (lines[i].includes('json-parse-exempt:')) return true;
  }
  return false;
}

/** Pattern 2: JSON.parse(...) is a direct argument of .parse() or .safeParse(). */
function isDirectZodArgument(node: Node): boolean {
  const parent = node.getParent();
  if (!parent || !Node.isCallExpression(parent)) return false;
  const callee = parent.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const methodName = callee.getName();
  return methodName === 'parse' || methodName === 'safeParse';
}

/** Pattern 3: JSON.parse is inside an arrow/function passed to z.preprocess(fn, schema). */
function isInsideZodPreprocess(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (parent && Node.isCallExpression(parent)) {
        const calleeText = parent.getExpression().getText();
        if (calleeText === 'z.preprocess' || calleeText.endsWith('.preprocess')) {
          if (parent.getArguments().length === 2) return true;
        }
      }
    }
    if (Node.isFunctionDeclaration(current)) break;
    current = current.getParent();
  }
  return false;
}

/**
 * Pattern 4: JSON.parse assigns to a variable, and later in the same function
 * scope .parse(varName) or .safeParse(varName) is called on that variable.
 */
function isVariableCapturedThenZodParsed(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  let varName: string | null = null;
  if (Node.isVariableDeclaration(parent)) {
    varName = parent.getName();
  } else if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getText() === '=') {
    const left = parent.getLeft();
    if (Node.isIdentifier(left)) {
      varName = left.getText();
    }
  }
  if (!varName) return false;

  const jsonParseLine = node.getStartLineNumber();

  // Find enclosing function scope (or use source file for module scope)
  let scopeNode: Node | undefined;
  let walk: Node | undefined = parent.getParent();
  while (walk) {
    if (
      Node.isFunctionDeclaration(walk) ||
      Node.isArrowFunction(walk) ||
      Node.isFunctionExpression(walk) ||
      Node.isMethodDeclaration(walk)
    ) {
      scopeNode = walk;
      break;
    }
    walk = walk.getParent();
  }
  const searchRoot = scopeNode ?? node.getSourceFile();

  let found = false;
  searchRoot.forEachDescendant(desc => {
    if (found) return;
    if (!Node.isCallExpression(desc)) return;
    if (desc.getStartLineNumber() <= jsonParseLine) return;

    const callee = desc.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const methodName = callee.getName();
    if (methodName !== 'parse' && methodName !== 'safeParse') return;

    const args = desc.getArguments();
    if (args.length === 1 && args[0].getText() === varName) {
      found = true;
    }
  });

  return found;
}

// ---------------------------------------------------------------------------
// Per-category classifiers
// ---------------------------------------------------------------------------

interface StorageNodeContext {
  line: number;
  column: number;
}

/** Classify direct localStorage/sessionStorage method calls and cookie access via property access. */
function classifyStorageMethodCall(node: Node, ctx: StorageNodeContext): StorageAccessInstance | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;

  const objText = callee.getExpression().getText();
  const methodName = callee.getName();

  const directType = astConfig.storage.directStorageTypeMap[objText] as StorageAccessType | undefined;
  if (directType && astConfig.storage.directStorageMethods.has(methodName)) {
    return {
      type: directType,
      line: ctx.line,
      column: ctx.column,
      text: truncateText(node.getText(), 80),
      containingFunction: getContainingFunctionName(node),
      isViolation: true,
    };
  }

  if (objText === 'Cookies' && astConfig.storage.cookieMethods.has(methodName)) {
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

  const type = astConfig.storage.typedStorageHelpers[calleeText] as StorageAccessType | undefined;
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

  const directType = astConfig.storage.directStorageTypeMap[objText] as StorageAccessType | undefined;
  if (directType && !astConfig.storage.directStorageMethods.has(propName)) {
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
  const observations = extractStorageObservations(sf);
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
    observations,
  };
}

export function analyzeStorageAccessDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): StorageAccessAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: StorageAccessAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('storage-access', fp, () => analyzeStorageAccess(fp), options);
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

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-storage-access.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
  '\n' +
  'Inventory browser storage access patterns.\n' +
  '\n' +
  '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --no-cache    Bypass cache and recompute (also refreshes cache)\n' +
  '  --test-files  Scan test files instead of production files\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<StorageAccessAnalysis> = {
  cacheNamespace: 'storage-access',
  helpText: HELP_TEXT,
  analyzeFile: analyzeStorageAccess,
  analyzeDirectory: analyzeStorageAccessDirectory,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-storage-access.ts') || process.argv[1].endsWith('ast-storage-access'));
if (isDirectRun) runObservationToolCli(cliConfig);
