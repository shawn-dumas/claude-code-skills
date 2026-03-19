import { Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { analyzeReactFile } from './ast-react-inventory';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { FileFilter } from './shared';
import { cached, getCacheStats } from './ast-cache';
import type {
  ConcernMatrixAnalysis,
  ConcernMatrixObservation,
  ConcernMatrixObservationKind,
  ObservationResult,
  ReactInventory,
  ComponentInfo,
  HookCall,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOADING_DESTRUCTURED = new Set(['isLoading', 'isPending', 'isFetching']);
const LOADING_JSX_NAMES = new Set(['LoadingContainer', 'Spinner', 'LoadingOverlay', 'LoadingSkeleton']);
const LOADING_STATE_PATTERN = /^(is(Loading|Updating|Submitting|Saving|Processing|Fetching)|loading|pending)/;
const ERROR_DESTRUCTURED = new Set(['isError', 'error']);
const ERROR_JSX_NAMES = new Set(['QueryErrorFallback', 'ErrorBoundary']);
const EMPTY_JSX_NAMES = new Set(['PlaceholderContainer']);
const PERMISSION_JSX_NAMES = new Set(['RequireRoles', 'RequireLoginMaybe']);
const PERMISSION_HOOKS = new Set(['useAuthState']);
const PERMISSION_IDENTIFIERS = new Set(['allowedRoles']);

/** Hooks that indicate data-fetching (query pattern) by name. */
const QUERY_HOOK_PATTERN = /^use\w*Query$/;
const MUTATION_HOOK_PATTERN = /^use\w*Mutation$/;
/** TanStack core hooks that are queries/mutations. */
const TANSTACK_QUERY_HOOKS = new Set(['useQuery', 'useInfiniteQuery', 'useSuspenseQuery']);
const TANSTACK_MUTATION_HOOKS = new Set(['useMutation']);

/**
 * Destructured names that indicate a hook is a data-fetching wrapper.
 * A custom hook like useTeamData() that returns { data, isLoading } is
 * effectively a query hook from the container's perspective.
 */
const DATA_FETCHING_SIGNALS = new Set([
  'data',
  'isLoading',
  'isPending',
  'isFetching',
  'isError',
  'error',
  'mutate',
  'mutateAsync',
  'isSuccess',
  'status',
  'fetchStatus',
  'refetch',
  'isFetched',
  'isRefetching',
]);

/** Directories where permission gates are expected. */
const PERMISSION_REQUIRED_PATTERNS = ['/pages/', '/settings/'];

// ---------------------------------------------------------------------------
// Hook classification
// ---------------------------------------------------------------------------

function isQueryHookByName(hookName: string): boolean {
  return TANSTACK_QUERY_HOOKS.has(hookName) || QUERY_HOOK_PATTERN.test(hookName);
}

function isMutationHookByName(hookName: string): boolean {
  return TANSTACK_MUTATION_HOOKS.has(hookName) || MUTATION_HOOK_PATTERN.test(hookName);
}

/**
 * A hook is considered a data-fetching hook if:
 * 1. Its name matches TanStack query/mutation patterns, OR
 * 2. It destructures 2+ signals that indicate async data
 *    (e.g. { data, isLoading } from a custom wrapper hook)
 */
function isDataFetchingHook(hook: HookCall): boolean {
  if (isQueryHookByName(hook.name) || isMutationHookByName(hook.name)) return true;
  const signalCount = hook.destructuredNames.filter(n => DATA_FETCHING_SIGNALS.has(n)).length;
  return signalCount >= 2;
}

// ---------------------------------------------------------------------------
// Renamed destructuring resolution
// ---------------------------------------------------------------------------

/**
 * Get the ORIGINAL property names from a hook call's destructuring pattern.
 * `destructuredNames` from ast-react-inventory contains local binding names,
 * which differ when renaming is used (e.g., `{ isLoading: teamLoading }` gives
 * `teamLoading` not `isLoading`). This re-parses the call site to get originals.
 */
function getOriginalPropertyNames(filePath: string, hookLine: number, hookName: string): string[] {
  const sf = getSourceFile(filePath);
  const names: string[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    if (node.getStartLineNumber() !== hookLine) return;

    const expr = node.getExpression();
    const callName = Node.isIdentifier(expr) ? expr.getText() : '';
    if (callName !== hookName) return;

    const parent = node.getParent();
    if (!parent || !Node.isVariableDeclaration(parent)) return;

    const nameNode = parent.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) return;

    for (const el of nameNode.getElements()) {
      if (!Node.isBindingElement(el)) continue;
      const propNameNode = el.getPropertyNameNode();
      const originalName = propNameNode ? propNameNode.getText() : el.getName();
      names.push(originalName);
    }
  });

  return names;
}

/**
 * Get the effective property names for a hook call -- original names if
 * renaming was used, otherwise the destructured names as-is.
 */
function getEffectivePropertyNames(filePath: string, hook: HookCall): string[] {
  if (hook.destructuredNames.length === 0) return [];
  const originals = getOriginalPropertyNames(filePath, hook.line, hook.name);
  return originals.length > 0 ? originals : hook.destructuredNames;
}

// ---------------------------------------------------------------------------
// Signal detection from ReactInventory
// ---------------------------------------------------------------------------

function findLoadingSignals(comp: ComponentInfo, filePath: string): string[] {
  const signals: string[] = [];
  for (const hook of comp.hookCalls) {
    const names = getEffectivePropertyNames(filePath, hook);
    for (const name of names) {
      if (LOADING_DESTRUCTURED.has(name)) {
        signals.push(`${hook.name}.${name}`);
      }
    }
  }
  return signals;
}

function findLoadingSignalsFromAst(filePath: string, range: LineRange): string[] {
  const sf = getSourceFile(filePath);
  const signals: string[] = [];

  sf.forEachDescendant(node => {
    if (!isInRange(node, range)) return;

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagName = node.getTagNameNode().getText();
      if (LOADING_JSX_NAMES.has(tagName)) {
        signals.push(`JSX:${tagName}`);
      }
    }
  });

  return signals;
}

function findLoadingSignalsFromUseState(comp: ComponentInfo): string[] {
  const signals: string[] = [];

  for (const hook of comp.hookCalls) {
    if (hook.name !== 'useState') continue;
    for (const name of hook.destructuredNames) {
      if (LOADING_STATE_PATTERN.test(name)) {
        signals.push(`useState:${name}`);
      }
    }
  }

  return signals;
}

function findErrorSignalsFromHooks(comp: ComponentInfo, filePath: string): string[] {
  const signals: string[] = [];
  for (const hook of comp.hookCalls) {
    const names = getEffectivePropertyNames(filePath, hook);
    for (const name of names) {
      if (ERROR_DESTRUCTURED.has(name)) {
        signals.push(`${hook.name}.${name}`);
      }
    }
  }
  return signals;
}

function findPermissionSignalsFromHooks(comp: ComponentInfo, filePath: string): string[] {
  const signals: string[] = [];
  for (const hook of comp.hookCalls) {
    if (PERMISSION_HOOKS.has(hook.name)) {
      signals.push(hook.name);
    }
    const names = getEffectivePropertyNames(filePath, hook);
    for (const name of names) {
      if (PERMISSION_IDENTIFIERS.has(name)) {
        signals.push(`${hook.name}.${name}`);
      }
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Signal detection from AST (JSX + identifier scanning)
// Scoped to a component's line range to avoid cross-component false positives.
// ---------------------------------------------------------------------------

interface LineRange {
  startLine: number;
  endLine: number;
}

function isInRange(node: Node, range: LineRange): boolean {
  const line = node.getStartLineNumber();
  return line >= range.startLine && line <= range.endLine;
}

function findErrorSignalsFromAst(filePath: string, range: LineRange): string[] {
  const sf = getSourceFile(filePath);
  const signals: string[] = [];

  sf.forEachDescendant(node => {
    if (!isInRange(node, range)) return;

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagName = node.getTagNameNode().getText();
      if (ERROR_JSX_NAMES.has(tagName)) {
        signals.push(`JSX:${tagName}`);
      } else if (tagName.includes('Error') || tagName.includes('Fallback')) {
        signals.push(`JSX:${tagName}`);
      }
    }
  });

  return signals;
}

function findEmptySignalsFromAst(filePath: string, range: LineRange): string[] {
  const signals: string[] = [];
  const sf = getSourceFile(filePath);

  sf.forEachDescendant(node => {
    if (!isInRange(node, range)) return;

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagName = node.getTagNameNode().getText();
      if (EMPTY_JSX_NAMES.has(tagName)) {
        signals.push(`JSX:${tagName}`);
      }
    }

    // Check for .length === 0 patterns
    if (Node.isBinaryExpression(node)) {
      const text = node.getText();
      if (text.includes('.length') && (text.includes('=== 0') || text.includes('== 0'))) {
        signals.push(`length-check:${text.substring(0, 40)}`);
      }
    }

    // Check for !data or data?.length patterns
    if (Node.isPrefixUnaryExpression(node)) {
      const operand = node.getOperand();
      if (Node.isIdentifier(operand)) {
        const name = operand.getText();
        if (name === 'data' || name.endsWith('Data')) {
          signals.push(`negation-check:!${name}`);
        }
      }
    }

    // Check for placeholder prop
    if (Node.isJsxAttribute(node)) {
      const name = node.getNameNode().getText();
      if (name === 'placeholder') {
        signals.push('prop:placeholder');
      }
    }
  });

  return signals;
}

function findPermissionSignalsFromAst(filePath: string, range: LineRange): string[] {
  const sf = getSourceFile(filePath);
  const signals: string[] = [];

  sf.forEachDescendant(node => {
    if (!isInRange(node, range)) return;

    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
      const tagName = node.getTagNameNode().getText();
      if (PERMISSION_JSX_NAMES.has(tagName)) {
        signals.push(`JSX:${tagName}`);
      }
    }
  });

  return signals;
}

// ---------------------------------------------------------------------------
// Concern matrix analysis
// ---------------------------------------------------------------------------

function isPermissionApplicable(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PERMISSION_REQUIRED_PATTERNS.some(pattern => normalized.includes(pattern));
}

function countQueryHooks(comp: ComponentInfo): number {
  return comp.hookCalls.filter(h => isQueryHookByName(h.name)).length;
}

function countMutationHooks(comp: ComponentInfo): number {
  return comp.hookCalls.filter(h => isMutationHookByName(h.name)).length;
}

function hasDataFetchingHooks(comp: ComponentInfo): boolean {
  return comp.hookCalls.some(h => isDataFetchingHook(h));
}

function analyzeComponent(
  comp: ComponentInfo,
  filePath: string,
  absolutePath: string,
  relativePath: string,
): ConcernMatrixObservation[] {
  // Only analyze components that have data-fetching hooks
  if (!hasDataFetchingHooks(comp)) return [];

  const queryHookCount = countQueryHooks(comp);
  const mutationHookCount = countMutationHooks(comp);

  // Scope AST scanning to this component's line range
  const range: LineRange = {
    startLine: comp.line,
    endLine: comp.returnStatementEndLine,
  };

  const isMutationOnly = queryHookCount === 0 && mutationHookCount > 0;

  // Collect signals (pass absolutePath for renamed-destructuring resolution)
  const loadingSignals = [
    ...findLoadingSignals(comp, absolutePath),
    ...findLoadingSignalsFromAst(absolutePath, range),
    ...findLoadingSignalsFromUseState(comp),
  ];
  const errorSignals = [
    ...findErrorSignalsFromHooks(comp, absolutePath),
    ...findErrorSignalsFromAst(absolutePath, range),
  ];
  const emptySignals = findEmptySignalsFromAst(absolutePath, range);
  const permissionSignals = [
    ...findPermissionSignalsFromHooks(comp, absolutePath),
    ...findPermissionSignalsFromAst(absolutePath, range),
  ];

  // Deduplicate signals
  const uniqueLoading = [...new Set(loadingSignals)];
  const uniqueError = [...new Set(errorSignals)];
  const uniqueEmpty = [...new Set(emptySignals)];
  const uniquePermission = [...new Set(permissionSignals)];

  const handlesLoading = uniqueLoading.length > 0;
  const handlesError = uniqueError.length > 0;
  const handlesEmpty = uniqueEmpty.length > 0;
  const handlesPermission = uniquePermission.length > 0;

  const evidence = {
    componentName: comp.name,
    queryHookCount,
    mutationHookCount,
    loadingSignals: uniqueLoading,
    errorSignals: uniqueError,
    emptySignals: uniqueEmpty,
    permissionSignals: uniquePermission,
  };

  const observations: ConcernMatrixObservation[] = [];

  // Emit handles/missing observations for loading.
  // Mutation-only containers (no queries) are not expected to handle loading at
  // the container level -- mutation loading feedback is owned by the UI that
  // triggers the mutation (form isSubmitting, button spinner, etc.).
  if (handlesLoading) {
    observations.push({ kind: 'CONTAINER_HANDLES_LOADING', file: relativePath, line: comp.line, evidence });
  } else if (!isMutationOnly) {
    observations.push({ kind: 'CONTAINER_MISSING_LOADING', file: relativePath, line: comp.line, evidence });
  }

  // Emit handles/missing observations for error
  if (handlesError) {
    observations.push({ kind: 'CONTAINER_HANDLES_ERROR', file: relativePath, line: comp.line, evidence });
  } else {
    observations.push({ kind: 'CONTAINER_MISSING_ERROR', file: relativePath, line: comp.line, evidence });
  }

  // Emit handles/missing observations for empty
  if (handlesEmpty) {
    observations.push({ kind: 'CONTAINER_HANDLES_EMPTY', file: relativePath, line: comp.line, evidence });
  } else {
    observations.push({ kind: 'CONTAINER_MISSING_EMPTY', file: relativePath, line: comp.line, evidence });
  }

  // Permission: emit HANDLES if present; emit MISSING only for route directories
  if (handlesPermission) {
    observations.push({ kind: 'CONTAINER_HANDLES_PERMISSION', file: relativePath, line: comp.line, evidence });
  } else if (isPermissionApplicable(filePath)) {
    observations.push({ kind: 'CONTAINER_MISSING_PERMISSION', file: relativePath, line: comp.line, evidence });
  }

  return observations;
}

function buildSummary(
  comp: ComponentInfo,
  observations: ConcernMatrixObservation[],
  filePath: string,
): ConcernMatrixAnalysis['summary'] {
  const handlesLoading = observations.some(o => o.kind === 'CONTAINER_HANDLES_LOADING');
  const handlesError = observations.some(o => o.kind === 'CONTAINER_HANDLES_ERROR');
  const handlesEmpty = observations.some(o => o.kind === 'CONTAINER_HANDLES_EMPTY');
  const handlesPermission = observations.some(o => o.kind === 'CONTAINER_HANDLES_PERMISSION');

  const permApplicable = isPermissionApplicable(filePath);

  let handled = 0;
  let total = 3; // loading + error + empty

  if (handlesLoading) handled++;
  if (handlesError) handled++;
  if (handlesEmpty) handled++;

  if (permApplicable) {
    total = 4;
    if (handlesPermission) handled++;
  }

  return {
    componentName: comp.name,
    handlesLoading,
    handlesError,
    handlesEmpty,
    handlesPermission,
    score: `${handled}/${total}`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeConcernMatrix(filePath: string): ConcernMatrixAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const inventory: ReactInventory = analyzeReactFile(absolute);

  const allObservations: ConcernMatrixObservation[] = [];

  // Analyze each component in the file
  for (const comp of inventory.components) {
    const compObservations = analyzeComponent(comp, relativePath, absolute, relativePath);
    allObservations.push(...compObservations);
  }

  // Build summary from the first component that has observations (the primary container)
  const primaryComp = inventory.components.find(comp => hasDataFetchingHooks(comp));

  const summary: ConcernMatrixAnalysis['summary'] = primaryComp
    ? buildSummary(primaryComp, allObservations, relativePath)
    : {
        componentName: '',
        handlesLoading: false,
        handlesError: false,
        handlesEmpty: false,
        handlesPermission: false,
        score: '0/0',
      };

  return {
    filePath: relativePath,
    observations: allObservations,
    summary,
  };
}

export function analyzeConcernMatrixDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): ConcernMatrixAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: ConcernMatrixAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-concern-matrix', fp, () => analyzeConcernMatrix(fp), options);
    // Only include files that had observations
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractConcernMatrixObservations(
  analysis: ConcernMatrixAnalysis,
): ObservationResult<ConcernMatrixObservation> {
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
      'Usage: npx tsx scripts/AST/ast-concern-matrix.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze behavioral concern coverage for container components.\n' +
        'Checks loading, error, empty, and permission handling.\n' +
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

  const allResults: ConcernMatrixAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeConcernMatrixDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('ast-concern-matrix', absolute, () => analyzeConcernMatrix(targetPath), { noCache });
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
  (process.argv[1].endsWith('ast-concern-matrix.ts') || process.argv[1].endsWith('ast-concern-matrix'));

if (isDirectRun) {
  main();
}
