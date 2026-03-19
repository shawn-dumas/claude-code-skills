/**
 * AST Error Coverage Tool
 *
 * For each container/component file, identifies query and mutation hook calls
 * and classifies whether their error states are handled. Catches gaps where
 * a query hook returns `isError` but the container never destructures or uses it.
 */

import path from 'path';
import fs from 'fs';
import { Node, SyntaxKind } from 'ts-morph';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { FileFilter } from './shared';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import { analyzeReactFile } from './ast-react-inventory';
import type {
  ErrorCoverageAnalysis,
  ErrorCoverageObservation,
  ErrorCoverageObservationKind,
  ObservationResult,
  HookCall,
  ReactInventory,
} from './types';

// ---------------------------------------------------------------------------
// Query/mutation hook identification
// ---------------------------------------------------------------------------

const QUERY_PATTERN = /^use\w+Query$/;
const MUTATION_PATTERN = /^use\w+Mutation$/;

/**
 * Determine whether a hook call is a TanStack Query or mutation hook.
 * Uses the definitive set from astConfig plus pattern matching for
 * hooks imported from the service hooks directory.
 */
function isQueryHook(hookName: string, importSource: string | undefined): boolean {
  if (astConfig.hooks.tanstackQueryHooks.has(hookName)) {
    return hookName !== 'useQueryClient' && hookName !== 'useIsFetching' && hookName !== 'useIsMutating';
  }
  if (QUERY_PATTERN.test(hookName)) {
    if (!importSource) return true;
    return importSource.includes('services/hooks');
  }
  return false;
}

function isMutationHook(hookName: string, importSource: string | undefined): boolean {
  if (hookName === 'useMutation') return true;
  if (MUTATION_PATTERN.test(hookName)) {
    if (!importSource) return true;
    return importSource.includes('services/hooks');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Destructured property name resolution
// ---------------------------------------------------------------------------

/**
 * Get the ORIGINAL property names from a hook call's destructuring pattern.
 * ast-react-inventory's `destructuredNames` returns local binding names, which
 * differ from property names when renaming is used (e.g., `{ isError: teamError }`
 * gives `teamError` not `isError`). This function re-parses the call site to get
 * the original property names.
 */
function getOriginalPropertyNames(filePath: string, hookLine: number, hookName: string): string[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const names: string[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    if (node.getStartLineNumber() !== hookLine) return;

    const expr = node.getExpression();
    const callName = Node.isIdentifier(expr) ? expr.getText() : '';
    if (callName !== hookName) return;

    // Walk up to the variable declaration
    const parent = node.getParent();
    if (!parent || !Node.isVariableDeclaration(parent)) return;

    const nameNode = parent.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) return;

    for (const el of nameNode.getElements()) {
      if (!Node.isBindingElement(el)) continue;
      const propNameNode = el.getPropertyNameNode();
      // If renamed: `{ isError: teamError }` -> propNameNode is "isError", getName() is "teamError"
      // If not renamed: `{ isError }` -> propNameNode is undefined, getName() is "isError"
      const originalName = propNameNode ? propNameNode.getText() : el.getName();
      names.push(originalName);
    }
  });

  return names;
}

// ---------------------------------------------------------------------------
// Hook argument analysis (onError, throwOnError detection)
// ---------------------------------------------------------------------------

/**
 * Check whether a hook call expression has `onError` or `throwOnError`
 * in its options argument by re-parsing the call site from the source file.
 */
function analyzeHookCallOptions(
  filePath: string,
  hookLine: number,
  hookName: string,
): { hasOnError: boolean; hasThrowOnError: boolean } {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  let hasOnError = false;
  let hasThrowOnError = false;

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    if (node.getStartLineNumber() !== hookLine) return;

    const expr = node.getExpression();
    const callName = Node.isIdentifier(expr) ? expr.getText() : '';
    if (callName !== hookName) return;

    for (const arg of node.getArguments()) {
      if (Node.isObjectLiteralExpression(arg)) {
        for (const prop of arg.getProperties()) {
          if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
            const name = prop.getName();
            if (name === 'onError') hasOnError = true;
            if (name === 'throwOnError') hasThrowOnError = true;
          }
        }
      }
    }
  });

  return { hasOnError, hasThrowOnError };
}

// ---------------------------------------------------------------------------
// Try-catch detection for mutation calls
// ---------------------------------------------------------------------------

/**
 * Check whether a mutateAsync/mutate call is wrapped in a try-catch
 * within the same component (scoped by line range to avoid cross-component
 * false positives in multi-component files).
 */
function hasTryCatchWrapper(
  filePath: string,
  destructuredNames: string[],
  componentStartLine: number,
  componentEndLine: number,
): boolean {
  const hasMutateAsync = destructuredNames.includes('mutateAsync');
  const hasMutate = destructuredNames.includes('mutate');
  if (!hasMutateAsync && !hasMutate) return false;

  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  let found = false;

  sf.forEachDescendant(node => {
    if (found) return;
    if (!Node.isCallExpression(node)) return;

    const line = node.getStartLineNumber();
    if (line < componentStartLine || line > componentEndLine) return;

    const expr = node.getExpression();
    const callText = expr.getText();

    if (
      (hasMutateAsync && (callText === 'mutateAsync' || callText.endsWith('.mutateAsync'))) ||
      (hasMutate && (callText === 'mutate' || callText.endsWith('.mutate')))
    ) {
      let parent: Node | undefined = node.getParent();
      while (parent) {
        if (Node.isTryStatement(parent)) {
          found = true;
          return;
        }
        parent = parent.getParent();
      }
    }
  });

  return found;
}

// ---------------------------------------------------------------------------
// Global error handler detection
// ---------------------------------------------------------------------------

/**
 * Check whether a file creates a QueryClient/MutationCache with onError callback.
 */
function detectGlobalErrorHandler(filePath: string): boolean {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  let found = false;

  sf.forEachDescendant(node => {
    if (found) return;
    if (!Node.isNewExpression(node)) return;

    const expr = node.getExpression();
    const name = expr.getText();
    if (name !== 'MutationCache' && name !== 'QueryCache' && name !== 'QueryClient') return;

    const args = node.getArguments();
    for (const arg of args) {
      if (Node.isObjectLiteralExpression(arg)) {
        for (const prop of arg.getProperties()) {
          if (
            (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) &&
            prop.getName() === 'onError'
          ) {
            found = true;
            return;
          }
        }
      }
    }
  });

  return found;
}

// ---------------------------------------------------------------------------
// Import resolution for hook source detection
// ---------------------------------------------------------------------------

function resolveHookImportSource(filePath: string, hookName: string): string | undefined {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);

  for (const decl of sf.getImportDeclarations()) {
    for (const named of decl.getNamedImports()) {
      const alias = named.getAliasNode();
      const localName = alias ? alias.getText() : named.getName();
      if (localName === hookName) {
        const resolved = decl.getModuleSpecifierSourceFile();
        if (resolved) {
          return path.relative(PROJECT_ROOT, resolved.getFilePath());
        }
        return decl.getModuleSpecifierValue();
      }
    }
    const defaultImport = decl.getDefaultImport();
    if (defaultImport && defaultImport.getText() === hookName) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) {
        return path.relative(PROJECT_ROOT, resolved.getFilePath());
      }
      return decl.getModuleSpecifierValue();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

function classifyHookCall(
  hookCall: HookCall,
  componentName: string,
  filePath: string,
  importSource: string | undefined,
  componentStartLine: number,
  componentEndLine: number,
): ErrorCoverageObservation | null {
  const { name: hookName, destructuredNames, line } = hookCall;

  // Check mutation FIRST -- useMutation is in tanstackQueryHooks but should
  // be classified as a mutation, not a query.
  const isMutation = isMutationHook(hookName, importSource);
  const isQuery = !isMutation && isQueryHook(hookName, importSource);
  if (!isQuery && !isMutation) return null;

  const { hasOnError, hasThrowOnError } = analyzeHookCallOptions(filePath, line, hookName);

  if (isQuery) {
    // Check ORIGINAL property names to handle renaming (e.g., { isError: teamError })
    const originalNames = getOriginalPropertyNames(filePath, line, hookName);
    const namesToCheck = originalNames.length > 0 ? originalNames : destructuredNames;
    const hasIsError = namesToCheck.includes('isError') || namesToCheck.includes('error');
    const kind: ErrorCoverageObservationKind =
      hasIsError || hasOnError || hasThrowOnError ? 'QUERY_ERROR_HANDLED' : 'QUERY_ERROR_UNHANDLED';

    return {
      kind,
      file: filePath,
      line,
      evidence: {
        hookName,
        componentName,
        destructuredNames: [...destructuredNames],
        hasIsError,
        hasOnError,
        hasThrowOnError,
        hasTryCatch: false,
      },
    };
  }

  // Mutation -- check original property names for renamed bindings
  const mutationOriginalNames = getOriginalPropertyNames(filePath, line, hookName);
  const mutationNamesToCheck = mutationOriginalNames.length > 0 ? mutationOriginalNames : destructuredNames;
  const hasTryCatch = hasTryCatchWrapper(filePath, mutationNamesToCheck, componentStartLine, componentEndLine);
  const kind: ErrorCoverageObservationKind =
    hasOnError || hasThrowOnError || hasTryCatch ? 'MUTATION_ERROR_HANDLED' : 'MUTATION_ERROR_UNHANDLED';

  return {
    kind,
    file: filePath,
    line,
    evidence: {
      hookName,
      componentName,
      destructuredNames: [...destructuredNames],
      hasIsError: false,
      hasOnError,
      hasThrowOnError,
      hasTryCatch,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeErrorCoverage(filePath: string): ErrorCoverageAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const inventory: ReactInventory = analyzeReactFile(filePath);
  const observations: ErrorCoverageObservation[] = [];

  // Check for global error handlers
  const hasGlobalHandler = detectGlobalErrorHandler(filePath);
  if (hasGlobalHandler) {
    observations.push({
      kind: 'GLOBAL_ERROR_HANDLER',
      file: relativePath,
      line: 1,
      evidence: {
        hookName: 'QueryClient/MutationCache',
        componentName: '<module>',
        destructuredNames: [],
        hasIsError: false,
        hasOnError: true,
        hasThrowOnError: false,
        hasTryCatch: false,
      },
    });
  }

  for (const component of inventory.components) {
    for (const hookCall of component.hookCalls) {
      const importSource = resolveHookImportSource(filePath, hookCall.name);
      const obs = classifyHookCall(
        hookCall,
        component.name,
        relativePath,
        importSource,
        component.line,
        component.returnStatementEndLine,
      );
      if (obs) {
        observations.push(obs);
      }
    }
  }

  const summary = computeSummary(observations, hasGlobalHandler);

  return {
    filePath: relativePath,
    observations,
    summary,
  };
}

function computeSummary(
  observations: ErrorCoverageObservation[],
  hasGlobalHandler: boolean,
): ErrorCoverageAnalysis['summary'] {
  let queriesHandled = 0;
  let queriesUnhandled = 0;
  let mutationsHandled = 0;
  let mutationsUnhandled = 0;

  for (const obs of observations) {
    switch (obs.kind) {
      case 'QUERY_ERROR_HANDLED':
        queriesHandled++;
        break;
      case 'QUERY_ERROR_UNHANDLED':
        queriesUnhandled++;
        break;
      case 'MUTATION_ERROR_HANDLED':
        mutationsHandled++;
        break;
      case 'MUTATION_ERROR_UNHANDLED':
        mutationsUnhandled++;
        break;
    }
  }

  return {
    queriesTotal: queriesHandled + queriesUnhandled,
    queriesHandled,
    queriesUnhandled,
    mutationsTotal: mutationsHandled + mutationsUnhandled,
    mutationsHandled,
    mutationsUnhandled,
    hasGlobalHandler,
  };
}

export function analyzeErrorCoverageDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): ErrorCoverageAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: ErrorCoverageAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-error-coverage', fp, () => analyzeErrorCoverage(fp), options);
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by unhandled count descending
  results.sort((a, b) => {
    const aUnhandled = a.summary.queriesUnhandled + a.summary.mutationsUnhandled;
    const bUnhandled = b.summary.queriesUnhandled + b.summary.mutationsUnhandled;
    return bUnhandled - aUnhandled;
  });

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractErrorCoverageObservations(
  analysis: ErrorCoverageAnalysis,
): ObservationResult<ErrorCoverageObservation> {
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
      'Usage: npx tsx scripts/AST/ast-error-coverage.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze error handling coverage for TanStack Query/Mutation hooks.\n' +
        '\n' +
        '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute\n' +
        '  --test-files  Scan test files instead of production files\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');
  const testFiles = args.flags.has('test-files');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: ErrorCoverageAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeErrorCoverageDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('ast-error-coverage', absolute, () => analyzeErrorCoverage(targetPath), { noCache });
      if (result.observations.length > 0) {
        allResults.push(result);
      }
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
  (process.argv[1].endsWith('ast-error-coverage.ts') || process.argv[1].endsWith('ast-error-coverage'));

if (isDirectRun) {
  main();
}
