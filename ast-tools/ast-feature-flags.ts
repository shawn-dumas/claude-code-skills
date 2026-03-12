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
// Known feature flag names (from FeatureFlagsToLoad values)
// ---------------------------------------------------------------------------

const KNOWN_FLAG_NAMES = new Set([
  'insights_chat_enabled',
  'enable_details',
  'enable_realtime_insights',
  'workstream_analysis_insights_enabled',
  'analyzer_insights_enabled',
  'filters_date-range_max_days',
  'enable_last_event_date_on_users_table',
  'relay_usage_insights_enabled',
  'favorite_usage_insights_enabled',
  'opportunities_insights_enabled',
  'systems_insights_enabled',
  'system_latency_insights_enabled',
]);

// ---------------------------------------------------------------------------
// featureFlags binding detection
// ---------------------------------------------------------------------------

/**
 * Collect the names of local variables that hold a featureFlags object.
 * Patterns:
 *   const { featureFlags } = usePosthogContext();
 *   const featureFlags = useFeatureFlags();
 */
function collectFeatureFlagBindings(sf: SourceFile): Set<string> {
  const bindings = new Set<string>();

  sf.forEachDescendant(node => {
    if (!Node.isVariableDeclaration(node)) return;

    const init = node.getInitializer();
    if (!init) return;

    // const featureFlags = useFeatureFlags();
    if (Node.isCallExpression(init)) {
      const callee = init.getExpression().getText();
      if (callee === 'useFeatureFlags') {
        bindings.add(node.getName());
      }
    }

    // const { featureFlags } = usePosthogContext();
    // Handled via the destructuring pattern: the binding name is "featureFlags"
    // in the BindingElement. The VariableDeclaration name for object binding
    // patterns is not directly useful. We detect this by walking BindingElements.
  });

  // Walk ObjectBindingPatterns for destructured featureFlags
  sf.forEachDescendant(node => {
    if (!Node.isBindingElement(node)) return;
    if (node.getName() !== 'featureFlags') return;

    // Verify the parent variable declaration initializes from a relevant call
    let current: Node | undefined = node.getParent();
    while (current && !Node.isVariableDeclaration(current)) {
      current = current.getParent();
    }
    if (!current || !Node.isVariableDeclaration(current)) return;

    const init = current.getInitializer();
    if (init && Node.isCallExpression(init)) {
      const callee = init.getExpression().getText();
      if (callee === 'usePosthogContext' || callee === 'useFeatureFlags') {
        bindings.add('featureFlags');
      }
    }
  });

  return bindings;
}

// ---------------------------------------------------------------------------
// Usage detectors
// ---------------------------------------------------------------------------

function findUsages(sf: SourceFile): FeatureFlagUsage[] {
  const usages: FeatureFlagUsage[] = [];
  const flagBindings = collectFeatureFlagBindings(sf);

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // --- FLAG_HOOK_CALL: useFeatureFlags() or usePosthogContext() with featureFlags destructured ---
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression().getText();

      if (callee === 'useFeatureFlags') {
        usages.push({
          type: 'FLAG_HOOK_CALL',
          line,
          column,
          flagName: null,
          containingFunction: getContainingFunctionName(node),
          text: truncateText(node.getText(), 80),
        });
        return;
      }

      if (callee === 'usePosthogContext') {
        // Check if featureFlags is destructured from the result
        const parent = node.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          const nameNode = parent.getNameNode();
          if (Node.isObjectBindingPattern(nameNode)) {
            const elements = nameNode.getElements();
            const hasFeatureFlags = elements.some(el => el.getName() === 'featureFlags');
            if (hasFeatureFlags) {
              usages.push({
                type: 'FLAG_HOOK_CALL',
                line,
                column,
                flagName: null,
                containingFunction: getContainingFunctionName(node),
                text: truncateText(node.getText(), 80),
              });
            }
          }
        }
        return;
      }

      // --- PAGE_GUARD: useFeatureFlagPageGuard('flag_name') ---
      if (callee === 'useFeatureFlagPageGuard') {
        const args = node.getArguments();
        let flagName: string | null = null;
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          flagName = args[0].getLiteralValue();
        }
        usages.push({
          type: 'PAGE_GUARD',
          line,
          column,
          flagName,
          containingFunction: getContainingFunctionName(node),
          text: truncateText(node.getText(), 80),
        });
        return;
      }

      // --- FLAG_OVERRIDE: __setFeatureFlags or __clearFeatureFlags ---
      if (callee === '__setFeatureFlags' || callee === '__clearFeatureFlags') {
        usages.push({
          type: 'FLAG_OVERRIDE',
          line,
          column,
          flagName: null,
          containingFunction: getContainingFunctionName(node),
          text: truncateText(node.getText(), 80),
        });
        return;
      }
    }

    // --- NAV_TAB_GATE: object literal with a `featureFlag` property ---
    if (Node.isPropertyAssignment(node)) {
      if (node.getName() === 'featureFlag') {
        const init = node.getInitializer();
        let flagName: string | null = null;
        if (init && Node.isStringLiteral(init)) {
          flagName = init.getLiteralValue();
        }
        usages.push({
          type: 'NAV_TAB_GATE',
          line,
          column,
          flagName,
          containingFunction: getContainingFunctionName(node),
          text: truncateText(node.getParent()?.getText() ?? node.getText(), 80),
        });
        return;
      }
    }

    // --- FLAG_READ: property access on a featureFlags binding ---
    if (Node.isPropertyAccessExpression(node)) {
      const objText = node.getExpression().getText();
      if (flagBindings.has(objText)) {
        const propName = node.getName();

        // Check if this property access is part of a JSX conditional
        // (handled by CONDITIONAL_RENDER below). We skip it here and let
        // the conditional render check handle it to avoid double-counting.
        if (isInsideJsxConditional(node, flagBindings)) {
          return;
        }

        usages.push({
          type: 'FLAG_READ',
          line,
          column,
          flagName: propName,
          containingFunction: getContainingFunctionName(node),
          text: truncateText(node.getText(), 80),
        });
        return;
      }
    }

    // --- CONDITIONAL_RENDER: JSX conditionals gated on a flag ---
    // Pattern 1: featureFlags.x && <Component />  (within JsxExpression)
    // Pattern 2: featureFlags.x ? <A /> : <B />   (within JsxExpression)
    if (Node.isJsxExpression(node)) {
      const expr = node.getExpression();
      if (!expr) return;

      // Ternary: featureFlags.x ? <A /> : <B />
      if (Node.isConditionalExpression(expr)) {
        const condition = expr.getCondition();
        const flagName = extractFlagFromExpression(condition, flagBindings);
        if (flagName) {
          usages.push({
            type: 'CONDITIONAL_RENDER',
            line,
            column,
            flagName,
            containingFunction: getContainingFunctionName(node),
            text: truncateText(node.getText(), 80),
          });
          return;
        }
      }

      // Binary &&: featureFlags.x && <Component />
      if (Node.isBinaryExpression(expr)) {
        const operator = expr.getOperatorToken().getText();
        if (operator === '&&') {
          const left = expr.getLeft();
          const flagName = extractFlagFromExpression(left, flagBindings);
          if (flagName) {
            usages.push({
              type: 'CONDITIONAL_RENDER',
              line,
              column,
              flagName,
              containingFunction: getContainingFunctionName(node),
              text: truncateText(node.getText(), 80),
            });
            return;
          }
        }
      }
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

function analyzeFeatureFlagsDirectory(dirPath: string): FeatureFlagAnalysis[] {
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
