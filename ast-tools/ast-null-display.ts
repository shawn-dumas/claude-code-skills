import { type SourceFile, Node, SyntaxKind } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, getContainingFunctionName, type FileFilter } from './shared';
import type { NullDisplayAnalysis, NullDisplayObservation } from './types';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the file imports or defines NO_VALUE_PLACEHOLDER.
 * The definition file (global.ts) exports the constant -- it should not
 * be flagged for HARDCODED_PLACEHOLDER since it IS the canonical source.
 */
function fileHasPlaceholderConstant(sf: SourceFile): boolean {
  const constantName = astConfig.displayFormat.placeholderConstant;
  // Check imports
  for (const importDecl of sf.getImportDeclarations()) {
    for (const namedImport of importDecl.getNamedImports()) {
      if (namedImport.getName() === constantName) return true;
    }
  }
  // Check exports / variable declarations (the definition file)
  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarations()) {
      if (decl.getName() === constantName) return true;
    }
  }
  return false;
}

/**
 * Check whether a file path matches any formatter exemption path.
 */
function isFormatterFile(filePath: string): boolean {
  for (const exemptPath of astConfig.displayFormat.formatterFilePaths) {
    if (filePath.includes(exemptPath)) return true;
  }
  return false;
}

/**
 * Determine whether the node is inside a table column context.
 * Checks:
 *   1. Containing function name starts with "use" and contains "Columns"
 *   2. File path contains "Columns"
 *   3. Node is inside a columnHelper.accessor() or columnHelper.display() call
 */
function isTableColumnContext(node: Node, containingFunction: string, filePath: string): boolean {
  if (/^use\w*Columns/.test(containingFunction) || filePath.includes('Columns')) {
    return true;
  }
  return isInsideColumnHelperCall(node);
}

/**
 * Walk up the AST to check whether the node is inside a columnHelper.accessor()
 * or columnHelper.display() call expression.
 */
function isInsideColumnHelperCall(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isCallExpression(current)) {
      const expr = current.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName();
        const objText = expr.getExpression().getText();
        if ((methodName === 'accessor' || methodName === 'display') && objText.endsWith('columnHelper')) {
          return true;
        }
      }
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Check whether the truthy branch of a conditional proves numeric context.
 * Returns true if the branch:
 *   1. Calls a known format function from astConfig.displayFormat.formatFunctions
 *   2. Returns a numeric-format string like "0.00", "0", "0.0"
 */
function provesNumericContext(node: Node): boolean {
  // Check the node itself and all descendants for format function calls
  const checkNode = (n: Node): boolean => {
    if (Node.isCallExpression(n)) {
      const expr = n.getExpression();
      if (Node.isIdentifier(expr)) {
        if (astConfig.displayFormat.formatFunctions.has(expr.getText())) {
          return true;
        }
      }
    }
    return false;
  };

  if (checkNode(node)) return true;

  let hasFormatCall = false;
  node.forEachDescendant(child => {
    if (hasFormatCall) return;
    if (checkNode(child)) hasFormatCall = true;
  });
  if (hasFormatCall) return true;

  // Check for numeric string returns like "0.00"
  if (Node.isStringLiteral(node)) {
    return /^\d+(\.\d+)?$/.test(node.getLiteralValue());
  }

  return false;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractNullDisplayObservations(sf: SourceFile): NullDisplayObservation[] {
  const observations: NullDisplayObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());
  const usesConstant = fileHasPlaceholderConstant(sf);
  const isFormatter = isFormatterFile(relativePath);

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const containingFunction = getContainingFunctionName(node);
    const tableColumn = isTableColumnContext(node, containingFunction, relativePath);

    // --- BinaryExpression: ?? and || operators ---
    if (Node.isBinaryExpression(node)) {
      const operatorToken = node.getOperatorToken().getText();
      const right = node.getRight();

      // NULL_COALESCE_FALLBACK: expr ?? 'placeholder'
      if (operatorToken === '??' && Node.isStringLiteral(right)) {
        const value = right.getLiteralValue();
        if (astConfig.displayFormat.placeholderStrings.has(value)) {
          observations.push({
            kind: 'NULL_COALESCE_FALLBACK',
            file: relativePath,
            line,
            evidence: {
              operator: '??',
              fallbackValue: `'${value}'`,
              usesConstant,
              containingFunction,
              isTableColumn: tableColumn,
              context: `nullish coalescing to '${value}'`,
            },
          });
        }
      }

      // FALSY_COALESCE_FALLBACK: expr || 'placeholder'
      if (operatorToken === '||' && Node.isStringLiteral(right)) {
        const value = right.getLiteralValue();
        if (astConfig.displayFormat.placeholderStrings.has(value)) {
          observations.push({
            kind: 'FALSY_COALESCE_FALLBACK',
            file: relativePath,
            line,
            evidence: {
              operator: '||',
              fallbackValue: `'${value}'`,
              usesConstant,
              containingFunction,
              isTableColumn: tableColumn,
              context: `falsy coalescing to '${value}'`,
            },
          });
        }
      }
    }

    // --- NO_FALLBACK_CELL: cell: ({ getValue }) => getValue() ---
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName();
        const objText = expr.getExpression().getText();
        if ((methodName === 'accessor' || methodName === 'display') && objText.endsWith('columnHelper')) {
          detectNoFallbackCell(node, relativePath, observations);
        }
      }
    }

    // --- HARDCODED_PLACEHOLDER: '-' literal without constant import ---
    if (!isFormatter && !usesConstant && Node.isStringLiteral(node)) {
      const value = node.getLiteralValue();
      if (value === astConfig.displayFormat.placeholderValue) {
        // Only flag when used as a return value or in display context
        // (ternary consequence/alternate, return statement, coalescing RHS)
        if (isDisplayContext(node)) {
          // Avoid double-counting: skip if the parent binary expression will
          // already emit a NULL_COALESCE_FALLBACK or FALSY_COALESCE_FALLBACK.
          // The interpreter (ast-interpret-display-format.ts) compensates by
          // classifying coalesce observations with '-' + !usesConstant as
          // HARDCODED_DASH. See classifyHardcodedDash() there.
          const parent = node.getParent();
          if (parent && Node.isBinaryExpression(parent)) {
            const op = parent.getOperatorToken().getText();
            if (op === '??' || op === '||') {
              return;
            }
          }

          observations.push({
            kind: 'HARDCODED_PLACEHOLDER',
            file: relativePath,
            line,
            evidence: {
              fallbackValue: `'${value}'`,
              usesConstant: false,
              containingFunction,
              isTableColumn: tableColumn,
              context: `hardcoded '${value}' without NO_VALUE_PLACEHOLDER import`,
            },
          });
        }
      }
    }

    // --- EMPTY_STATE_MESSAGE: known empty state messages ---
    if (Node.isStringLiteral(node) || Node.isJsxText(node)) {
      const text = Node.isStringLiteral(node) ? node.getLiteralValue() : node.getText().trim();
      if (text === astConfig.displayFormat.canonicalEmptyMessage) {
        observations.push({
          kind: 'EMPTY_STATE_MESSAGE',
          file: relativePath,
          line,
          evidence: {
            fallbackValue: `'${text}'`,
            containingFunction,
            context: 'canonical empty state message',
          },
        });
      } else if (astConfig.displayFormat.wrongEmptyMessages.has(text)) {
        observations.push({
          kind: 'EMPTY_STATE_MESSAGE',
          file: relativePath,
          line,
          evidence: {
            fallbackValue: `'${text}'`,
            containingFunction,
            context: 'wrong empty state message',
          },
        });
      }
    }

    // --- ZERO_CONFLATION: !value where truthy branch proves numeric context ---
    detectZeroConflation(node, relativePath, containingFunction, tableColumn, observations);
  });

  // Sort by line number
  observations.sort((a, b) => a.line - b.line);

  return observations;
}

/**
 * Check whether a string literal node is in a "display context" --
 * used as a return value, ternary consequence/alternate, or similar.
 */
function isDisplayContext(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  // return '-';
  if (Node.isReturnStatement(parent)) return true;

  // condition ? x : '-'  or  condition ? '-' : x
  if (Node.isConditionalExpression(parent)) return true;

  // const x = '-';
  if (Node.isVariableDeclaration(parent)) return true;

  // Arrow function with expression body: () => '-'
  if (Node.isArrowFunction(parent)) return true;

  // Part of a binary expression (already handled for ?? and || above)
  if (Node.isBinaryExpression(parent)) return true;

  // JSX expression: {'-'} inside JSX
  if (Node.isJsxExpression(parent)) return true;

  return false;
}

/**
 * Detect NO_FALLBACK_CELL inside a columnHelper.accessor() or .display() call.
 * Fires only when getValue() is the sole return value of the cell property.
 */
function detectNoFallbackCell(callNode: Node, filePath: string, observations: NullDisplayObservation[]): void {
  if (!Node.isCallExpression(callNode)) return;

  const args = callNode.getArguments();
  // accessor has 2 args (key, options), display has 1 arg (options)
  const optionsArg = args.length >= 2 ? args[1] : args[0];
  if (!optionsArg || !Node.isObjectLiteralExpression(optionsArg)) return;

  const cellProp = optionsArg.getProperty('cell');
  if (!cellProp || !Node.isPropertyAssignment(cellProp)) return;

  const cellInit = cellProp.getInitializer();
  if (!cellInit) return;

  // cell: ({ getValue }) => getValue()
  // cell: (info) => info.getValue()
  if (Node.isArrowFunction(cellInit)) {
    const body = cellInit.getBody();
    if (isBareGetValueCall(body)) {
      observations.push({
        kind: 'NO_FALLBACK_CELL',
        file: filePath,
        line: cellInit.getStartLineNumber(),
        evidence: {
          containingFunction: getContainingFunctionName(callNode),
          isTableColumn: true,
          context: 'table cell returns getValue() with no null handling',
        },
      });
    }
  }
}

/**
 * Check whether a node is a bare getValue() call (not wrapped in a formatter).
 */
function isBareGetValueCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();

  // getValue()
  if (Node.isIdentifier(expr) && expr.getText() === 'getValue') {
    return node.getArguments().length === 0;
  }

  // info.getValue() or cell.getValue()
  if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'getValue') {
    return node.getArguments().length === 0;
  }

  return false;
}

/**
 * Detect ZERO_CONFLATION: !value patterns where the truthy/falsy branch
 * proves numeric context.
 */
function detectZeroConflation(
  node: Node,
  filePath: string,
  containingFunction: string,
  isTableColumn: boolean,
  observations: NullDisplayObservation[],
): void {
  // Pattern 1: if (!value) return <numeric-string>
  if (Node.isIfStatement(node)) {
    const condition = node.getExpression();
    if (Node.isPrefixUnaryExpression(condition) && condition.getOperatorToken() === SyntaxKind.ExclamationToken) {
      const thenStmt = node.getThenStatement();
      if (thenStmt) {
        // Check for return statement with numeric string
        const returnNodes: Node[] = [];
        if (Node.isReturnStatement(thenStmt)) {
          returnNodes.push(thenStmt);
        } else if (Node.isBlock(thenStmt)) {
          for (const stmt of thenStmt.getStatements()) {
            if (Node.isReturnStatement(stmt)) returnNodes.push(stmt);
          }
        }
        for (const retNode of returnNodes) {
          if (Node.isReturnStatement(retNode)) {
            const retExpr = retNode.getExpression();
            if (retExpr && Node.isStringLiteral(retExpr)) {
              if (/^\d+(\.\d+)?$/.test(retExpr.getLiteralValue())) {
                observations.push({
                  kind: 'ZERO_CONFLATION',
                  file: filePath,
                  line: node.getStartLineNumber(),
                  evidence: {
                    operator: '!',
                    fallbackValue: `'${retExpr.getLiteralValue()}'`,
                    containingFunction,
                    isTableColumn,
                    context: '!value guard with numeric string return conflates 0 with null',
                  },
                });
                return;
              }
            }
          }
        }

        // Check if the else branch (the truthy path for value) calls a format function
        const elseStmt = node.getElseStatement();
        if (elseStmt && provesNumericContext(elseStmt)) {
          observations.push({
            kind: 'ZERO_CONFLATION',
            file: filePath,
            line: node.getStartLineNumber(),
            evidence: {
              operator: '!',
              containingFunction,
              isTableColumn,
              context: '!value guard where else branch proves numeric context',
            },
          });
          return;
        }
      }
    }
  }

  // Pattern 2: val ? formatDuration(val) : '-' (ternary with !value semantics)
  if (Node.isConditionalExpression(node)) {
    const condition = node.getCondition();
    // Truthy check on an identifier or property access: val ? ... : ...
    // or data.count ? ... : ... -- both conflate 0 with null/undefined
    if (Node.isIdentifier(condition) || Node.isPropertyAccessExpression(condition)) {
      const whenTrue = node.getWhenTrue();
      const whenFalse = node.getWhenFalse();

      // truthy branch calls a format function -> numeric context proven
      if (provesNumericContext(whenTrue)) {
        // Additionally verify the falsy branch is a placeholder string or has one
        const falsyIsPlaceholder =
          Node.isStringLiteral(whenFalse) &&
          astConfig.displayFormat.placeholderStrings.has(whenFalse.getLiteralValue());

        if (falsyIsPlaceholder) {
          observations.push({
            kind: 'ZERO_CONFLATION',
            file: filePath,
            line: node.getStartLineNumber(),
            evidence: {
              operator: '?:',
              fallbackValue: Node.isStringLiteral(whenFalse) ? `'${whenFalse.getLiteralValue()}'` : undefined,
              containingFunction,
              isTableColumn,
              context: 'truthy check with format function call conflates 0 with null',
            },
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeNullDisplay(filePath: string): NullDisplayAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const observations = extractNullDisplayObservations(sf);

  return {
    filePath: relativePath,
    observations,
  };
}

export function analyzeNullDisplayDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): NullDisplayAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: NullDisplayAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('null-display', fp, () => analyzeNullDisplay(fp), options);
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

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-null-display.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze null/empty/zero display patterns in TypeScript/TSX files.\n' +
        '\n' +
        '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
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

  const allResults: NullDisplayAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeNullDisplayDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('null-display', absolute, () => analyzeNullDisplay(absolute), { noCache });
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
  process.argv[1] && (process.argv[1].endsWith('ast-null-display.ts') || process.argv[1].endsWith('ast-null-display'));

if (isDirectRun) {
  main();
}
