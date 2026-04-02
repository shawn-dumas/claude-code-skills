import { type SourceFile, Node, SyntaxKind } from 'ts-morph';
import path from 'path';
import { getSourceFile, PROJECT_ROOT } from './project';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { getFilesInDirectory, getContainingFunctionName, truncateText, type FileFilter } from './shared';
import type { BehavioralAnalysis, BehavioralObservation, BehavioralObservationKind } from './types';
import { astConfig } from './ast-config';
import { cached } from './ast-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a binding element (destructured parameter) has a default value
 * and extract both the name and value text.
 */
function extractDefaultPropValue(node: Node): { name: string; value: string } | null {
  if (!Node.isBindingElement(node)) return null;
  const initializer = node.getInitializer();
  if (!initializer) return null;
  const name = node.getName();
  if (astConfig.behavioral.ignoredDefaultProps.has(name)) return null;
  return { name, value: truncateText(initializer.getText(), 80) };
}

/**
 * Check whether a node is inside JSX (JsxElement, JsxSelfClosingElement, JsxFragment).
 */
function isInsideJsx(node: Node): boolean {
  const JSX_KINDS = new Set([SyntaxKind.JsxElement, SyntaxKind.JsxSelfClosingElement, SyntaxKind.JsxFragment]);
  let current: Node | undefined = node.getParent();
  while (current && !JSX_KINDS.has(current.getKind())) {
    current = current.getParent();
  }
  return current !== undefined && JSX_KINDS.has(current.getKind());
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractBehavioralObservations(sf: SourceFile): BehavioralObservation[] {
  const observations: BehavioralObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const containingFunction = getContainingFunctionName(node);

    // --- 1. DEFAULT_PROP_VALUE: destructured parameter defaults ---
    if (Node.isBindingElement(node)) {
      const result = extractDefaultPropValue(node);
      if (result) {
        observations.push({
          kind: 'DEFAULT_PROP_VALUE',
          file: relativePath,
          line,
          evidence: {
            category: 'default-values',
            name: result.name,
            value: result.value,
            containingFunction,
          },
        });
      }
    }

    // --- 2. RENDER_CAP: .slice(0, N) and limit-like props ---
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName();
        if (astConfig.behavioral.renderCapMethods.has(methodName)) {
          const args = node.getArguments();
          // .slice(0, N) pattern: first arg is 0, second arg is a number literal
          if (
            args.length >= 2 &&
            Node.isNumericLiteral(args[0]) &&
            args[0].getLiteralValue() === 0 &&
            Node.isNumericLiteral(args[1])
          ) {
            observations.push({
              kind: 'RENDER_CAP',
              file: relativePath,
              line,
              evidence: {
                category: 'value-caps',
                name: methodName,
                value: args[1].getText(),
              },
            });
          }
        }
      }
    }

    // RENDER_CAP: props named maxItems/maxRows/limit/pageSize with number literal defaults
    if (Node.isBindingElement(node)) {
      const name = node.getName();
      if (/^(maxItems|maxRows|limit|pageSize)$/.test(name)) {
        const initializer = node.getInitializer();
        if (initializer && Node.isNumericLiteral(initializer)) {
          observations.push({
            kind: 'RENDER_CAP',
            file: relativePath,
            line,
            evidence: {
              category: 'value-caps',
              name,
              value: initializer.getText(),
            },
          });
        }
      }
    }

    // --- 3. NULL_COERCION_DISPLAY: ?? and || with string literal RHS ---
    if (Node.isBinaryExpression(node)) {
      const operatorToken = node.getOperatorToken().getText();
      const right = node.getRight();

      if ((operatorToken === '??' || operatorToken === '||') && Node.isStringLiteral(right)) {
        const value = right.getLiteralValue();
        observations.push({
          kind: 'NULL_COERCION_DISPLAY',
          file: relativePath,
          line,
          evidence: {
            category: 'null-empty-display',
            value: `'${value}'`,
          },
        });
      }
    }

    // --- 4. CONDITIONAL_RENDER_GUARD: && guards and ternaries in JSX ---
    // && guard: condition && <JSX>
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '&&') {
      const right = node.getRight();
      if (
        right.getKind() === SyntaxKind.JsxElement ||
        right.getKind() === SyntaxKind.JsxSelfClosingElement ||
        right.getKind() === SyntaxKind.JsxFragment ||
        right.getKind() === SyntaxKind.ParenthesizedExpression
      ) {
        // Check if right side (possibly parenthesized) contains JSX
        let hasJsx =
          right.getKind() === SyntaxKind.JsxElement ||
          right.getKind() === SyntaxKind.JsxSelfClosingElement ||
          right.getKind() === SyntaxKind.JsxFragment;
        if (!hasJsx) {
          right.forEachDescendant(child => {
            if (hasJsx) return;
            const ck = child.getKind();
            if (
              ck === SyntaxKind.JsxElement ||
              ck === SyntaxKind.JsxSelfClosingElement ||
              ck === SyntaxKind.JsxFragment
            ) {
              hasJsx = true;
            }
          });
        }
        if (hasJsx) {
          observations.push({
            kind: 'CONDITIONAL_RENDER_GUARD',
            file: relativePath,
            line,
            evidence: {
              category: 'conditional-visibility',
              value: truncateText(node.getLeft().getText(), 80),
            },
          });
        }
      }
    }

    // Ternary with JSX branches
    if (Node.isConditionalExpression(node)) {
      const whenTrue = node.getWhenTrue();
      const whenFalse = node.getWhenFalse();
      const hasJsxBranch = (n: Node): boolean => {
        const k = n.getKind();
        if (k === SyntaxKind.JsxElement || k === SyntaxKind.JsxSelfClosingElement || k === SyntaxKind.JsxFragment) {
          return true;
        }
        let found = false;
        n.forEachDescendant(child => {
          if (found) return;
          const ck = child.getKind();
          if (
            ck === SyntaxKind.JsxElement ||
            ck === SyntaxKind.JsxSelfClosingElement ||
            ck === SyntaxKind.JsxFragment
          ) {
            found = true;
          }
        });
        return found;
      };

      if (hasJsxBranch(whenTrue) || hasJsxBranch(whenFalse)) {
        observations.push({
          kind: 'CONDITIONAL_RENDER_GUARD',
          file: relativePath,
          line,
          evidence: {
            category: 'conditional-visibility',
            value: truncateText(node.getCondition().getText(), 80),
          },
        });
      }
    }

    // --- 5. JSX_STRING_LITERAL: string literals in JSX ---
    // JSX text content
    if (Node.isJsxText(node)) {
      const text = node.getText().trim();
      if (text.length >= astConfig.behavioral.jsxStringLiteralMinLength) {
        observations.push({
          kind: 'JSX_STRING_LITERAL',
          file: relativePath,
          line,
          evidence: {
            category: 'string-literal-parity',
            value: truncateText(text, 80),
          },
        });
      }
    }

    // JSX attribute string values (aria-label, placeholder, title, alt)
    if (Node.isJsxAttribute(node)) {
      const attrName = node.getNameNode().getText();
      const initializer = node.getInitializer();
      if (initializer && Node.isStringLiteral(initializer)) {
        const value = initializer.getLiteralValue();
        if (value.length >= astConfig.behavioral.jsxStringLiteralMinLength) {
          observations.push({
            kind: 'JSX_STRING_LITERAL',
            file: relativePath,
            line,
            evidence: {
              category: 'string-literal-parity',
              value,
              context: attrName,
            },
          });
        }
      }
    }

    // JSX expression containers with string literals
    if (Node.isJsxExpression(node) && isInsideJsx(node)) {
      const expr = node.getExpression();
      if (expr && Node.isStringLiteral(expr)) {
        const value = expr.getLiteralValue();
        if (value.length >= astConfig.behavioral.jsxStringLiteralMinLength) {
          observations.push({
            kind: 'JSX_STRING_LITERAL',
            file: relativePath,
            line,
            evidence: {
              category: 'string-literal-parity',
              value,
            },
          });
        }
      }
    }

    // --- 6. COLUMN_DEFINITION: columnHelper.accessor/display/group calls ---
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName();
        const objText = expr.getExpression().getText();
        if (astConfig.behavioral.columnDefMethods.has(methodName) && objText.endsWith('columnHelper')) {
          const args = node.getArguments();
          let columnId: string | undefined;
          let headerText: string | undefined;

          // accessor('fieldName', { header: 'Header' })
          if (methodName === 'accessor' && args.length >= 1) {
            if (Node.isStringLiteral(args[0])) {
              columnId = args[0].getLiteralValue();
            }
            // Look for header in options object
            const optionsArg = args[1];
            if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
              const headerProp = optionsArg.getProperty('header');
              if (headerProp && Node.isPropertyAssignment(headerProp)) {
                const headerInit = headerProp.getInitializer();
                if (headerInit && Node.isStringLiteral(headerInit)) {
                  headerText = headerInit.getLiteralValue();
                }
              }
            }
          }

          // display({ id: 'actions', header: 'Actions' })
          if ((methodName === 'display' || methodName === 'group') && args.length >= 1) {
            const optionsArg = args[0];
            if (Node.isObjectLiteralExpression(optionsArg)) {
              const idProp = optionsArg.getProperty('id');
              if (idProp && Node.isPropertyAssignment(idProp)) {
                const idInit = idProp.getInitializer();
                if (idInit && Node.isStringLiteral(idInit)) {
                  columnId = idInit.getLiteralValue();
                }
              }
              const headerProp = optionsArg.getProperty('header');
              if (headerProp && Node.isPropertyAssignment(headerProp)) {
                const headerInit = headerProp.getInitializer();
                if (headerInit && Node.isStringLiteral(headerInit)) {
                  headerText = headerInit.getLiteralValue();
                }
              }
            }
          }

          observations.push({
            kind: 'COLUMN_DEFINITION',
            file: relativePath,
            line,
            evidence: {
              category: 'column-field-parity',
              name: columnId,
              value: headerText,
            },
          });
        }
      }
    }

    // --- 7. STATE_INITIALIZATION: useState/useQueryState default values ---
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isIdentifier(expr)) {
        const hookName = expr.getText();
        if (astConfig.behavioral.stateInitHooks.has(hookName)) {
          const args = node.getArguments();
          if (args.length >= 1) {
            const defaultArg = args[0];
            const defaultValue = truncateText(defaultArg.getText(), 80);

            // Try to get the state variable name from destructuring
            let stateName: string | undefined;
            const parent = node.getParent();
            if (parent && Node.isVariableDeclaration(parent)) {
              const nameNode = parent.getNameNode();
              if (Node.isArrayBindingPattern(nameNode)) {
                const elements = nameNode.getElements();
                if (elements.length > 0 && Node.isBindingElement(elements[0])) {
                  stateName = elements[0].getName();
                }
              } else if (Node.isIdentifier(nameNode)) {
                stateName = nameNode.getText();
              }
            }

            observations.push({
              kind: 'STATE_INITIALIZATION',
              file: relativePath,
              line,
              evidence: {
                category: 'state-preservation',
                name: stateName,
                value: defaultValue,
                context: hookName,
              },
            });
          }
        }
      }
    }

    // --- 8. TYPE_COERCION_BOUNDARY: String(), Number(), parseInt(), etc. ---
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();

      // Function calls: Number(x), String(x), parseInt(x), etc.
      if (Node.isIdentifier(expr)) {
        const funcName = expr.getText();
        if (astConfig.behavioral.typeCoercionFunctions.has(funcName)) {
          observations.push({
            kind: 'TYPE_COERCION_BOUNDARY',
            file: relativePath,
            line,
            evidence: {
              category: 'type-coercion',
              name: funcName,
              containingFunction,
            },
          });
        }
      }

      // Method calls: x.toString(), x.toFixed(), x.valueOf()
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName();
        if (astConfig.behavioral.typeCoercionMethods.has(methodName)) {
          observations.push({
            kind: 'TYPE_COERCION_BOUNDARY',
            file: relativePath,
            line,
            evidence: {
              category: 'type-coercion',
              name: methodName,
              containingFunction,
            },
          });
        }
      }
    }
  });

  // Sort by line number
  observations.sort((a, b) => a.line - b.line);

  return observations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeBehavioral(filePath: string): BehavioralAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const observations = extractBehavioralObservations(sf);

  const summary = {} as Record<BehavioralObservationKind, number>;
  for (const obs of observations) {
    summary[obs.kind] = (summary[obs.kind] ?? 0) + 1;
  }

  return { filePath: relativePath, observations, summary };
}

export function analyzeBehavioralDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): BehavioralAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: BehavioralAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('behavioral', fp, () => analyzeBehavioral(fp), options);
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by observation count descending
  results.sort((a, b) => b.observations.length - a.observations.length);

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-behavioral.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
  '\n' +
  'Extract behavioral fingerprint observations from TypeScript/TSX files.\n' +
  '\n' +
  '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --no-cache    Bypass cache and recompute (also refreshes cache)\n' +
  '  --test-files  Scan test files instead of production files\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<BehavioralAnalysis> = {
  cacheNamespace: 'behavioral',
  helpText: HELP_TEXT,
  analyzeFile: analyzeBehavioral,
  analyzeDirectory: analyzeBehavioralDirectory,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-behavioral.ts') || process.argv[1].endsWith('ast-behavioral'));
if (isDirectRun) runObservationToolCli(cliConfig);
