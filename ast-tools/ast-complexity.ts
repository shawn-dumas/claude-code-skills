import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import { astConfig } from './ast-config';
import type { ComplexityAnalysis, FunctionComplexity, ComplexityObservation, ObservationResult } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContributorType = FunctionComplexity['contributors'][number]['type'];

interface FunctionBounds {
  name: string;
  line: number;
  endLine: number;
  bodyStart: number;
  bodyEnd: number;
  node: Node;
}

// ---------------------------------------------------------------------------
// Function detection
// ---------------------------------------------------------------------------

/**
 * Determine whether an arrow function or function expression is an inline
 * callback (passed as an argument to another function call). Inline
 * callbacks contribute to the enclosing function's complexity rather than
 * getting their own entry.
 */
function isInlineCallback(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  // Direct argument: foo(x => ...)
  if (Node.isCallExpression(parent)) {
    // Exception: memo() and forwardRef() wrappers define the component --
    // the inner function IS the component, not a callback. Its complexity
    // should be reported as a top-level function.
    const callee = parent.getExpression();
    const calleeName = callee.getText();
    if (
      calleeName === 'memo' ||
      calleeName === 'React.memo' ||
      calleeName === 'forwardRef' ||
      calleeName === 'React.forwardRef'
    ) {
      return false;
    }
    return true;
  }

  // Argument wrapped in parentheses: foo((x) => ...)
  if (Node.isParenthesizedExpression(parent) && Node.isCallExpression(parent.getParent())) return true;

  return false;
}

/**
 * Determine whether an arrow function or function expression is an
 * immediately-invoked function expression (IIFE): (() => { ... })()
 */
function isIIFE(node: Node): boolean {
  let current: Node | undefined = node.getParent();

  // Walk through parenthesized wrappers
  while (current && Node.isParenthesizedExpression(current)) {
    current = current.getParent();
  }

  return current !== undefined && Node.isCallExpression(current);
}

/**
 * Resolve the name for an arrow function or function expression from its parent.
 */
function resolveAssignedName(node: Node, fallback: string): string {
  const parent = node.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  if (parent && Node.isExportAssignment(parent)) return '<default export>';
  return fallback;
}

function buildBounds(name: string, node: Node, bodyStart: number, bodyEnd: number): FunctionBounds {
  return {
    name,
    line: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    bodyStart,
    bodyEnd,
    node,
  };
}

function extractFunctionDeclaration(node: Node): FunctionBounds | null {
  if (!Node.isFunctionDeclaration(node)) return null;
  const body = node.getBody();
  if (!body) return null;
  return buildBounds(node.getName() ?? '<anonymous>', node, body.getStart(), body.getEnd());
}

function extractArrowFunction(node: Node): FunctionBounds | null {
  if (!Node.isArrowFunction(node)) return null;
  if (isInlineCallback(node) || isIIFE(node)) return null;
  const body = node.getBody();
  return buildBounds(resolveAssignedName(node, '<anonymous>'), node, body.getStart(), body.getEnd());
}

function extractFunctionExpression(node: Node): FunctionBounds | null {
  if (!Node.isFunctionExpression(node)) return null;
  if (isInlineCallback(node) || isIIFE(node)) return null;
  const body = node.getBody();
  return buildBounds(resolveAssignedName(node, node.getName() ?? '<anonymous>'), node, body.getStart(), body.getEnd());
}

function extractMethodDeclaration(node: Node): FunctionBounds | null {
  if (!Node.isMethodDeclaration(node)) return null;
  const body = node.getBody();
  if (!body) return null;
  return buildBounds(node.getName(), node, body.getStart(), body.getEnd());
}

function extractConstructor(node: Node): FunctionBounds | null {
  if (!Node.isConstructorDeclaration(node)) return null;
  const body = node.getBody();
  if (!body) return null;
  return buildBounds('constructor', node, body.getStart(), body.getEnd());
}

function extractAccessor(node: Node): FunctionBounds | null {
  if (!Node.isGetAccessorDeclaration(node) && !Node.isSetAccessorDeclaration(node)) return null;
  const body = node.getBody();
  if (!body) return null;
  const prefix = Node.isGetAccessorDeclaration(node) ? 'get ' : 'set ';
  return buildBounds(prefix + node.getName(), node, body.getStart(), body.getEnd());
}

const FUNCTION_EXTRACTORS = [
  extractFunctionDeclaration,
  extractArrowFunction,
  extractFunctionExpression,
  extractMethodDeclaration,
  extractConstructor,
  extractAccessor,
] as const;

function findFunctions(sf: SourceFile): FunctionBounds[] {
  const functions: FunctionBounds[] = [];

  sf.forEachDescendant(node => {
    for (const extractor of FUNCTION_EXTRACTORS) {
      const result = extractor(node);
      if (result) {
        functions.push(result);
        return;
      }
    }
  });

  return functions;
}

// ---------------------------------------------------------------------------
// Complexity analysis
// ---------------------------------------------------------------------------

/**
 * Determine whether a node is syntactically inside a function's body but
 * NOT inside a nested standalone function (one that has its own entry in
 * the functions list). Inline callbacks are part of the enclosing
 * function, so we only exclude standalone nested functions.
 */
function isOwnedByFunction(node: Node, fn: FunctionBounds, allFunctions: FunctionBounds[]): boolean {
  const nodeStart = node.getStart();
  const nodeEnd = node.getEnd();

  // Must be inside this function's body
  if (nodeStart < fn.bodyStart || nodeEnd > fn.bodyEnd) return false;

  // Must not be inside a nested standalone function's body
  for (const other of allFunctions) {
    if (other === fn) continue;
    if (other.bodyStart <= nodeStart && other.bodyEnd >= nodeEnd && other.bodyStart > fn.bodyStart) {
      return false;
    }
  }

  return true;
}

interface ContributorInfo {
  type: ContributorType;
  line: number;
}

function classifyIfStatement(node: Node): ContributorType {
  const parent = node.getParent();
  if (parent && Node.isIfStatement(parent) && parent.getElseStatement() === node) {
    return 'else-if';
  }
  return 'if';
}

const LOOP_KINDS = new Set([
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

const LOGICAL_OP_MAP = new Map<SyntaxKind, ContributorType>([
  [SyntaxKind.AmpersandAmpersandToken, 'logical-and'],
  [SyntaxKind.BarBarToken, 'logical-or'],
  [SyntaxKind.QuestionQuestionToken, 'nullish-coalesce'],
]);

function classifyComplexityContributor(node: Node): ContributorType | null {
  if (Node.isIfStatement(node)) return classifyIfStatement(node);
  if (node.getKind() === SyntaxKind.CaseClause) return 'switch-case';
  if (Node.isCatchClause(node)) return 'catch';
  if (LOOP_KINDS.has(node.getKind())) return 'loop';
  if (Node.isConditionalExpression(node)) return 'ternary';

  if (Node.isBinaryExpression(node)) {
    return LOGICAL_OP_MAP.get(node.getOperatorToken().getKind()) ?? null;
  }

  return null;
}

function computeComplexity(
  sf: SourceFile,
  fn: FunctionBounds,
  allFunctions: FunctionBounds[],
): { complexity: number; contributors: ContributorInfo[]; maxNestingDepth: number } {
  const contributors: ContributorInfo[] = [];

  sf.forEachDescendant(node => {
    if (!isOwnedByFunction(node, fn, allFunctions)) return;

    const type = classifyComplexityContributor(node);
    if (type) {
      contributors.push({ type, line: node.getStartLineNumber() });
    }
  });

  // Sort contributors by line number
  contributors.sort((a, b) => a.line - b.line);

  const complexity = 1 + contributors.length;
  const maxNestingDepth = computeMaxNestingDepth(sf, fn, allFunctions);

  return { complexity, contributors, maxNestingDepth };
}

// ---------------------------------------------------------------------------
// Nesting depth
// ---------------------------------------------------------------------------

function isNestingNode(node: Node): boolean {
  if (
    Node.isIfStatement(node) ||
    Node.isForStatement(node) ||
    Node.isForInStatement(node) ||
    Node.isForOfStatement(node) ||
    Node.isWhileStatement(node) ||
    Node.isDoStatement(node) ||
    Node.isSwitchStatement(node) ||
    Node.isTryStatement(node)
  ) {
    return true;
  }
  return false;
}

function computeMaxNestingDepth(sf: SourceFile, fn: FunctionBounds, allFunctions: FunctionBounds[]): number {
  let maxDepth = 0;

  sf.forEachDescendant(node => {
    if (!isOwnedByFunction(node, fn, allFunctions)) return;
    if (!isNestingNode(node)) return;

    // Count how many nesting nodes are ancestors of this node (within the function)
    let depth = 0;
    let current: Node | undefined = node;
    while (current) {
      current = current.getParent();
      if (!current) break;

      // Stop if we've left the function body
      if (current.getStart() < fn.bodyStart) break;

      if (isNestingNode(current) && isOwnedByFunction(current, fn, allFunctions)) {
        depth++;
      }
    }

    // Add 1 for the current nesting node itself
    const totalDepth = depth + 1;
    if (totalDepth > maxDepth) {
      maxDepth = totalDepth;
    }
  });

  return maxDepth;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeComplexity(filePath: string): ComplexityAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const fnBounds = findFunctions(sf);
  const functions: FunctionComplexity[] = fnBounds.map(fn => {
    const { complexity, contributors, maxNestingDepth } = computeComplexity(sf, fn, fnBounds);
    return {
      name: fn.name,
      line: fn.line,
      endLine: fn.endLine,
      lineCount: fn.endLine - fn.line + 1,
      cyclomaticComplexity: complexity,
      maxNestingDepth,
      contributors,
    };
  });

  const fileTotalComplexity = functions.reduce((sum, f) => sum + f.cyclomaticComplexity, 0);

  return {
    filePath: relativePath,
    functions,
    fileTotalComplexity,
  };
}

export function analyzeComplexityDirectory(dirPath: string): ComplexityAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: ComplexityAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeComplexity(fp);
    results.push(analysis);
  }

  // Sort by fileTotalComplexity descending
  results.sort((a, b) => b.fileTotalComplexity - a.fileTotalComplexity);

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

/**
 * Extract complexity observations from analysis results.
 * Complexity calculation is universal and does not require repo-specific config,
 * but we reference astConfig.complexity to maintain the pattern (currently empty).
 */
export function extractComplexityObservations(analysis: ComplexityAnalysis): ObservationResult<ComplexityObservation> {
  // Reference astConfig.complexity to establish the pattern
  // (complexity calculation is universal, no repo-specific config needed)
  void astConfig.complexity;

  const observations: ComplexityObservation[] = analysis.functions.map(fn => ({
    kind: 'FUNCTION_COMPLEXITY' as const,
    file: analysis.filePath,
    line: fn.line,
    evidence: {
      functionName: fn.name,
      endLine: fn.endLine,
      lineCount: fn.lineCount,
      cyclomaticComplexity: fn.cyclomaticComplexity,
      maxNestingDepth: fn.maxNestingDepth,
      contributors: fn.contributors.map(c => ({ type: c.type, line: c.line })),
    },
  }));

  return {
    filePath: analysis.filePath,
    observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-complexity.ts <path...> [--pretty]\n' +
        '\n' +
        'Analyze per-function cyclomatic complexity.\n' +
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
    const results = analyzeComplexityDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeComplexity(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-complexity.ts') || process.argv[1].endsWith('ast-complexity'));

if (isDirectRun) {
  main();
}
