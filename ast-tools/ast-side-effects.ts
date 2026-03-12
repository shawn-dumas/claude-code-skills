import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { SideEffectsAnalysis, SideEffectInstance, SideEffectType } from './types';

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
// Side effect patterns
// ---------------------------------------------------------------------------

const CONSOLE_METHODS = new Set(['log', 'debug', 'info', 'warn', 'error', 'trace', 'dir', 'table']);

const TIMER_FUNCTIONS = new Set([
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'clearTimeout',
  'clearInterval',
]);

const POSTHOG_DIRECT_CALLS = new Set(['sendPosthogEvent']);

const POSTHOG_METHOD_CALLS = new Set(['capture', 'identify', 'reset', 'register']);

const WINDOW_MUTATION_CALLS = new Set(['pushState', 'replaceState', 'open']);

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
  const exprText = expr.getText();

  // --- CONSOLE_CALL: console.log, console.warn, etc. ---
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression();
    const method = expr.getName();
    if (obj.getText() === 'console' && CONSOLE_METHODS.has(method)) {
      return 'CONSOLE_CALL';
    }
  }

  // --- TOAST_CALL: toast(), toast.success(), etc. ---
  if (exprText === 'toast') {
    return 'TOAST_CALL';
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression();
    if (obj.getText() === 'toast') {
      return 'TOAST_CALL';
    }
  }

  // --- TIMER_CALL: setTimeout, setInterval, etc. ---
  if (Node.isIdentifier(expr) && TIMER_FUNCTIONS.has(exprText)) {
    return 'TIMER_CALL';
  }

  // --- POSTHOG_CALL: sendPosthogEvent, posthog.capture, etc. ---
  if (Node.isIdentifier(expr) && POSTHOG_DIRECT_CALLS.has(exprText)) {
    return 'POSTHOG_CALL';
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression();
    const method = expr.getName();
    // posthog.capture, posthog.identify, posthog.reset, posthog.register
    if (obj.getText() === 'posthog' && POSTHOG_METHOD_CALLS.has(method)) {
      return 'POSTHOG_CALL';
    }
    // posthog.people.set
    if (Node.isPropertyAccessExpression(obj)) {
      const outerObj = obj.getExpression();
      if (outerObj.getText() === 'posthog' && obj.getName() === 'people' && method === 'set') {
        return 'POSTHOG_CALL';
      }
    }
  }

  // --- WINDOW_MUTATION: window.open, history.pushState, history.replaceState ---
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression();
    const method = expr.getName();
    const objText = obj.getText();

    if (objText === 'window' && method === 'open') {
      return 'WINDOW_MUTATION';
    }
    if (objText === 'history' && WINDOW_MUTATION_CALLS.has(method)) {
      return 'WINDOW_MUTATION';
    }
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
  const summary = computeSummary(sideEffects);

  return {
    filePath: relativePath,
    sideEffects,
    summary,
  };
}

export function analyzeSideEffectsDirectory(dirPath: string): SideEffectsAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: SideEffectsAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeSideEffects(fp);
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
      'Usage: npx tsx scripts/AST/ast-side-effects.ts <path...> [--pretty]\n' +
        '\n' +
        'Analyze side-effect calls (console, toast, timers, posthog, window mutations).\n' +
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
    const results = analyzeSideEffectsDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeSideEffects(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-side-effects.ts') || process.argv[1].endsWith('ast-side-effects'));

if (isDirectRun) {
  main();
}
