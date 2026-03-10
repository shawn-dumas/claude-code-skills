import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { TypeSafetyAnalysis, TypeSafetyViolation, TypeSafetyViolationType } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateText(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.substring(0, maxLen - 3) + '...';
}

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

function isTrustBoundaryExpression(node: Node): boolean {
  // Direct call: JSON.parse(...), readStorage(...)
  if (Node.isCallExpression(node)) {
    const exprText = node.getExpression().getText();
    for (const pattern of TRUST_BOUNDARY_CALLS) {
      if (exprText === pattern) return true;
    }
    // Method call: response.json()
    if (Node.isPropertyAccessExpression(node.getExpression())) {
      const methodName = node.getExpression().asKind(SyntaxKind.PropertyAccessExpression)?.getName();
      for (const pattern of TRUST_BOUNDARY_METHOD_CALLS) {
        if (methodName === pattern.substring(1)) return true;
      }
    }
    // localStorage.getItem(...), sessionStorage.getItem(...)
    if (Node.isPropertyAccessExpression(node.getExpression())) {
      const propAccess = node.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
      if (propAccess) {
        const fullText = propAccess.getText();
        for (const pattern of TRUST_BOUNDARY_PROPERTY_ACCESS) {
          if (fullText === pattern || fullText.endsWith(`.${pattern.split('.').pop()}`)) {
            const objText = propAccess.getExpression().getText();
            if (pattern.startsWith(objText)) return true;
          }
        }
      }
    }
    return false;
  }

  // Property access: process.env.VAR
  if (Node.isPropertyAccessExpression(node)) {
    const text = node.getText();
    if (text.startsWith('process.env.')) return true;
  }

  // Await of a trust boundary call: await response.json()
  if (Node.isAwaitExpression(node)) {
    const inner = node.getExpression();
    return isTrustBoundaryExpression(inner);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Non-null assertion guard detection
// ---------------------------------------------------------------------------

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

  // Walk up to find the containing block, checking for if-statement guards
  let current: Node | undefined = node.getParent();
  let containingBlock: Node | undefined;
  while (current) {
    // Check if we are inside an if-statement's then-block
    if (Node.isBlock(current)) {
      const blockParent = current.getParent();
      if (blockParent && Node.isIfStatement(blockParent)) {
        const condText = blockParent.getExpression().getText();
        // if (map.has(key)) { map.get(key)! }
        if (condText.includes('.has(')) {
          const dotGet = exprText.match(/^(.+)\.get\(/);
          if (dotGet) {
            const obj = dotGet[1];
            if (condText.includes(`${obj}.has(`)) return true;
          }
        }
        // if (x) or if (x != null) etc.
        if (
          condText === exprText ||
          condText === `${exprText} != null` ||
          condText === `${exprText} !== null` ||
          condText === `${exprText} !== undefined` ||
          condText === `${exprText} != undefined`
        ) {
          return true;
        }
      }

      if (!containingBlock) {
        containingBlock = current;
      }
    }
    current = current.getParent();
  }

  if (!containingBlock || !Node.isBlock(containingBlock)) return false;

  // Find the statement containing our node
  const statements = containingBlock.getStatements();
  let nodeStmtIndex = -1;
  for (let i = 0; i < statements.length; i++) {
    if (statements[i].getPos() <= node.getPos() && statements[i].getEnd() >= node.getEnd()) {
      nodeStmtIndex = i;
      break;
    }
  }

  if (nodeStmtIndex <= 0) return false;

  // Check previous 3 statements for guard patterns
  const lookback = Math.max(0, nodeStmtIndex - 3);
  for (let i = lookback; i < nodeStmtIndex; i++) {
    const stmtText = statements[i].getText();

    // .has() check
    if (stmtText.includes('.has(')) {
      const dotGet = exprText.match(/^(.+)\.get\(/);
      if (dotGet) {
        const obj = dotGet[1];
        if (stmtText.includes(`${obj}.has(`)) return true;
      }
    }

    // if (x) / if (x != null) guard
    if (Node.isIfStatement(statements[i])) {
      const condText = statements[i].asKind(SyntaxKind.IfStatement)?.getExpression().getText() ?? '';
      if (
        condText === exprText ||
        condText === `${exprText} != null` ||
        condText === `${exprText} !== null` ||
        condText === `${exprText} !== undefined`
      ) {
        return true;
      }
    }
  }

  return false;
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
// Main analysis walker
// ---------------------------------------------------------------------------

function findViolations(sf: SourceFile): TypeSafetyViolation[] {
  const violations: TypeSafetyViolation[] = [];

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // --- AS_ANY ---
    if (Node.isAsExpression(node)) {
      const typeNode = node.getTypeNode();
      if (typeNode) {
        const typeText = typeNode.getText();

        // "as const" is NOT a violation
        if (typeText === 'const') return;

        if (typeText === 'any') {
          violations.push({
            type: 'AS_ANY',
            line,
            column,
            text: truncateText(node.getText(), 80),
            context: 'Unsafe cast to any',
          });
          return;
        }

        // --- AS_UNKNOWN_AS (double cast) ---
        const innerExpr = node.getExpression();
        if (Node.isAsExpression(innerExpr)) {
          const innerType = innerExpr.getTypeNode()?.getText();
          if (innerType === 'unknown') {
            violations.push({
              type: 'AS_UNKNOWN_AS',
              line,
              column,
              text: truncateText(node.getText(), 80),
              context: `Double cast via unknown to ${typeText}`,
            });
            return;
          }
        }

        // --- TRUST_BOUNDARY_CAST ---
        if (typeText !== 'any' && typeText !== 'unknown') {
          const castExpr = node.getExpression();
          if (isTrustBoundaryExpression(castExpr)) {
            violations.push({
              type: 'TRUST_BOUNDARY_CAST',
              line,
              column,
              text: truncateText(node.getText(), 80),
              context: `Trust boundary cast to ${typeText} -- use Zod/type guard instead`,
            });
          }
        }
      }
    }

    // --- NON_NULL_ASSERTION ---
    if (Node.isNonNullExpression(node)) {
      const guarded = isNonNullGuarded(node);
      violations.push({
        type: 'NON_NULL_ASSERTION',
        line,
        column,
        text: truncateText(node.getText(), 80),
        context: guarded ? 'guarded: true' : 'guarded: false',
      });
    }

    // --- EXPLICIT_ANY_ANNOTATION ---
    // Check type keywords that are `any`
    if (node.getKind() === SyntaxKind.AnyKeyword) {
      // Skip if inside a complex type definition (conditional/mapped types)
      if (isInsideComplexTypeDefinition(node)) return;

      // Skip if this is the type node of an AsExpression (handled by AS_ANY)
      const parent = node.getParent();
      if (parent && Node.isAsExpression(parent) && parent.getTypeNode() === node) return;

      // Check if this is a catch clause variable type (handled by CATCH_ERROR_ANY)
      let isCatchParam = false;
      let cur: Node | undefined = node;
      while (cur) {
        if (Node.isCatchClause(cur)) {
          isCatchParam = true;
          break;
        }
        if (Node.isStatement(cur)) break;
        cur = cur.getParent();
      }
      if (isCatchParam) return;

      violations.push({
        type: 'EXPLICIT_ANY_ANNOTATION',
        line,
        column,
        text: truncateText(parent?.getText() ?? 'any', 80),
        context: 'Explicit any in type annotation',
      });
    }

    // --- CATCH_ERROR_ANY ---
    if (Node.isCatchClause(node)) {
      const variableDecl = node.getVariableDeclaration();
      if (variableDecl) {
        const typeNode = variableDecl.getTypeNode();
        if (typeNode && typeNode.getText() === 'any') {
          violations.push({
            type: 'CATCH_ERROR_ANY',
            line,
            column,
            text: truncateText(node.getText().split('{')[0].trim(), 80),
            context: 'Use catch (error: unknown) instead',
          });
        }
      }
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
