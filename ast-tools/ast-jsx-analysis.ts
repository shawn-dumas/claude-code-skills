import { SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { containsJsx, detectComponents, getBody, truncateText } from './shared';
import type { JsxAnalysis, JsxViolation } from './types';

// ---------------------------------------------------------------------------
// Return statement detection
// ---------------------------------------------------------------------------

interface ReturnInfo {
  node: Node;
  startLine: number;
  endLine: number;
}

function findReturnStatements(funcNode: Node): ReturnInfo[] {
  const body = getBody(funcNode);

  if (!body) {
    // Arrow function with implicit return (expression body)
    if (Node.isArrowFunction(funcNode)) {
      const arrowBody = funcNode.getBody();
      if (arrowBody) {
        return [
          {
            node: arrowBody,
            startLine: arrowBody.getStartLineNumber(),
            endLine: arrowBody.getEndLineNumber(),
          },
        ];
      }
    }
    return [];
  }

  const returns: ReturnInfo[] = [];
  for (const stmt of body.getStatements()) {
    if (Node.isReturnStatement(stmt)) {
      const expr = stmt.getExpression();
      if (expr && containsJsx(expr)) {
        returns.push({
          node: stmt,
          startLine: stmt.getStartLineNumber(),
          endLine: stmt.getEndLineNumber(),
        });
      }
    }
  }

  return returns;
}

// ---------------------------------------------------------------------------
// Violation detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if a node is a binary expression with && operator.
 */
function isAndExpression(node: Node): boolean {
  return Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken;
}

/**
 * Count the depth of a chained && logical expression.
 * `a && b` = 2, `a && b && c` = 3, etc.
 */
function countAndChainDepth(node: Node): number {
  if (!Node.isBinaryExpression(node)) return 1;
  if (node.getOperatorToken().getKind() !== SyntaxKind.AmpersandAmpersandToken) return 1;
  return countAndChainDepth(node.getLeft()) + 1;
}

/**
 * Count the nesting depth of a chained ternary.
 * `a ? X : Y` = 1, `a ? X : b ? Y : Z` = 2, etc.
 */
function countTernaryDepth(node: Node): number {
  if (!Node.isConditionalExpression(node)) return 0;
  const whenTrue = node.getWhenTrue();
  const whenFalse = node.getWhenFalse();
  return 1 + Math.max(countTernaryDepth(whenTrue), countTernaryDepth(whenFalse));
}

/** Check if a node is inside a JSX attribute value */
function isInsideJsxAttribute(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isJsxAttribute(current)) return true;
    if (Node.isJsxElement(current) || Node.isJsxSelfClosingElement(current) || Node.isJsxFragment(current)) {
      return false;
    }
    current = current.getParent();
  }
  return false;
}

/** Get the name of the enclosing JSX attribute, if any */
function getEnclosingJsxAttributeName(node: Node): string | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isJsxAttribute(current)) {
      const nameNode = current.getNameNode();
      return nameNode.getText();
    }
    if (Node.isJsxElement(current) || Node.isJsxSelfClosingElement(current) || Node.isJsxFragment(current)) {
      return null;
    }
    current = current.getParent();
  }
  return null;
}

const ARRAY_TRANSFORM_METHODS = ['filter', 'map', 'reduce', 'sort', 'flatMap', 'find'] as const;

function isArrayTransformChain(node: Node): { chained: boolean; methods: string[] } | null {
  if (!Node.isCallExpression(node)) return null;

  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName();
  if (!(ARRAY_TRANSFORM_METHODS as readonly string[]).includes(methodName)) return null;

  const methods = [methodName];
  let obj = expr.getExpression();

  // Walk the chain: items.filter(...).map(...)
  while (Node.isCallExpression(obj)) {
    const innerExpr = obj.getExpression();
    if (!Node.isPropertyAccessExpression(innerExpr)) break;
    const innerMethod = innerExpr.getName();
    if ((ARRAY_TRANSFORM_METHODS as readonly string[]).includes(innerMethod)) {
      methods.unshift(innerMethod);
    }
    obj = innerExpr.getExpression();
  }

  if (methods.length < 2) return null;
  return { chained: true, methods };
}

function isIIFE(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (Node.isParenthesizedExpression(callee)) {
    const inner = callee.getExpression();
    return Node.isArrowFunction(inner) || Node.isFunctionExpression(inner);
  }
  return false;
}

function getIIFEBodyLineCount(node: Node): number {
  if (!Node.isCallExpression(node)) return 0;
  const callee = node.getExpression();
  if (!Node.isParenthesizedExpression(callee)) return 0;
  const inner = callee.getExpression();
  if (Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) {
    return inner.getEndLineNumber() - inner.getStartLineNumber() + 1;
  }
  return 0;
}

function getStatementCount(node: Node): number {
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (!body) return 0;
    if (Node.isBlock(body)) {
      return body.getStatements().length;
    }
    // Expression body = 1 expression statement
    return 1;
  }
  return 0;
}

function hasComputedValue(node: Node): boolean {
  let found = false;
  node.forEachDescendant(child => {
    if (
      Node.isTemplateExpression(child) ||
      Node.isBinaryExpression(child) ||
      Node.isConditionalExpression(child) ||
      Node.isCallExpression(child)
    ) {
      found = true;
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Main violation walker
// ---------------------------------------------------------------------------

function findViolationsInReturn(returnNode: Node, componentName: string): JsxViolation[] {
  const violations: JsxViolation[] = [];

  returnNode.forEachDescendant(node => {
    const sf = node.getSourceFile();
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // --- CHAINED_TERNARY ---
    if (Node.isConditionalExpression(node)) {
      const depth = countTernaryDepth(node);
      if (depth >= 2) {
        // Only report the outermost chained ternary, not the inner ones
        const parent = node.getParent();
        if (parent && Node.isConditionalExpression(parent)) {
          // This ternary is nested inside another -- skip it to avoid double-reporting
          return;
        }

        const attrName = getEnclosingJsxAttributeName(node);
        if (attrName === 'className') {
          // Will be handled by COMPLEX_CLASSNAME
          return;
        }

        const condition = node.getCondition();
        violations.push({
          type: 'CHAINED_TERNARY',
          line,
          column,
          description: `Chained ternary (depth ${depth}): ${truncateText(condition.getText(), 60)}`,
          parentComponent: componentName,
        });
      }
    }

    // --- COMPLEX_GUARD ---
    if (isAndExpression(node)) {
      // Only report the outermost && chain
      const parent = node.getParent();
      if (parent && isAndExpression(parent)) {
        return;
      }

      // Skip if inside a JSX attribute (event handlers, className, etc.)
      if (isInsideJsxAttribute(node)) return;

      const operandCount = countAndChainDepth(node);
      // The last operand in a JSX guard is the rendered element, not a condition
      const conditionCount = operandCount - 1;
      if (conditionCount >= 3) {
        violations.push({
          type: 'COMPLEX_GUARD',
          line,
          column,
          description: `Guard chain with ${conditionCount} conditions: ${truncateText(node.getText(), 80)}`,
          parentComponent: componentName,
        });
      }
    }

    // --- INLINE_TRANSFORM ---
    if (Node.isCallExpression(node)) {
      const chain = isArrayTransformChain(node);
      if (chain) {
        // Only report the outermost chain call
        const parent = node.getParent();
        if (parent && Node.isCallExpression(parent) && isArrayTransformChain(parent)) {
          return;
        }

        violations.push({
          type: 'INLINE_TRANSFORM',
          line,
          column,
          description: `Chained array transform: .${chain.methods.join('.')}()`,
          parentComponent: componentName,
        });
      }
    }

    // --- IIFE_IN_JSX ---
    if (isIIFE(node)) {
      const bodyLines = getIIFEBodyLineCount(node);
      violations.push({
        type: 'IIFE_IN_JSX',
        line,
        column,
        description: `IIFE in JSX (${bodyLines} lines)`,
        parentComponent: componentName,
      });
    }

    // --- MULTI_STMT_HANDLER ---
    if (Node.isJsxAttribute(node)) {
      const attrName = node.getNameNode().getText();
      if (/^on[A-Z]/.test(attrName)) {
        const initializer = node.getInitializer();
        if (initializer && Node.isJsxExpression(initializer)) {
          const expr = initializer.getExpression();
          if (expr && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))) {
            const stmtCount = getStatementCount(expr);
            if (stmtCount >= 2) {
              violations.push({
                type: 'MULTI_STMT_HANDLER',
                line: expr.getStartLineNumber(),
                column: sf.getLineAndColumnAtPos(expr.getStart()).column,
                description: `Multi-statement ${attrName} handler (${stmtCount} statements)`,
                parentComponent: componentName,
              });
            }
          }
        }
      }
    }

    // --- INLINE_STYLE_OBJECT ---
    if (Node.isJsxAttribute(node)) {
      const attrName = node.getNameNode().getText();
      if (attrName === 'style') {
        const initializer = node.getInitializer();
        if (initializer && Node.isJsxExpression(initializer)) {
          const expr = initializer.getExpression();
          if (expr && Node.isObjectLiteralExpression(expr)) {
            const hasDynamic = hasComputedValue(expr);
            if (hasDynamic) {
              violations.push({
                type: 'INLINE_STYLE_OBJECT',
                line: expr.getStartLineNumber(),
                column: sf.getLineAndColumnAtPos(expr.getStart()).column,
                description: `Inline style with computed values`,
                parentComponent: componentName,
              });
            }
          }
        }
      }
    }

    // --- COMPLEX_CLASSNAME ---
    if (Node.isJsxAttribute(node)) {
      const attrName = node.getNameNode().getText();
      if (attrName === 'className') {
        const initializer = node.getInitializer();
        if (initializer && Node.isJsxExpression(initializer)) {
          const expr = initializer.getExpression();
          if (expr) {
            // Count total ternary instances (not nesting depth) for
            // consistent measurement regardless of whether ternaries are
            // nested or siblings.
            let ternaryCount = 0;
            if (Node.isConditionalExpression(expr)) ternaryCount++;
            expr.forEachDescendant(child => {
              if (Node.isConditionalExpression(child)) {
                ternaryCount++;
              }
            });

            if (ternaryCount >= 2) {
              violations.push({
                type: 'COMPLEX_CLASSNAME',
                line: expr.getStartLineNumber(),
                column: sf.getLineAndColumnAtPos(expr.getStart()).column,
                description: `Complex className with ${ternaryCount} ternaries`,
                parentComponent: componentName,
              });
            }
          }
        }
      }
    }
  });

  return violations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeJsxComplexity(filePath: string): JsxAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const detectedComponents = detectComponents(sf);

  const components = detectedComponents.map(comp => {
    const returns = findReturnStatements(comp.funcNode);

    // Use the last (primary) return for line counts, or first if only one
    const primaryReturn = returns.length > 0 ? returns[returns.length - 1] : null;
    const returnStartLine = primaryReturn?.startLine ?? 0;
    const returnEndLine = primaryReturn?.endLine ?? 0;
    const returnLineCount = primaryReturn ? returnEndLine - returnStartLine + 1 : 0;

    // Collect violations from all JSX-containing return statements
    const violations: JsxViolation[] = [];
    for (const ret of returns) {
      violations.push(...findViolationsInReturn(ret.node, comp.name));
    }

    return {
      name: comp.name,
      returnStartLine,
      returnEndLine,
      returnLineCount,
      violations,
    };
  });

  return {
    filePath: relativePath,
    components,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-jsx-analysis.ts <file...> [--pretty]\n' +
        '\n' +
        'Analyze JSX template complexity in React components.\n' +
        '\n' +
        '  <file...>  One or more .tsx files to analyze\n' +
        '  --pretty   Format JSON output with indentation\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  const results: JsxAnalysis[] = args.paths.map(p => analyzeJsxComplexity(p));

  if (results.length === 1) {
    output(results[0], args.pretty);
  } else {
    output(results, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-jsx-analysis.ts') || process.argv[1].endsWith('ast-jsx-analysis'));

if (isDirectRun) {
  main();
}
