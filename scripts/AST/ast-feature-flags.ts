import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import { getSourceFile, PROJECT_ROOT } from './project';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import type { FeatureFlagAnalysis, FeatureFlagUsage, FeatureFlagUsageType, FeatureFlagObservation } from './types';
import { astConfig } from './ast-config';
import { cached } from './ast-cache';

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
// featureFlags binding detection
// ---------------------------------------------------------------------------

/** Detect `const featureFlags = useFeatureFlags();` direct assignment patterns. */
function collectDirectAssignmentBindings(sf: SourceFile, bindings: Set<string>): void {
  sf.forEachDescendant(node => {
    if (!Node.isVariableDeclaration(node)) return;

    const init = node.getInitializer();
    if (!init || !Node.isCallExpression(init)) return;

    if (astConfig.featureFlags.flagHooks.has(init.getExpression().getText())) {
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
    if (node.getName() !== astConfig.featureFlags.flagBindingName) return;

    const decl = findOwningVariableDeclaration(node);
    if (!decl || !Node.isVariableDeclaration(decl)) return;

    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) return;

    if (astConfig.featureFlags.flagHooks.has(init.getExpression().getText())) {
      bindings.add(astConfig.featureFlags.flagBindingName);
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

  if (!astConfig.featureFlags.flagHooks.has(callee)) return null;

  // For usePosthogContext, verify that featureFlags is destructured
  if (callee === 'usePosthogContext') {
    const parent = node.getParent();
    if (!parent || !Node.isVariableDeclaration(parent)) return null;

    const nameNode = parent.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) return null;

    const hasFeatureFlags = nameNode.getElements().some(el => el.getName() === astConfig.featureFlags.flagBindingName);
    if (!hasFeatureFlags) return null;
  }

  return {
    type: 'FLAG_HOOK_CALL',
    line: ctx.line,
    column: ctx.column,
    flagName: null,
    containingFunction: getContainingFunctionName(node),
    text: truncateText(node.getText(), 80),
  };
}

/** Classify useFeatureFlagPageGuard() calls. */
function classifyPageGuard(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression().getText();
  if (callee !== astConfig.featureFlags.pageGuardHook) return null;

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

/** Classify __setFeatureFlags and __clearFeatureFlags calls. */
function classifyFlagOverride(node: Node, ctx: FlagNodeContext): FeatureFlagUsage | null {
  if (!Node.isCallExpression(node)) return null;

  const callee = node.getExpression().getText();
  if (!astConfig.featureFlags.overrideFunctions.has(callee)) return null;

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
  if (node.getName() !== astConfig.featureFlags.tabGateProperty) return null;

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
// Observation extraction
// ---------------------------------------------------------------------------

export function extractFeatureFlagObservations(sf: SourceFile): FeatureFlagObservation[] {
  const observations: FeatureFlagObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());
  const flagBindings = collectFeatureFlagBindings(sf);

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;
    const containingFunction = getContainingFunctionName(node);

    // FLAG_HOOK_CALL: useFeatureFlags() or usePosthogContext() with featureFlags destructured
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression().getText();

      if (astConfig.featureFlags.flagHooks.has(callee)) {
        // For usePosthogContext, check if featureFlags is destructured
        let destructuredBindings: string[] | undefined;
        if (callee === 'usePosthogContext') {
          const parent = node.getParent();
          if (parent && Node.isVariableDeclaration(parent)) {
            const nameNode = parent.getNameNode();
            if (Node.isObjectBindingPattern(nameNode)) {
              const hasFeatureFlags = nameNode
                .getElements()
                .some(el => el.getName() === astConfig.featureFlags.flagBindingName);
              if (!hasFeatureFlags) return; // Skip if featureFlags not destructured
              destructuredBindings = nameNode.getElements().map(el => el.getName());
            } else {
              return; // Skip if not destructuring
            }
          } else {
            return; // Skip if not in a variable declaration
          }
        }

        observations.push({
          kind: 'FLAG_HOOK_CALL',
          file: relativePath,
          line,
          column,
          evidence: {
            hookName: callee,
            containingFunction,
            destructuredBindings,
          },
        });
        return;
      }

      // PAGE_GUARD: useFeatureFlagPageGuard()
      if (callee === astConfig.featureFlags.pageGuardHook) {
        const args = node.getArguments();
        const flagName = args.length > 0 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : undefined;
        observations.push({
          kind: 'PAGE_GUARD',
          file: relativePath,
          line,
          column,
          evidence: {
            hookName: callee,
            flagName,
            containingFunction,
          },
        });
        return;
      }

      // FLAG_OVERRIDE: __setFeatureFlags, __clearFeatureFlags
      if (astConfig.featureFlags.overrideFunctions.has(callee)) {
        observations.push({
          kind: 'FLAG_OVERRIDE',
          file: relativePath,
          line,
          column,
          evidence: {
            hookName: callee,
            containingFunction,
          },
        });
        return;
      }
    }

    // NAV_TAB_GATE: featureFlag property in object literal
    if (Node.isPropertyAssignment(node)) {
      if (node.getName() === astConfig.featureFlags.tabGateProperty) {
        const init = node.getInitializer();
        const flagName = init && Node.isStringLiteral(init) ? init.getLiteralValue() : undefined;
        observations.push({
          kind: 'NAV_TAB_GATE',
          file: relativePath,
          line,
          column,
          evidence: {
            flagName,
            containingFunction,
          },
        });
        return;
      }
    }

    // FLAG_READ: property access on featureFlags binding (non-JSX-conditional)
    if (Node.isPropertyAccessExpression(node)) {
      const objText = node.getExpression().getText();
      if (flagBindings.has(objText)) {
        // Skip reads inside JSX conditionals
        if (isInsideJsxConditional(node, flagBindings)) return;

        observations.push({
          kind: 'FLAG_READ',
          file: relativePath,
          line,
          column,
          evidence: {
            flagName: node.getName(),
            containingFunction,
          },
        });
        return;
      }
    }

    // CONDITIONAL_RENDER: JSX conditionals gated on a feature flag
    if (Node.isJsxExpression(node)) {
      const expr = node.getExpression();
      if (!expr) return;

      // Ternary: featureFlags.x ? <A /> : <B />
      if (Node.isConditionalExpression(expr)) {
        const flagName = extractFlagFromExpression(expr.getCondition(), flagBindings);
        if (flagName) {
          observations.push({
            kind: 'CONDITIONAL_RENDER',
            file: relativePath,
            line,
            column,
            evidence: {
              flagName,
              containingFunction,
            },
          });
          return;
        }
      }

      // Binary &&: featureFlags.x && <Component />
      if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '&&') {
        const flagName = extractFlagFromExpression(expr.getLeft(), flagBindings);
        if (flagName) {
          observations.push({
            kind: 'CONDITIONAL_RENDER',
            file: relativePath,
            line,
            column,
            evidence: {
              flagName,
              containingFunction,
            },
          });
        }
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
  const observations = extractFeatureFlagObservations(sf);
  const summary = computeSummary(usages);
  const flagsReferenced = extractFlagsReferenced(usages);

  return {
    filePath: relativePath,
    usages,
    flagsReferenced,
    summary,
    observations,
  };
}

export function analyzeFeatureFlagsDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): FeatureFlagAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: FeatureFlagAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-feature-flags', fp, () => analyzeFeatureFlags(fp), options);
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

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-feature-flags.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
  '\n' +
  'Analyze feature flag consumption and gating patterns.\n' +
  '\n' +
  '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --no-cache    Bypass cache and recompute\n' +
  '  --test-files  Scan test files instead of production files\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<FeatureFlagAnalysis> = {
  cacheNamespace: 'ast-feature-flags',
  helpText: HELP_TEXT,
  analyzeFile: analyzeFeatureFlags,
  analyzeDirectory: analyzeFeatureFlagsDirectory,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-feature-flags.ts') || process.argv[1].endsWith('ast-feature-flags'));
if (isDirectRun) runObservationToolCli(cliConfig);
