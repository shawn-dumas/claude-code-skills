/**
 * AST tool: AuthZ Audit
 *
 * Detects raw role check patterns (roles.includes(Role.ADMIN), etc.)
 * outside canonical authorization files. These should use the shared
 * utility functions from roleChecks.ts instead.
 *
 * Canonical files (configured in ast-config.ts) are excluded from
 * analysis since they are the approved location for role checks.
 */

import { Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { FileFilter } from './shared';
import type { AuthZAnalysis, AuthZObservation } from './types';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if any argument in a call expression is a Role.MEMBER property access.
 * Returns the member name (e.g., 'ADMIN') or null.
 */
function findRoleMemberInArgs(args: Node[]): string | null {
  for (const arg of args) {
    if (Node.isPropertyAccessExpression(arg)) {
      const expr = arg.getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'Role') {
        return arg.getName();
      }
    }
  }
  return null;
}

/**
 * Search a node tree for any PropertyAccessExpression where the left side
 * is the identifier 'Role'. Returns the first member name found, or null.
 */
function findRoleMemberInTree(node: Node): string | null {
  let found: string | null = null;
  node.forEachDescendant((child, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    if (Node.isPropertyAccessExpression(child)) {
      const expr = child.getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'Role') {
        found = child.getName();
        traversal.stop();
      }
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function analyzeAuthZ(filePath: string): AuthZAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  // Skip canonical files
  if (astConfig.authz.canonicalFiles.has(relativePath)) {
    return { filePath: relativePath, observations: [] };
  }

  const sourceFile = getSourceFile(absolute);
  const observations: AuthZObservation[] = [];

  sourceFile.forEachDescendant((node, traversal) => {
    // --- Branch 1: CallExpression (array method patterns) ---
    if (Node.isCallExpression(node)) {
      const expression = node.getExpression();
      if (!Node.isPropertyAccessExpression(expression)) return;

      const methodName = expression.getName();
      if (!astConfig.authz.rawCheckMethods.has(methodName)) return;

      const callArgs = node.getArguments();

      if (methodName === 'includes' || methodName === 'indexOf') {
        const roleMember = findRoleMemberInArgs(callArgs);
        if (!roleMember) return;

        observations.push({
          kind: 'RAW_ROLE_CHECK',
          file: relativePath,
          line: node.getStartLineNumber(),
          evidence: {
            method: methodName,
            roleMember,
            expression: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
          },
        });
      } else if (methodName === 'some' || methodName === 'find' || methodName === 'filter' || methodName === 'every') {
        const callback = callArgs[0];
        if (!callback) return;
        if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) return;

        const roleMember = findRoleMemberInTree(callback);
        if (!roleMember) return;

        observations.push({
          kind: 'RAW_ROLE_CHECK',
          file: relativePath,
          line: node.getStartLineNumber(),
          evidence: {
            method: methodName,
            roleMember,
            expression: truncateText(node.getText(), 80),
            containingFunction: getContainingFunctionName(node),
          },
        });

        // Skip descendants to avoid double-counting BinaryExpressions
        // inside the callback (e.g., `r === Role.ADMIN` inside `some()`)
        traversal.skip();
      }
      return;
    }

    // --- Branch 2: BinaryExpression (equality patterns: === Role.X, !== Role.X) ---
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getText();
      if (!astConfig.authz.equalityOperators.has(operator)) return;

      const left = node.getLeft();
      const right = node.getRight();

      // Check if either operand is a Role.MEMBER property access
      let roleMember: string | null = null;
      for (const operand of [left, right]) {
        if (Node.isPropertyAccessExpression(operand)) {
          const expr = operand.getExpression();
          if (Node.isIdentifier(expr) && expr.getText() === 'Role') {
            roleMember = operand.getName();
            break;
          }
        }
      }
      if (!roleMember) return;

      observations.push({
        kind: 'RAW_ROLE_EQUALITY',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          method: operator,
          roleMember,
          expression: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
        },
      });
    }
  });

  return { filePath: relativePath, observations };
}

// ---------------------------------------------------------------------------
// Directory analysis
// ---------------------------------------------------------------------------

export function analyzeAuthZDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): AuthZAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const files = getFilesInDirectory(absolute, options.filter ?? 'production');
  const results: AuthZAnalysis[] = [];

  for (const fp of files) {
    const analysis = cached('ast-authz-audit', fp, () => analyzeAuthZ(fp), options);
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractAuthZObservations(analysis: AuthZAnalysis): AuthZObservation[] {
  return [...analysis.observations];
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-authz-audit.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Detect raw role check patterns outside canonical files.\n' +
        '\n' +
        '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute\n' +
        '  --test-files  Scan test files instead of production files\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n' +
        '\n' +
        'Observation kinds:\n' +
        '  RAW_ROLE_CHECK      Raw role array method call with Role.MEMBER argument\n' +
        '  RAW_ROLE_EQUALITY   Equality comparison (=== or !==) with Role.MEMBER\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');
  const testFiles = args.flags.has('test-files');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: AuthZAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeAuthZDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }));
    } else {
      const result = cached('ast-authz-audit', absolute, () => analyzeAuthZ(targetPath), { noCache });
      if (result.observations.length > 0) {
        allResults.push(result);
      }
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
  process.argv[1] && (process.argv[1].endsWith('ast-authz-audit.ts') || process.argv[1].endsWith('ast-authz-audit'));

if (isDirectRun) {
  main();
}
