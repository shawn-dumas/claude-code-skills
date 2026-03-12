import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText } from './shared';
import type { TypeSafetyAnalysis, TypeSafetyViolation, TypeSafetyViolationType } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): Record<TypeSafetyViolationType, number> {
  return {
    AS_ANY: 0,
    AS_UNKNOWN_AS: 0,
    NON_NULL_ASSERTION: 0,
    EXPLICIT_ANY_ANNOTATION: 0,
    CATCH_ERROR_ANY: 0,
    TS_DIRECTIVE_NO_COMMENT: 0,
    TRUST_BOUNDARY_CAST: 0,
  };
}

/**
 * Check whether a node is inside a complex type definition (conditional types,
 * mapped types, template literal types) where `any` is legitimate type-level
 * programming.
 */
function isInsideComplexTypeDefinition(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    const kind = current.getKind();
    if (
      kind === SyntaxKind.ConditionalType ||
      kind === SyntaxKind.MappedType ||
      kind === SyntaxKind.TemplateLiteralType
    ) {
      return true;
    }
    // Stop walking if we hit a statement-level node
    if (Node.isStatement(current) || Node.isFunctionDeclaration(current) || Node.isClassDeclaration(current)) {
      break;
    }
    current = current.getParent();
  }
  return false;
}

// ---------------------------------------------------------------------------
// Trust boundary detection
// ---------------------------------------------------------------------------

const TRUST_BOUNDARY_CALLS = ['JSON.parse', 'readStorage'] as const;
const TRUST_BOUNDARY_METHOD_CALLS = ['.json'] as const;
const TRUST_BOUNDARY_PROPERTY_ACCESS = ['localStorage.getItem', 'sessionStorage.getItem', 'process.env'] as const;

const TRUST_BOUNDARY_CALL_SET = new Set<string>(TRUST_BOUNDARY_CALLS);
const TRUST_BOUNDARY_METHOD_SET = new Set(TRUST_BOUNDARY_METHOD_CALLS.map(p => p.substring(1)));

function matchesPropertyAccessPattern(
  propAccess: Node & { getText(): string; getExpression(): Node; getName(): string },
): boolean {
  const fullText = propAccess.getText();
  const objText = propAccess.getExpression().getText();
  for (const pattern of TRUST_BOUNDARY_PROPERTY_ACCESS) {
    const lastSegment = pattern.split('.').pop();
    if ((fullText === pattern || fullText.endsWith(`.${lastSegment}`)) && pattern.startsWith(objText)) {
      return true;
    }
  }
  return false;
}

function isTrustBoundaryCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;

  const calleeExpr = node.getExpression();

  // Direct call: JSON.parse(...), readStorage(...)
  if (TRUST_BOUNDARY_CALL_SET.has(calleeExpr.getText())) return true;

  if (!Node.isPropertyAccessExpression(calleeExpr)) return false;
  const propAccess = calleeExpr.asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess) return false;

  // Method call: response.json()
  if (TRUST_BOUNDARY_METHOD_SET.has(propAccess.getName())) return true;

  // localStorage.getItem(...), sessionStorage.getItem(...)
  return matchesPropertyAccessPattern(propAccess);
}

function isTrustBoundaryExpression(node: Node): boolean {
  if (isTrustBoundaryCall(node)) return true;

  // Property access: process.env.VAR
  if (Node.isPropertyAccessExpression(node)) {
    if (node.getText().startsWith('process.env.')) return true;
  }

  // Await of a trust boundary call: await response.json()
  if (Node.isAwaitExpression(node)) {
    return isTrustBoundaryExpression(node.getExpression());
  }

  return false;
}

// ---------------------------------------------------------------------------
// Non-null assertion guard detection
// ---------------------------------------------------------------------------

/**
 * Check whether a text matches a has()/get() guard pattern.
 * e.g. map.has(key) guards map.get(key)!
 */
function matchesHasGuard(guardText: string, exprText: string): boolean {
  if (!guardText.includes('.has(')) return false;
  const getIndex = exprText.lastIndexOf('.get(');
  if (getIndex === -1) return false;
  const obj = exprText.substring(0, getIndex);
  return guardText.includes(`${obj}.has(`);
}

/**
 * Check whether a condition text is a null/truthiness guard for the given expression.
 */
function matchesNullGuard(condText: string, exprText: string): boolean {
  return (
    condText === exprText ||
    condText === `${exprText} != null` ||
    condText === `${exprText} !== null` ||
    condText === `${exprText} !== undefined` ||
    condText === `${exprText} != undefined`
  );
}

/**
 * Walk up from the node to find the nearest containing block and check whether
 * any ancestor if-statement condition guards the expression.
 * Returns `{ guarded: true }` if an ancestor guard is found, or `{ block }` for
 * the containing block (to check preceding statements).
 */
function findContainingBlockAndAncestorGuard(
  node: Node,
  exprText: string,
): { guarded: true } | { guarded: false; block: Node | undefined } {
  let current: Node | undefined = node.getParent();
  let containingBlock: Node | undefined;
  while (current) {
    if (Node.isBlock(current)) {
      const blockParent = current.getParent();
      if (blockParent && Node.isIfStatement(blockParent)) {
        const condText = blockParent.getExpression().getText();
        if (matchesHasGuard(condText, exprText) || matchesNullGuard(condText, exprText)) {
          return { guarded: true };
        }
      }
      if (!containingBlock) {
        containingBlock = current;
      }
    }
    current = current.getParent();
  }
  return { guarded: false, block: containingBlock };
}

/**
 * Find the index of the statement that contains the given node.
 */
function findContainingStatementIndex(statements: Node[], node: Node): number {
  for (let i = 0; i < statements.length; i++) {
    if (statements[i].getPos() <= node.getPos() && statements[i].getEnd() >= node.getEnd()) {
      return i;
    }
  }
  return -1;
}

/**
 * Check whether a single statement is a guard for the given expression.
 */
function isStatementGuard(stmt: Node, exprText: string): boolean {
  if (matchesHasGuard(stmt.getText(), exprText)) return true;

  if (Node.isIfStatement(stmt)) {
    const condText = stmt.asKind(SyntaxKind.IfStatement)?.getExpression().getText() ?? '';
    if (matchesNullGuard(condText, exprText)) return true;
  }

  return false;
}

/**
 * Check whether a preceding statement (within 3 statements) guards the
 * non-null expression via a .has() call or null-check if-statement.
 */
function hasPrecedingGuard(node: Node, exprText: string, block: Node): boolean {
  if (!Node.isBlock(block)) return false;

  const statements = block.getStatements();
  const nodeStmtIndex = findContainingStatementIndex(statements, node);
  if (nodeStmtIndex <= 0) return false;

  const lookback = Math.max(0, nodeStmtIndex - 3);
  for (let i = lookback; i < nodeStmtIndex; i++) {
    if (isStatementGuard(statements[i], exprText)) return true;
  }

  return false;
}

/**
 * Check whether a NonNullExpression is guarded by a preceding check in
 * the same block scope (within the previous 3 statements).
 *
 * Guards we recognize:
 * - map.has(key) before map.get(key)!
 * - if (x != null) / if (x !== null) / if (x !== undefined) / if (x)
 */
function isNonNullGuarded(node: Node): boolean {
  const exprText = node.asKind(SyntaxKind.NonNullExpression)?.getExpression().getText() ?? '';

  const result = findContainingBlockAndAncestorGuard(node, exprText);
  if (result.guarded) return true;

  if (!result.block) return false;
  return hasPrecedingGuard(node, exprText, result.block);
}

// ---------------------------------------------------------------------------
// Directive comment analysis
// ---------------------------------------------------------------------------

function findDirectiveViolations(sf: SourceFile): TypeSafetyViolation[] {
  const violations: TypeSafetyViolation[] = [];
  const fullText = sf.getFullText();
  const lines = fullText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Match @ts-expect-error, @ts-ignore
    const tsDirectiveMatch = line.match(/\/\/\s*(@ts-expect-error|@ts-ignore)(.*)/);
    if (tsDirectiveMatch) {
      const afterDirective = tsDirectiveMatch[2].trim();
      // Check if there is explanatory text after the directive
      // Convention: -- reason or just some text
      if (!afterDirective || afterDirective === '') {
        violations.push({
          type: 'TS_DIRECTIVE_NO_COMMENT',
          line: lineNumber,
          column: line.indexOf('@ts-') + 1,
          text: truncateText(line.trim(), 80),
          context: 'No explanatory comment after directive',
        });
      }
      continue;
    }

    // Match eslint-disable-next-line or eslint-disable
    const eslintMatch = line.match(/\/\/\s*(eslint-disable(?:-next-line)?)\s*([\w@\/-]*)(.*)/);
    if (eslintMatch) {
      const afterRuleName = eslintMatch[3].trim();
      // Check if there is a -- reason after the rule name
      if (!afterRuleName || !afterRuleName.startsWith('--')) {
        violations.push({
          type: 'TS_DIRECTIVE_NO_COMMENT',
          line: lineNumber,
          column: line.indexOf('eslint-disable') + 1,
          text: truncateText(line.trim(), 80),
          context: 'No explanatory comment after directive',
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Per-category classifiers
// ---------------------------------------------------------------------------

function classifyAsExpression(node: Node, line: number, column: number): TypeSafetyViolation | null {
  if (!Node.isAsExpression(node)) return null;

  const typeNode = node.getTypeNode();
  if (!typeNode) return null;

  const typeText = typeNode.getText();

  // "as const" is NOT a violation
  if (typeText === 'const') return null;

  if (typeText === 'any') {
    return {
      type: 'AS_ANY',
      line,
      column,
      text: truncateText(node.getText(), 80),
      context: 'Unsafe cast to any',
    };
  }

  // AS_UNKNOWN_AS (double cast)
  const innerExpr = node.getExpression();
  if (Node.isAsExpression(innerExpr)) {
    const innerType = innerExpr.getTypeNode()?.getText();
    if (innerType === 'unknown') {
      return {
        type: 'AS_UNKNOWN_AS',
        line,
        column,
        text: truncateText(node.getText(), 80),
        context: `Double cast via unknown to ${typeText}`,
      };
    }
  }

  // TRUST_BOUNDARY_CAST
  if (typeText !== 'unknown') {
    const castExpr = node.getExpression();
    if (isTrustBoundaryExpression(castExpr)) {
      return {
        type: 'TRUST_BOUNDARY_CAST',
        line,
        column,
        text: truncateText(node.getText(), 80),
        context: `Trust boundary cast to ${typeText} -- use Zod/type guard instead`,
      };
    }
  }

  return null;
}

function classifyNonNullAssertion(node: Node, line: number, column: number): TypeSafetyViolation | null {
  if (!Node.isNonNullExpression(node)) return null;

  const guarded = isNonNullGuarded(node);
  return {
    type: 'NON_NULL_ASSERTION',
    line,
    column,
    text: truncateText(node.getText(), 80),
    context: guarded ? 'guarded: true' : 'guarded: false',
  };
}

function isCatchClauseDescendant(node: Node): boolean {
  let cur: Node | undefined = node;
  while (cur) {
    if (Node.isCatchClause(cur)) return true;
    if (Node.isStatement(cur)) return false;
    cur = cur.getParent();
  }
  return false;
}

function classifyAnyAnnotation(node: Node, line: number, column: number): TypeSafetyViolation | null {
  if (node.getKind() !== SyntaxKind.AnyKeyword) return null;
  if (isInsideComplexTypeDefinition(node)) return null;

  // Skip if this is the type node of an AsExpression (handled by AS_ANY)
  const parent = node.getParent();
  if (parent && Node.isAsExpression(parent) && parent.getTypeNode() === node) return null;

  // Skip if inside a catch clause (handled by CATCH_ERROR_ANY)
  if (isCatchClauseDescendant(node)) return null;

  return {
    type: 'EXPLICIT_ANY_ANNOTATION',
    line,
    column,
    text: truncateText(parent?.getText() ?? 'any', 80),
    context: 'Explicit any in type annotation',
  };
}

function classifyCatchError(node: Node, line: number, column: number): TypeSafetyViolation | null {
  if (!Node.isCatchClause(node)) return null;

  const variableDecl = node.getVariableDeclaration();
  if (!variableDecl) return null;

  const typeNode = variableDecl.getTypeNode();
  if (!typeNode || typeNode.getText() !== 'any') return null;

  return {
    type: 'CATCH_ERROR_ANY',
    line,
    column,
    text: truncateText(node.getText().split('{')[0].trim(), 80),
    context: 'Use catch (error: unknown) instead',
  };
}

// ---------------------------------------------------------------------------
// Main analysis walker
// ---------------------------------------------------------------------------

function findViolations(sf: SourceFile): TypeSafetyViolation[] {
  const violations: TypeSafetyViolation[] = [];

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    const violation =
      classifyAsExpression(node, line, column) ??
      classifyNonNullAssertion(node, line, column) ??
      classifyAnyAnnotation(node, line, column) ??
      classifyCatchError(node, line, column);

    if (violation) {
      violations.push(violation);
    }
  });

  // Add directive violations
  violations.push(...findDirectiveViolations(sf));

  // Sort by line number
  violations.sort((a, b) => a.line - b.line || a.column - b.column);

  return violations;
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(violations: TypeSafetyViolation[]): Record<TypeSafetyViolationType, number> {
  const summary = emptySummary();
  for (const v of violations) {
    summary[v.type]++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeTypeSafety(filePath: string): TypeSafetyAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const violations = findViolations(sf);
  const summary = computeSummary(violations);

  return {
    filePath: relativePath,
    violations,
    summary,
  };
}

export function analyzeTypeSafetyDirectory(dirPath: string): TypeSafetyAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: TypeSafetyAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeTypeSafety(fp);
    // Skip files with zero violations
    if (analysis.violations.length > 0) {
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
      'Usage: npx tsx scripts/AST/ast-type-safety.ts <path...> [--pretty]\n' +
        '\n' +
        'Analyze type assertion safety and violation patterns.\n' +
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
    const results = analyzeTypeSafetyDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeTypeSafety(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-type-safety.ts') || process.argv[1].endsWith('ast-type-safety'));

if (isDirectRun) {
  main();
}
