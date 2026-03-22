import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import type { SideEffectsAnalysis, SideEffectInstance, SideEffectType, SideEffectObservation } from './types';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): Record<SideEffectType, number> {
  return {
    CONSOLE_CALL: 0,
    TOAST_CALL: 0,
    TIMER_CALL: 0,
    POSTHOG_CALL: 0,
    WINDOW_MUTATION: 0,
  };
}

// ---------------------------------------------------------------------------
// Dispatch maps for classifyCallExpression (built from astConfig)
// ---------------------------------------------------------------------------

/** Maps direct identifier text to side effect type. */
const DIRECT_CALL_MAP = new Map<string, SideEffectType>([
  ['toast', 'TOAST_CALL'],
  ...[...astConfig.sideEffects.timerFunctions].map((fn): [string, SideEffectType] => [fn, 'TIMER_CALL']),
  ...[...astConfig.sideEffects.posthogDirectCalls].map((fn): [string, SideEffectType] => [fn, 'POSTHOG_CALL']),
]);

/** Maps property-access object text to a function that classifies the method. */
const PROPERTY_ACCESS_MAP = new Map<string, (method: string) => SideEffectType | null>([
  ['console', method => (astConfig.sideEffects.consoleMethods.has(method) ? 'CONSOLE_CALL' : null)],
  ['toast', () => 'TOAST_CALL'],
  ['posthog', method => (astConfig.sideEffects.posthogMethodCalls.has(method) ? 'POSTHOG_CALL' : null)],
  ['window', method => (method === 'open' ? 'WINDOW_MUTATION' : null)],
  ['history', method => (astConfig.sideEffects.windowMutationCalls.has(method) ? 'WINDOW_MUTATION' : null)],
]);

// ---------------------------------------------------------------------------
// useEffect detection
// ---------------------------------------------------------------------------

function isInsideUseEffectCallback(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    // Look for arrow function or function expression that is the first argument of useEffect/useLayoutEffect
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (parent && Node.isCallExpression(parent)) {
        const callee = parent.getExpression();
        const calleeName = callee.getText();
        if (calleeName === 'useEffect' || calleeName === 'useLayoutEffect') {
          // Verify this is the first argument (the callback), not a dep array factory
          const args = parent.getArguments();
          if (args.length > 0 && args[0] === current) {
            return true;
          }
        }
      }
    }
    current = current.getParent();
  }
  return false;
}

// ---------------------------------------------------------------------------
// Side effect classification
// ---------------------------------------------------------------------------

function classifyCallExpression(node: Node): SideEffectType | null {
  if (!Node.isCallExpression(node)) return null;

  const expr = node.getExpression();

  // Direct identifier calls: toast(), setTimeout(), sendPosthogEvent(), etc.
  if (Node.isIdentifier(expr)) {
    return DIRECT_CALL_MAP.get(expr.getText()) ?? null;
  }

  // Property access calls: console.log(), posthog.capture(), window.open(), etc.
  if (Node.isPropertyAccessExpression(expr)) {
    return classifyPropertyAccess(expr);
  }

  return null;
}

/** Classify a property-access call expression (e.g. console.log, posthog.people.set). */
function classifyPropertyAccess(expr: import('ts-morph').PropertyAccessExpression): SideEffectType | null {
  const obj = expr.getExpression();
  const method = expr.getName();
  const objText = obj.getText();

  // Standard object.method patterns via dispatch map
  const classifier = PROPERTY_ACCESS_MAP.get(objText);
  if (classifier) return classifier(method);

  // Nested property access: posthog.people.set
  if (
    Node.isPropertyAccessExpression(obj) &&
    obj.getExpression().getText() === 'posthog' &&
    obj.getName() === 'people' &&
    method === 'set'
  ) {
    return 'POSTHOG_CALL';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Assignment-based side effect detection (window.location, document.title, etc.)
// ---------------------------------------------------------------------------

function classifyAssignment(node: Node): SideEffectType | null {
  // BinaryExpression with = operator where the left side is a window/document mutation
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getText();
    if (operator !== '=') return null;

    const left = node.getLeft();
    const leftText = left.getText();

    // window.location, window.location.href, window.location.pathname, etc.
    if (leftText.startsWith('window.location')) {
      return 'WINDOW_MUTATION';
    }

    // document.title
    if (leftText === 'document.title') {
      return 'WINDOW_MUTATION';
    }

    // document.cookie
    if (leftText === 'document.cookie') {
      return 'WINDOW_MUTATION';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main analysis walker
// ---------------------------------------------------------------------------

function findSideEffects(sf: SourceFile): SideEffectInstance[] {
  const sideEffects: SideEffectInstance[] = [];

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // Check call expressions
    const callType = classifyCallExpression(node);
    if (callType) {
      sideEffects.push({
        type: callType,
        line,
        column,
        text: truncateText(node.getText(), 80),
        containingFunction: getContainingFunctionName(node),
        isInsideUseEffect: isInsideUseEffectCallback(node),
      });
      return;
    }

    // Check assignments
    const assignType = classifyAssignment(node);
    if (assignType) {
      sideEffects.push({
        type: assignType,
        line,
        column,
        text: truncateText(node.getText(), 80),
        containingFunction: getContainingFunctionName(node),
        isInsideUseEffect: isInsideUseEffectCallback(node),
      });
    }
  });

  // Sort by line number
  sideEffects.sort((a, b) => a.line - b.line || a.column - b.column);

  return sideEffects;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractSideEffectObservations(sf: SourceFile): SideEffectObservation[] {
  const observations: SideEffectObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;
    const containingFunction = getContainingFunctionName(node);
    const insideEffect = isInsideUseEffectCallback(node);

    // Check call expressions
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();

      // Direct identifier calls: toast(), setTimeout(), sendPosthogEvent(), etc.
      if (Node.isIdentifier(expr)) {
        const name = expr.getText();
        const directType = DIRECT_CALL_MAP.get(name);
        if (directType) {
          observations.push({
            kind: directType,
            file: relativePath,
            line,
            column,
            evidence: {
              object: undefined,
              method: name,
              containingFunction,
              isInsideUseEffect: insideEffect,
            },
          });
          return;
        }
      }

      // Property access calls: console.log(), posthog.capture(), window.open(), etc.
      if (Node.isPropertyAccessExpression(expr)) {
        const obj = expr.getExpression();
        const method = expr.getName();
        const objText = obj.getText();

        // Standard object.method patterns
        const classifier = PROPERTY_ACCESS_MAP.get(objText);
        if (classifier) {
          const type = classifier(method);
          if (type) {
            observations.push({
              kind: type,
              file: relativePath,
              line,
              column,
              evidence: {
                object: objText,
                method,
                containingFunction,
                isInsideUseEffect: insideEffect,
              },
            });
            return;
          }
        }

        // Nested property access: posthog.people.set
        if (
          Node.isPropertyAccessExpression(obj) &&
          obj.getExpression().getText() === 'posthog' &&
          obj.getName() === 'people' &&
          method === 'set'
        ) {
          observations.push({
            kind: 'POSTHOG_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              object: 'posthog.people',
              method: 'set',
              containingFunction,
              isInsideUseEffect: insideEffect,
            },
          });
          return;
        }
      }
    }

    // Check assignments (window.location, document.title, document.cookie)
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getText();
      if (operator !== '=') return;

      const left = node.getLeft();
      const leftText = left.getText();

      // window.location, window.location.href, window.location.pathname, etc.
      if (leftText.startsWith('window.location')) {
        observations.push({
          kind: 'WINDOW_MUTATION',
          file: relativePath,
          line,
          column,
          evidence: {
            object: 'window.location',
            method: undefined,
            containingFunction,
            isInsideUseEffect: insideEffect,
          },
        });
        return;
      }

      // document.title
      if (leftText === 'document.title') {
        observations.push({
          kind: 'WINDOW_MUTATION',
          file: relativePath,
          line,
          column,
          evidence: {
            object: 'document',
            method: 'title',
            containingFunction,
            isInsideUseEffect: insideEffect,
          },
        });
        return;
      }

      // document.cookie
      if (leftText === 'document.cookie') {
        observations.push({
          kind: 'WINDOW_MUTATION',
          file: relativePath,
          line,
          column,
          evidence: {
            object: 'document',
            method: 'cookie',
            containingFunction,
            isInsideUseEffect: insideEffect,
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
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(sideEffects: SideEffectInstance[]): Record<SideEffectType, number> {
  const summary = emptySummary();
  for (const se of sideEffects) {
    summary[se.type]++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeSideEffects(filePath: string): SideEffectsAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const sideEffects = findSideEffects(sf);
  const observations = extractSideEffectObservations(sf);
  const summary = computeSummary(sideEffects);

  return {
    filePath: relativePath,
    sideEffects,
    summary,
    observations,
  };
}

export function analyzeSideEffectsDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): SideEffectsAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: SideEffectsAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('side-effects', fp, () => analyzeSideEffects(fp), options);
    if (analysis.sideEffects.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by total side effects descending
  results.sort((a, b) => b.sideEffects.length - a.sideEffects.length);

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-side-effects.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze side-effect calls (console, toast, timers, posthog, window mutations).\n' +
        '\n' +
        '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute (also refreshes cache)\n' +
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

  const allResults: SideEffectsAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeSideEffectsDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('side-effects', absolute, () => analyzeSideEffects(absolute), { noCache });
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
  process.argv[1] && (process.argv[1].endsWith('ast-side-effects.ts') || process.argv[1].endsWith('ast-side-effects'));

if (isDirectRun) {
  main();
}
