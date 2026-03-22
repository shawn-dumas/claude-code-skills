import { SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { containsJsx, detectComponents, getBody, truncateText, getFilesInDirectory, type FileFilter } from './shared';
import { astConfig } from './ast-config';
import type { JsxAnalysis, JsxViolation, JsxObservation, JsxObservationKind, JsxObservationEvidence } from './types';
import { cached, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Return statement detection
// ---------------------------------------------------------------------------

interface ReturnInfo {
  node: Node;
  startLine: number;
  endLine: number;
}

/**
 * Check if a node is or contains JSX. This extends containsJsx to also check
 * if the node itself is a JSX element (not just its descendants).
 */
function isOrContainsJsx(node: Node): boolean {
  if (
    Node.isJsxElement(node) ||
    Node.isJsxSelfClosingElement(node) ||
    Node.isJsxFragment(node) ||
    Node.isParenthesizedExpression(node)
  ) {
    return true;
  }
  return containsJsx(node);
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
      if (expr && isOrContainsJsx(expr)) {
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

function isArrayTransformChain(node: Node): { methods: string[]; chainLength: number } | null {
  if (!Node.isCallExpression(node)) return null;

  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName();
  if (!astConfig.jsx.arrayTransformMethods.has(methodName)) return null;

  const methods = [methodName];
  let obj = expr.getExpression();

  // Walk the chain: items.filter(...).map(...)
  while (Node.isCallExpression(obj)) {
    const innerExpr = obj.getExpression();
    if (!Node.isPropertyAccessExpression(innerExpr)) break;
    const innerMethod = innerExpr.getName();
    if (astConfig.jsx.arrayTransformMethods.has(innerMethod)) {
      methods.unshift(innerMethod);
    }
    obj = innerExpr.getExpression();
  }

  return { methods, chainLength: methods.length };
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
// Observation helpers
// ---------------------------------------------------------------------------

interface NodeContext {
  filePath: string;
  line: number;
  column: number;
  componentName: string;
}

function makeObservation(
  kind: JsxObservationKind,
  ctx: NodeContext,
  evidence: Omit<JsxObservationEvidence, 'componentName'>,
): JsxObservation {
  return {
    kind,
    file: ctx.filePath,
    line: ctx.line,
    column: ctx.column,
    evidence: { componentName: ctx.componentName, ...evidence },
  };
}

// ---------------------------------------------------------------------------
// Per-category observation extractors (emit ALL patterns)
// ---------------------------------------------------------------------------

function extractTernaryChain(node: Node, ctx: NodeContext): JsxObservation | null {
  if (!Node.isConditionalExpression(node)) return null;

  const depth = countTernaryDepth(node);

  // Only report the outermost chained ternary, not the inner ones
  const parent = node.getParent();
  if (parent && Node.isConditionalExpression(parent)) return null;

  // Skip className ternaries (handled separately)
  const attrName = getEnclosingJsxAttributeName(node);
  if (attrName === 'className') return null;

  const condition = node.getCondition();
  return makeObservation('JSX_TERNARY_CHAIN', ctx, {
    depth,
    description: truncateText(condition.getText(), 60),
  });
}

function extractGuardChain(node: Node, ctx: NodeContext): JsxObservation | null {
  if (!isAndExpression(node)) return null;

  // Only report the outermost && chain
  const parent = node.getParent();
  if (parent && isAndExpression(parent)) return null;

  // Skip if inside a JSX attribute (event handlers, className, etc.)
  if (isInsideJsxAttribute(node)) return null;

  const operandCount = countAndChainDepth(node);
  // The last operand in a JSX guard is the rendered element, not a condition
  const conditionCount = operandCount - 1;

  return makeObservation('JSX_GUARD_CHAIN', ctx, {
    conditionCount,
    description: truncateText(node.getText(), 80),
  });
}

function extractTransformChain(node: Node, ctx: NodeContext): JsxObservation | null {
  if (!Node.isCallExpression(node)) return null;

  const chain = isArrayTransformChain(node);
  if (!chain) return null;

  // Only report the outermost chain call
  const parent = node.getParent();
  if (parent && Node.isCallExpression(parent) && isArrayTransformChain(parent)) return null;

  return makeObservation('JSX_TRANSFORM_CHAIN', ctx, {
    methods: chain.methods,
    chainLength: chain.chainLength,
  });
}

function extractIife(node: Node, ctx: NodeContext): JsxObservation | null {
  if (!isIIFE(node)) return null;

  const bodyLines = getIIFEBodyLineCount(node);
  return makeObservation('JSX_IIFE', ctx, {
    description: `IIFE (${bodyLines} lines)`,
  });
}

function extractInlineHandler(
  node: Node,
  ctx: NodeContext,
  sf: { getLineAndColumnAtPos(pos: number): { column: number } },
): JsxObservation | null {
  if (!Node.isJsxAttribute(node)) return null;

  const attrName = node.getNameNode().getText();
  if (!(attrName.startsWith('on') && attrName.length > 2 && attrName[2] >= 'A' && attrName[2] <= 'Z')) return null;

  const initializer = node.getInitializer();
  if (!initializer || !Node.isJsxExpression(initializer)) return null;

  const expr = initializer.getExpression();
  if (!expr || (!Node.isArrowFunction(expr) && !Node.isFunctionExpression(expr))) return null;

  const stmtCount = getStatementCount(expr);

  return makeObservation(
    'JSX_INLINE_HANDLER',
    {
      ...ctx,
      line: expr.getStartLineNumber(),
      column: sf.getLineAndColumnAtPos(expr.getStart()).column,
    },
    {
      handlerName: attrName,
      statementCount: stmtCount,
    },
  );
}

function extractInlineStyle(
  node: Node,
  ctx: NodeContext,
  sf: { getLineAndColumnAtPos(pos: number): { column: number } },
): JsxObservation | null {
  if (!Node.isJsxAttribute(node)) return null;

  const attrName = node.getNameNode().getText();
  if (attrName !== 'style') return null;

  const initializer = node.getInitializer();
  if (!initializer || !Node.isJsxExpression(initializer)) return null;

  const expr = initializer.getExpression();
  if (!expr || !Node.isObjectLiteralExpression(expr)) return null;

  const hasComputed = hasComputedValue(expr);

  return makeObservation(
    'JSX_INLINE_STYLE',
    {
      ...ctx,
      line: expr.getStartLineNumber(),
      column: sf.getLineAndColumnAtPos(expr.getStart()).column,
    },
    {
      hasComputedValues: hasComputed,
    },
  );
}

function extractComplexClassName(
  node: Node,
  ctx: NodeContext,
  sf: { getLineAndColumnAtPos(pos: number): { column: number } },
): JsxObservation | null {
  if (!Node.isJsxAttribute(node)) return null;

  const attrName = node.getNameNode().getText();
  if (attrName !== 'className') return null;

  const initializer = node.getInitializer();
  if (!initializer || !Node.isJsxExpression(initializer)) return null;

  const expr = initializer.getExpression();
  if (!expr) return null;

  // Count total ternary instances (not nesting depth)
  let ternaryCount = 0;
  if (Node.isConditionalExpression(expr)) ternaryCount++;
  expr.forEachDescendant(child => {
    if (Node.isConditionalExpression(child)) {
      ternaryCount++;
    }
  });

  // Only emit observation if there's at least one ternary
  if (ternaryCount === 0) return null;

  return makeObservation(
    'JSX_COMPLEX_CLASSNAME',
    {
      ...ctx,
      line: expr.getStartLineNumber(),
      column: sf.getLineAndColumnAtPos(expr.getStart()).column,
    },
    {
      ternaryCount,
    },
  );
}

// ---------------------------------------------------------------------------
// Observation extraction from return statements
// ---------------------------------------------------------------------------

function extractObservationsInReturn(returnNode: Node, componentName: string, filePath: string): JsxObservation[] {
  const observations: JsxObservation[] = [];

  returnNode.forEachDescendant(node => {
    const sf = node.getSourceFile();
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;
    const ctx: NodeContext = { filePath, line, column, componentName };

    const ternary = extractTernaryChain(node, ctx);
    if (ternary) observations.push(ternary);

    const guard = extractGuardChain(node, ctx);
    if (guard) observations.push(guard);

    const transform = extractTransformChain(node, ctx);
    if (transform) observations.push(transform);

    const iife = extractIife(node, ctx);
    if (iife) observations.push(iife);

    const handler = extractInlineHandler(node, ctx, sf);
    if (handler) observations.push(handler);

    const style = extractInlineStyle(node, ctx, sf);
    if (style) observations.push(style);

    const className = extractComplexClassName(node, ctx, sf);
    if (className) observations.push(className);
  });

  return observations;
}

// ---------------------------------------------------------------------------
// Derive legacy violations from observations (apply thresholds)
// ---------------------------------------------------------------------------

function deriveViolationsFromObservations(observations: JsxObservation[]): JsxViolation[] {
  const violations: JsxViolation[] = [];

  for (const obs of observations) {
    const { kind, line, column, evidence } = obs;
    const parentComponent = evidence.componentName;

    switch (kind) {
      case 'JSX_TERNARY_CHAIN':
        if ((evidence.depth ?? 0) >= astConfig.jsx.thresholds.chainedTernaryDepth) {
          violations.push({
            type: 'CHAINED_TERNARY',
            line,
            column: column ?? 0,
            description: `Chained ternary (depth ${evidence.depth}): ${evidence.description ?? ''}`,
            parentComponent,
          });
        }
        break;

      case 'JSX_GUARD_CHAIN':
        if ((evidence.conditionCount ?? 0) >= astConfig.jsx.thresholds.complexGuardConditions) {
          violations.push({
            type: 'COMPLEX_GUARD',
            line,
            column: column ?? 0,
            description: `Guard chain with ${evidence.conditionCount} conditions: ${evidence.description ?? ''}`,
            parentComponent,
          });
        }
        break;

      case 'JSX_TRANSFORM_CHAIN':
        if ((evidence.chainLength ?? 0) >= astConfig.jsx.thresholds.inlineTransformChain) {
          violations.push({
            type: 'INLINE_TRANSFORM',
            line,
            column: column ?? 0,
            description: `Chained array transform: .${(evidence.methods ?? []).join('.')}()`,
            parentComponent,
          });
        }
        break;

      case 'JSX_IIFE':
        // IIFEs are always violations (no threshold)
        violations.push({
          type: 'IIFE_IN_JSX',
          line,
          column: column ?? 0,
          description: evidence.description ?? 'IIFE in JSX',
          parentComponent,
        });
        break;

      case 'JSX_INLINE_HANDLER':
        if ((evidence.statementCount ?? 0) >= astConfig.jsx.thresholds.multiStmtHandler) {
          violations.push({
            type: 'MULTI_STMT_HANDLER',
            line,
            column: column ?? 0,
            description: `Multi-statement ${evidence.handlerName} handler (${evidence.statementCount} statements)`,
            parentComponent,
          });
        }
        break;

      case 'JSX_INLINE_STYLE':
        // Only a violation if has computed values
        if (evidence.hasComputedValues) {
          violations.push({
            type: 'INLINE_STYLE_OBJECT',
            line,
            column: column ?? 0,
            description: 'Inline style with computed values',
            parentComponent,
          });
        }
        break;

      case 'JSX_COMPLEX_CLASSNAME':
        if ((evidence.ternaryCount ?? 0) >= astConfig.jsx.thresholds.complexClassNameTernaries) {
          violations.push({
            type: 'COMPLEX_CLASSNAME',
            line,
            column: column ?? 0,
            description: `Complex className with ${evidence.ternaryCount} ternaries`,
            parentComponent,
          });
        }
        break;
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all JSX observations from a file without applying violation thresholds.
 * This function emits observations for ALL JSX patterns, including those below
 * the violation threshold. Used by the interpreter layer.
 */
export function extractJsxObservations(filePath: string): JsxObservation[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const detectedComponents = detectComponents(sf);
  const observations: JsxObservation[] = [];

  for (const comp of detectedComponents) {
    const returns = findReturnStatements(comp.funcNode);

    // Add JSX_RETURN_BLOCK observations for each component's return
    const primaryReturn = returns.length > 0 ? returns[returns.length - 1] : null;
    if (primaryReturn) {
      observations.push(
        makeObservation(
          'JSX_RETURN_BLOCK',
          {
            filePath: relativePath,
            line: primaryReturn.startLine,
            column: 0,
            componentName: comp.name,
          },
          {
            returnStartLine: primaryReturn.startLine,
            returnEndLine: primaryReturn.endLine,
            returnLineCount: primaryReturn.endLine - primaryReturn.startLine + 1,
          },
        ),
      );
    }

    // Collect JSX pattern observations from all return statements
    for (const ret of returns) {
      observations.push(...extractObservationsInReturn(ret.node, comp.name, relativePath));
    }
  }

  return observations;
}

export function analyzeJsxComplexity(filePath: string): JsxAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const detectedComponents = detectComponents(sf);
  const allObservations: JsxObservation[] = [];

  const components = detectedComponents.map(comp => {
    const returns = findReturnStatements(comp.funcNode);

    // Use the last (primary) return for line counts, or first if only one
    const primaryReturn = returns.length > 0 ? returns[returns.length - 1] : null;
    const returnStartLine = primaryReturn?.startLine ?? 0;
    const returnEndLine = primaryReturn?.endLine ?? 0;
    const returnLineCount = primaryReturn ? returnEndLine - returnStartLine + 1 : 0;

    // Add JSX_RETURN_BLOCK observation
    if (primaryReturn) {
      allObservations.push(
        makeObservation(
          'JSX_RETURN_BLOCK',
          {
            filePath: relativePath,
            line: primaryReturn.startLine,
            column: 0,
            componentName: comp.name,
          },
          {
            returnStartLine: primaryReturn.startLine,
            returnEndLine: primaryReturn.endLine,
            returnLineCount: primaryReturn.endLine - primaryReturn.startLine + 1,
          },
        ),
      );
    }

    // Collect observations from all JSX-containing return statements
    const componentObservations: JsxObservation[] = [];
    for (const ret of returns) {
      const obs = extractObservationsInReturn(ret.node, comp.name, relativePath);
      componentObservations.push(...obs);
      allObservations.push(...obs);
    }

    // Derive violations from observations
    const violations = deriveViolationsFromObservations(componentObservations);

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
    observations: allObservations,
  };
}

export function analyzeJsxComplexityDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): JsxAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: JsxAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('jsx-analysis', fp, () => analyzeJsxComplexity(fp), options);
    // Include files with any observations or components
    if (analysis.components.length > 0 || analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-jsx-analysis.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze JSX template complexity in React components.\n' +
        '\n' +
        '  <path...>     One or more .tsx files or directories to analyze\n' +
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

  const allResults: JsxAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeJsxComplexityDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('jsx-analysis', absolute, () => analyzeJsxComplexity(absolute), { noCache });
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
  process.argv[1] && (process.argv[1].endsWith('ast-jsx-analysis.ts') || process.argv[1].endsWith('ast-jsx-analysis'));

if (isDirectRun) {
  main();
}
