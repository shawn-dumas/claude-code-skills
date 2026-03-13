import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText } from './shared';
import { astConfig } from './ast-config';
import { cached, hasNoCacheFlag, getCacheStats } from './ast-cache';
import type {
  TypeSafetyAnalysis,
  TypeSafetyViolation,
  TypeSafetyViolationType,
  TypeSafetyObservation,
  TypeSafetyObservationKind,
  TypeSafetyObservationEvidence,
} from './types';

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
// Trust boundary detection (uses astConfig.typeSafety.*)
// ---------------------------------------------------------------------------

function matchesPropertyAccessPattern(
  propAccess: Node & { getText(): string; getExpression(): Node; getName(): string },
): boolean {
  const fullText = propAccess.getText();
  const objText = propAccess.getExpression().getText();
  for (const pattern of astConfig.typeSafety.trustBoundaryPropertyAccess) {
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
  if (astConfig.typeSafety.trustBoundaryCalls.has(calleeExpr.getText())) return true;

  if (!Node.isPropertyAccessExpression(calleeExpr)) return false;
  const propAccess = calleeExpr.asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess) return false;

  // Method call: response.json()
  const methodName = `.${propAccess.getName()}`;
  if (astConfig.typeSafety.trustBoundaryMethodCalls.has(methodName)) return true;

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

type AncestorGuardResult =
  | { guarded: true; guardType: 'has-check' | 'null-check' | 'if-check' }
  | { guarded: false; block: Node | undefined };

/**
 * Walk up from the node to find the nearest containing block and check whether
 * any ancestor if-statement condition guards the expression.
 * Returns `{ guarded: true, guardType }` if an ancestor guard is found, or `{ block }` for
 * the containing block (to check preceding statements).
 */
function findContainingBlockAndAncestorGuard(node: Node, exprText: string): AncestorGuardResult {
  let current: Node | undefined = node.getParent();
  let containingBlock: Node | undefined;
  while (current) {
    if (Node.isBlock(current)) {
      const blockParent = current.getParent();
      if (blockParent && Node.isIfStatement(blockParent)) {
        const condText = blockParent.getExpression().getText();
        if (matchesHasGuard(condText, exprText)) {
          return { guarded: true, guardType: 'has-check' };
        }
        if (matchesNullGuard(condText, exprText)) {
          return { guarded: true, guardType: 'null-check' };
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
 * Check whether a preceding statement (within configurable statements) guards the
 * non-null expression via a .has() call or null-check if-statement.
 */
function hasPrecedingGuard(node: Node, exprText: string, block: Node): boolean {
  if (!Node.isBlock(block)) return false;

  const statements = block.getStatements();
  const nodeStmtIndex = findContainingStatementIndex(statements, node);
  if (nodeStmtIndex <= 0) return false;

  const lookback = Math.max(0, nodeStmtIndex - astConfig.typeSafety.guardLookbackDistance);
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
// Observation extraction
// ---------------------------------------------------------------------------

type GuardInfo = { hasGuard: boolean; guardType?: 'if-check' | 'has-check' | 'null-check' };

function detectGuardType(node: Node, exprText: string): GuardInfo {
  const result = findContainingBlockAndAncestorGuard(node, exprText);

  if (result.guarded) {
    // Ancestor guard found via if-statement -- use the specific guard type
    return { hasGuard: true, guardType: result.guardType };
  }

  if (!result.block || !Node.isBlock(result.block)) {
    return { hasGuard: false };
  }

  const statements = result.block.getStatements();
  const nodeStmtIndex = findContainingStatementIndex(statements, node);
  if (nodeStmtIndex <= 0) {
    return { hasGuard: false };
  }

  const lookback = Math.max(0, nodeStmtIndex - astConfig.typeSafety.guardLookbackDistance);
  for (let i = lookback; i < nodeStmtIndex; i++) {
    const stmt = statements[i];
    if (matchesHasGuard(stmt.getText(), exprText)) {
      return { hasGuard: true, guardType: 'has-check' };
    }
    if (Node.isIfStatement(stmt)) {
      const condText = stmt.asKind(SyntaxKind.IfStatement)?.getExpression().getText() ?? '';
      if (matchesNullGuard(condText, exprText)) {
        return { hasGuard: true, guardType: 'null-check' };
      }
    }
  }

  return { hasGuard: false };
}

function getTrustBoundarySource(
  node: Node,
): 'JSON.parse' | '.json()' | 'localStorage' | 'sessionStorage' | 'process.env' | undefined {
  if (!Node.isCallExpression(node) && !Node.isPropertyAccessExpression(node) && !Node.isAwaitExpression(node)) {
    return undefined;
  }

  if (Node.isAwaitExpression(node)) {
    return getTrustBoundarySource(node.getExpression());
  }

  if (Node.isPropertyAccessExpression(node)) {
    const text = node.getText();
    if (text.startsWith('process.env.')) return 'process.env';
    return undefined;
  }

  if (Node.isCallExpression(node)) {
    const calleeExpr = node.getExpression();
    const calleeText = calleeExpr.getText();

    if (calleeText === 'JSON.parse') return 'JSON.parse';

    if (Node.isPropertyAccessExpression(calleeExpr)) {
      const propAccess = calleeExpr.asKind(SyntaxKind.PropertyAccessExpression);
      if (propAccess) {
        const methodName = propAccess.getName();
        if (methodName === 'json') return '.json()';
        if (methodName === 'getItem') {
          const objText = propAccess.getExpression().getText();
          if (objText === 'localStorage') return 'localStorage';
          if (objText === 'sessionStorage') return 'sessionStorage';
        }
      }
    }
  }

  return undefined;
}

function createObservation(
  kind: TypeSafetyObservationKind,
  file: string,
  line: number,
  column: number,
  evidence: TypeSafetyObservationEvidence,
): TypeSafetyObservation {
  return { kind, file, line, column, evidence };
}

function extractObservationFromNode(node: Node, sf: SourceFile, relativePath: string): TypeSafetyObservation | null {
  const line = node.getStartLineNumber();
  const column = sf.getLineAndColumnAtPos(node.getStart()).column;

  // AS_ANY_CAST / AS_UNKNOWN_AS_CAST / TRUST_BOUNDARY_CAST
  if (Node.isAsExpression(node)) {
    const typeNode = node.getTypeNode();
    if (!typeNode) return null;

    const typeText = typeNode.getText();
    if (typeText === 'const') return null; // as const is not a violation

    const isInsideComplexType = isInsideComplexTypeDefinition(node);

    if (typeText === 'any') {
      return createObservation('AS_ANY_CAST', relativePath, line, column, {
        text: truncateText(node.getText(), 80),
        castTarget: 'any',
        sourceExpression: truncateText(node.getExpression().getText(), 60),
        isInsideComplexType,
      });
    }

    // AS_UNKNOWN_AS (double cast)
    const innerExpr = node.getExpression();
    if (Node.isAsExpression(innerExpr)) {
      const innerType = innerExpr.getTypeNode()?.getText();
      if (innerType === 'unknown') {
        return createObservation('AS_UNKNOWN_AS_CAST', relativePath, line, column, {
          text: truncateText(node.getText(), 80),
          castTarget: typeText,
          sourceExpression: truncateText(innerExpr.getExpression().getText(), 60),
          isInsideComplexType,
        });
      }
    }

    // TRUST_BOUNDARY_CAST
    if (typeText !== 'unknown') {
      const castExpr = node.getExpression();
      if (isTrustBoundaryExpression(castExpr)) {
        const source = getTrustBoundarySource(castExpr);
        return createObservation('TRUST_BOUNDARY_CAST', relativePath, line, column, {
          text: truncateText(node.getText(), 80),
          castTarget: typeText,
          sourceExpression: truncateText(castExpr.getText(), 60),
          trustBoundarySource: source,
          isInsideComplexType,
        });
      }
    }

    return null;
  }

  // NON_NULL_ASSERTION
  if (Node.isNonNullExpression(node)) {
    const exprText = node.getExpression().getText();
    const guardInfo = detectGuardType(node, exprText);
    return createObservation('NON_NULL_ASSERTION', relativePath, line, column, {
      text: truncateText(node.getText(), 80),
      sourceExpression: truncateText(exprText, 60),
      hasGuard: guardInfo.hasGuard,
      guardType: guardInfo.guardType,
    });
  }

  // EXPLICIT_ANY_ANNOTATION
  if (node.getKind() === SyntaxKind.AnyKeyword) {
    if (isInsideComplexTypeDefinition(node)) {
      return createObservation('EXPLICIT_ANY_ANNOTATION', relativePath, line, column, {
        text: truncateText(node.getParent()?.getText() ?? 'any', 80),
        isInsideComplexType: true,
      });
    }

    const parent = node.getParent();
    // Skip if this is the type node of an AsExpression (handled by AS_ANY_CAST)
    if (parent && Node.isAsExpression(parent) && parent.getTypeNode() === node) return null;
    // Skip if inside a catch clause (handled by CATCH_ERROR_ANY)
    if (isCatchClauseDescendant(node)) return null;

    return createObservation('EXPLICIT_ANY_ANNOTATION', relativePath, line, column, {
      text: truncateText(parent?.getText() ?? 'any', 80),
      isInsideComplexType: false,
    });
  }

  // CATCH_ERROR_ANY
  if (Node.isCatchClause(node)) {
    const variableDecl = node.getVariableDeclaration();
    if (!variableDecl) return null;

    const typeNode = variableDecl.getTypeNode();
    if (!typeNode || typeNode.getText() !== 'any') return null;

    return createObservation('CATCH_ERROR_ANY', relativePath, line, column, {
      text: truncateText(node.getText().split('{')[0].trim(), 80),
    });
  }

  return null;
}

function extractDirectiveObservations(sf: SourceFile, relativePath: string): TypeSafetyObservation[] {
  const observations: TypeSafetyObservation[] = [];
  const fullText = sf.getFullText();
  const lines = fullText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Match @ts-expect-error, @ts-ignore
    const tsDirectiveMatch = line.match(/\/\/\s*(@ts-expect-error|@ts-ignore)(.*)/);
    if (tsDirectiveMatch) {
      const directive = tsDirectiveMatch[1];
      const afterDirective = tsDirectiveMatch[2].trim();
      const hasExplanation = afterDirective.length > 0 && afterDirective !== '';

      observations.push(
        createObservation('TS_DIRECTIVE', relativePath, lineNumber, line.indexOf('@ts-') + 1, {
          text: truncateText(line.trim(), 80),
          directiveText: directive,
          hasExplanation,
        }),
      );
      continue;
    }

    // Match eslint-disable-next-line or eslint-disable
    const eslintMatch = line.match(/\/\/\s*(eslint-disable(?:-next-line)?)\s*([\w@\/-]*)(.*)/);
    if (eslintMatch) {
      const afterRuleName = eslintMatch[3].trim();
      const hasExplanation = afterRuleName.startsWith('--');

      observations.push(
        createObservation('ESLINT_DISABLE', relativePath, lineNumber, line.indexOf('eslint-disable') + 1, {
          text: truncateText(line.trim(), 80),
          directiveText: eslintMatch[1],
          hasExplanation,
        }),
      );
    }
  }

  return observations;
}

/**
 * Extract all type safety observations from a source file.
 * Observations are objective structural facts with evidence.
 */
export function extractTypeSafetyObservations(filePath: string): TypeSafetyObservation[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const observations: TypeSafetyObservation[] = [];

  sf.forEachDescendant(node => {
    const observation = extractObservationFromNode(node, sf, relativePath);
    if (observation) {
      observations.push(observation);
    }
  });

  // Add directive observations
  observations.push(...extractDirectiveObservations(sf, relativePath));

  // Sort by line number
  observations.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

  return observations;
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
  const observations = extractTypeSafetyObservations(filePath);

  return {
    filePath: relativePath,
    violations,
    summary,
    observations,
  };
}

export function analyzeTypeSafetyDirectory(dirPath: string, options: { noCache?: boolean } = {}): TypeSafetyAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: TypeSafetyAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-type-safety', fp, () => analyzeTypeSafety(fp), options);
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
      'Usage: npx tsx scripts/AST/ast-type-safety.ts <path...> [--pretty] [--no-cache]\n' +
        '\n' +
        'Analyze type assertion safety and violation patterns.\n' +
        '\n' +
        '  <path...>   One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty    Format JSON output with indentation\n' +
        '  --no-cache  Bypass cache and recompute\n',
    );
    process.exit(0);
  }

  const noCache = hasNoCacheFlag(process.argv);

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
    const results = analyzeTypeSafetyDirectory(targetPath, { noCache });
    output(results, args.pretty);
    const stats = getCacheStats();
    if (stats.hits > 0 || stats.misses > 0) {
      process.stderr.write(`Cache: ${stats.hits} hits, ${stats.misses} misses\n`);
    }
  } else {
    const result = cached('ast-type-safety', absolute, () => analyzeTypeSafety(targetPath), { noCache });
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-type-safety.ts') || process.argv[1].endsWith('ast-type-safety'));

if (isDirectRun) {
  main();
}
