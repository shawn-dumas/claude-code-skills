import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { FeatureFlagAnalysis, FeatureFlagUsage, FeatureFlagUsageType } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): Record<FeatureFlagUsageType, number> {
  return {
    FLAG_HOOK_CALL: 0,
    FLAG_READ: 0,
    PAGE_GUARD: 0,
    NAV_TAB_GATE: 0,
    CONDITIONAL_RENDER: 0,
    FLAG_OVERRIDE: 0,
  };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// featureFlags binding detection
// ---------------------------------------------------------------------------

const FEATURE_FLAG_HOOKS = new Set(['usePosthogContext', 'useFeatureFlags']);

/** Detect `const featureFlags = useFeatureFlags();` direct assignment patterns. */
function collectDirectAssignmentBindings(sf: SourceFile, bindings: Set<string>): void {
  sf.forEachDescendant(node => {
    if (!Node.isVariableDeclaration(node)) return;

    const init = node.getInitializer();
    if (!init || !Node.isCallExpression(init)) return;

    if (init.getExpression().getText() === 'useFeatureFlags') {
      bindings.add(node.getName());
    }
  });
}

/** Walk up from a BindingElement to its owning VariableDeclaration. */
function findOwningVariableDeclaration(node: Node): Node | undefined {
  let current: Node | undefined = node.getParent();
  while (current && !Node.isVariableDeclaration(current)) {
    current = current.getParent();
  }
  return current;
}

/** Detect `const { featureFlags } = usePosthogContext();` destructuring patterns. */
function collectDestructuredBindings(sf: SourceFile, bindings: Set<string>): void {
  sf.forEachDescendant(node => {
    if (!Node.isBindingElement(node)) return;
    if (node.getName() !== 'featureFlags') return;

    const decl = findOwningVariableDeclaration(node);
    if (!decl || !Node.isVariableDeclaration(decl)) return;

    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) return;

    if (FEATURE_FLAG_HOOKS.has(init.getExpression().getText())) {
      bindings.add('featureFlags');
    }
  });
}

/**
 * Collect the names of local variables that hold a featureFlags object.
 * Patterns:
 *   const { featureFlags } = usePosthogContext();
 *   const featureFlags = useFeatureFlags();
 */
function collectFeatureFlagBindings(sf: SourceFile): Set<string> {
  const bindings = new Set<string>();
  collectDirectAssignmentBindings(sf, bindings);
  collectDestructuredBindings(sf, bindings);
  return bindings;
}

// ---------------------------------------------------------------------------
// Per-category classifiers
// ---------------------------------------------------------------------------

interface FlagNodeContext {
  line: number;
  column: number;
  flagBindings: Set<string>;
}

/** Classify useFeatureFlags() and usePosthogContext() calls that access feature flags. */
function classifyFlagHookCall(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression().getText();

  if (callee === 'useFeatureFlags') {
    return {
      type: 'FLAG_HOOK_CALL',
      line: ctx.line,
      column: ctx.column,
      flagName: null,
      containingFunction: getContainingFunctionName(node),
      text: truncateText(node.getText(), 80),
    };
  }

  if (callee === 'usePosthogContext') {
    const parent = node.getParent();
    if (!parent || !Node.isVariableDeclaration(parent)) return null;

    const nameNode = parent.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) return null;

    const hasFeatureFlags = nameNode.getElements().some(el => el.getName() === 'featureFlags');
    if (!hasFeatureFlags) return null;

    return {
      type: 'FLAG_HOOK_CALL',
      line: ctx.line,
      column: ctx.column,
      flagName: null,
      containingFunction: getContainingFunctionName(node),
      text: truncateText(node.getText(), 80),
    };
  }

  return null;
}

/** Classify useFeatureFlagPageGuard() calls. */
function classifyPageGuard(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression().getText();
  if (callee !== 'useFeatureFlagPageGuard') return null;

  const args = node.getArguments();
  const flagName = args.length > 0 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : null;

  return {
    type: 'PAGE_GUARD',
    line: ctx.line,
    column: ctx.column,
    flagName,
    containingFunction: getContainingFunctionName(node),
    text: truncateText(node.getText(), 80),
  };
}

const FLAG_OVERRIDE_FNS = new Set(['__setFeatureFlags', '__clearFeatureFlags']);

/** Classify __setFeatureFlags and __clearFeatureFlags calls. */
function classifyFlagOverride(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression().getText();
  if (!FLAG_OVERRIDE_FNS.has(callee)) return null;

  return {
    type: 'FLAG_OVERRIDE',
    line: ctx.line,
    column: ctx.column,
    flagName: null,
    containingFunction: getContainingFunctionName(node),
    text: truncateText(node.getText(), 80),
  };
}

/** Classify navigation tab gating via `featureFlag` property assignments. */
function classifyNavTabGate(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isPropertyAssignment(node)) return null;
  if (node.getName() !== 'featureFlag') return null;

  const init = node.getInitializer();
  const flagName = init && Node.isStringLiteral(init) ? init.getLiteralValue() : null;

  return {
    type: 'NAV_TAB_GATE',
    line: ctx.line,
    column: ctx.column,
    flagName,
    containingFunction: getContainingFunctionName(node),
    text: truncateText(node.getParent()?.getText() ?? node.getText(), 80),
  };
}

/** Classify property access on a featureFlags binding (non-JSX-conditional reads). */
function classifyFlagRead(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isPropertyAccessExpression(node)) return null;

  const objText = node.getExpression().getText();
  if (!ctx.flagBindings.has(objText)) return null;

  // Skip reads inside JSX conditionals -- handled by classifyConditionalRender
  if (isInsideJsxConditional(node, ctx.flagBindings)) return null;

  return {
    type: 'FLAG_READ',
    line: ctx.line,
    column: ctx.column,
    flagName: node.getName(),
    containingFunction: getContainingFunctionName(node),
    text: truncateText(node.getText(), 80),
  };
}

/** Classify JSX conditionals gated on a feature flag (ternary or && guard). */
function classifyConditionalRender(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isJsxExpression(node)) return null;

  const expr = node.getExpression();
  if (!expr) return null;

  // Ternary: featureFlags.x ? <A /> : <B />
  if (Node.isConditionalExpression(expr)) {
    const flagName = extractFlagFromExpression(expr.getCondition(), ctx.flagBindings);
    if (flagName) {
      return {
        type: 'CONDITIONAL_RENDER',
        line: ctx.line,
        column: ctx.column,
        flagName,
        containingFunction: getContainingFunctionName(node),
        text: truncateText(node.getText(), 80),
      };
    }
  }

  // Binary &&: featureFlags.x && <Component />
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '&&') {
    const flagName = extractFlagFromExpression(expr.getLeft(), ctx.flagBindings);
    if (flagName) {
      return {
        type: 'CONDITIONAL_RENDER',
        line: ctx.line,
        column: ctx.column,
        flagName,
        containingFunction: getContainingFunctionName(node),
        text: truncateText(node.getText(), 80),
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Usage walker
// ---------------------------------------------------------------------------

function findUsages(sf: SourceFile): FeatureFlagUsage[] {
  const usages: FeatureFlagUsage[] = [];
  const flagBindings = collectFeatureFlagBindings(sf);

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;
    const ctx: FlagNodeContext = { line, column, flagBindings };

    const result =
      classifyFlagHookCall(node, ctx) ??
      classifyPageGuard(node, ctx) ??
      classifyFlagOverride(node, ctx) ??
      classifyNavTabGate(node, ctx) ??
      classifyFlagRead(node, ctx) ??
      classifyConditionalRender(node, ctx);

    if (result) {
      usages.push(result);
    }
  });

  // Sort by line number
  usages.sort((a, b) => a.line - b.line || a.column - b.column);

  return usages;
}

// ---------------------------------------------------------------------------
// JSX conditional detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if a PropertyAccessExpression on featureFlags is inside a JSX
 * conditional (&&  or ternary within a JsxExpression). Used to avoid
 * double-counting as both FLAG_READ and CONDITIONAL_RENDER.
 */
function isInsideJsxConditional(node: Node, flagBindings: Set<string>): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isJsxExpression(current)) {
      const expr = current.getExpression();
      if (!expr) return false;

      if (Node.isConditionalExpression(expr)) {
        const flagName = extractFlagFromExpression(expr.getCondition(), flagBindings);
        if (flagName) return true;
      }

      if (Node.isBinaryExpression(expr)) {
        const operator = expr.getOperatorToken().getText();
        if (operator === '&&') {
          const flagName = extractFlagFromExpression(expr.getLeft(), flagBindings);
          if (flagName) return true;
        }
      }

      return false;
    }
    // Don't walk past statement boundaries
    if (Node.isStatement(current)) return false;
    current = current.getParent();
  }
  return false;
}

/**
 * Extract a flag name from an expression that is a property access on
 * a featureFlags binding.
 */
function extractFlagFromExpression(expr: Node, flagBindings: Set<string>): string | null {
  if (Node.isPropertyAccessExpression(expr)) {
    const objText = expr.getExpression().getText();
    if (flagBindings.has(objText)) {
      return expr.getName();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(usages: FeatureFlagUsage[]): Record<FeatureFlagUsageType, number> {
  const summary = emptySummary();
  for (const u of usages) {
    summary[u.type]++;
  }
  return summary;
}

function extractFlagsReferenced(usages: FeatureFlagUsage[]): string[] {
  const flags = new Set<string>();
  for (const u of usages) {
    if (u.flagName) {
      flags.add(u.flagName);
    }
  }
  return [...flags].sort();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeFeatureFlags(filePath: string): FeatureFlagAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const usages = findUsages(sf);
  const summary = computeSummary(usages);
  const flagsReferenced = extractFlagsReferenced(usages);

  return {
    filePath: relativePath,
    usages,
    flagsReferenced,
    summary,
  };
}

export function analyzeFeatureFlagsDirectory(dirPath: string): FeatureFlagAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: FeatureFlagAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeFeatureFlags(fp);
    if (analysis.usages.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by total usages descending
  results.sort((a, b) => b.usages.length - a.usages.length);

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-feature-flags.ts <path...> [--pretty]\n' +
        '\n' +
        'Analyze feature flag consumption and gating patterns.\n' +
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
    const results = analyzeFeatureFlagsDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeFeatureFlags(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-feature-flags.ts') || process.argv[1].endsWith('ast-feature-flags'));

if (isDirectRun) {
  main();
}
