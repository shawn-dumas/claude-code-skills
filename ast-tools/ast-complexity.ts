import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { ComplexityAnalysis, FunctionComplexity } from './types';

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

function findFunctions(sf: SourceFile): FunctionBounds[] {
  const functions: FunctionBounds[] = [];

  sf.forEachDescendant((node, traversal) => {
    // Function declarations
    if (Node.isFunctionDeclaration(node)) {
      const body = node.getBody();
      if (!body) return;
      functions.push({
        name: node.getName() ?? '<anonymous>',
        line: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        bodyStart: body.getStart(),
        bodyEnd: body.getEnd(),
        node,
      });
      return;
    }

    // Arrow functions
    if (Node.isArrowFunction(node)) {
      if (isInlineCallback(node) || isIIFE(node)) return;

      const parent = node.getParent();
      let name = '<anonymous>';

      // const foo = () => ...
      if (parent && Node.isVariableDeclaration(parent)) {
        name = parent.getName();
      }
      // export default () => ...
      if (parent && Node.isExportAssignment(parent)) {
        name = '<default export>';
      }

      const body = node.getBody();
      functions.push({
        name,
        line: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        bodyStart: body.getStart(),
        bodyEnd: body.getEnd(),
        node,
      });
      return;
    }

    // Function expressions: const foo = function() { ... }
    if (Node.isFunctionExpression(node)) {
      if (isInlineCallback(node) || isIIFE(node)) return;

      const parent = node.getParent();
      let name = node.getName() ?? '<anonymous>';

      if (parent && Node.isVariableDeclaration(parent)) {
        name = parent.getName();
      }
      if (parent && Node.isExportAssignment(parent)) {
        name = '<default export>';
      }

      const body = node.getBody();
      functions.push({
        name,
        line: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        bodyStart: body.getStart(),
        bodyEnd: body.getEnd(),
        node,
      });
      return;
    }

    // Class method declarations
    if (Node.isMethodDeclaration(node)) {
      const body = node.getBody();
      if (!body) return;
      functions.push({
        name: node.getName(),
        line: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        bodyStart: body.getStart(),
        bodyEnd: body.getEnd(),
        node,
      });
      return;
    }

    // Constructor declarations
    if (Node.isConstructorDeclaration(node)) {
      const body = node.getBody();
      if (!body) return;
      functions.push({
        name: 'constructor',
        line: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        bodyStart: body.getStart(),
        bodyEnd: body.getEnd(),
        node,
      });
      return;
    }

    // Getters and setters
    if (Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
      const body = node.getBody();
      if (!body) return;
      const prefix = Node.isGetAccessorDeclaration(node) ? 'get ' : 'set ';
      functions.push({
        name: prefix + node.getName(),
        line: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        bodyStart: body.getStart(),
        bodyEnd: body.getEnd(),
        node,
      });
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

function computeComplexity(
  sf: SourceFile,
  fn: FunctionBounds,
  allFunctions: FunctionBounds[],
): { complexity: number; contributors: ContributorInfo[]; maxNestingDepth: number } {
  const contributors: ContributorInfo[] = [];

  sf.forEachDescendant(node => {
    if (!isOwnedByFunction(node, fn, allFunctions)) return;

    const line = node.getStartLineNumber();

    // IfStatement
    if (Node.isIfStatement(node)) {
      // Check if this is an else-if: the parent is an IfStatement and
      // this node is in the else branch
      const parent = node.getParent();
      if (parent && Node.isIfStatement(parent) && parent.getElseStatement() === node) {
        contributors.push({ type: 'else-if', line });
      } else {
        contributors.push({ type: 'if', line });
      }
      return;
    }

    // Switch case clauses (not default)
    if (node.getKind() === SyntaxKind.CaseClause) {
      contributors.push({ type: 'switch-case', line });
      return;
    }

    // Catch clause
    if (Node.isCatchClause(node)) {
      contributors.push({ type: 'catch', line });
      return;
    }

    // Loops
    if (
      Node.isForStatement(node) ||
      Node.isForInStatement(node) ||
      Node.isForOfStatement(node) ||
      Node.isWhileStatement(node) ||
      Node.isDoStatement(node)
    ) {
      contributors.push({ type: 'loop', line });
      return;
    }

    // Ternary (conditional expression)
    if (Node.isConditionalExpression(node)) {
      contributors.push({ type: 'ternary', line });
      return;
    }

    // Logical operators: &&, ||, ??
    if (Node.isBinaryExpression(node)) {
      const opToken = node.getOperatorToken().getKind();
      if (opToken === SyntaxKind.AmpersandAmpersandToken) {
        contributors.push({ type: 'logical-and', line });
      } else if (opToken === SyntaxKind.BarBarToken) {
        contributors.push({ type: 'logical-or', line });
      } else if (opToken === SyntaxKind.QuestionQuestionToken) {
        contributors.push({ type: 'nullish-coalesce', line });
      }
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

function analyzeComplexityDirectory(dirPath: string): ComplexityAnalysis[] {
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
