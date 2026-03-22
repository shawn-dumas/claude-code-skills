import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import type { NumberFormatAnalysis, NumberFormatObservation } from './types';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the context of a node (where it appears in the code).
 */
function getNodeContext(node: Node): string {
  const parent = node.getParent();
  if (!parent) return 'other';

  // Template expression
  if (Node.isTemplateSpan(parent) || Node.isTemplateExpression(parent)) {
    return 'template-literal';
  }

  // Binary expression with + (string concatenation)
  if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getText() === '+') {
    return 'string-concatenation';
  }

  // Return statement
  if (Node.isReturnStatement(parent)) {
    return 'return-value';
  }

  // Variable declaration / assignment
  if (Node.isVariableDeclaration(parent) || Node.isBinaryExpression(parent)) {
    return 'assignment';
  }

  // Call expression argument
  if (Node.isCallExpression(parent)) {
    return 'argument';
  }

  // JSX expression
  if (Node.isJsxExpression(parent)) {
    return 'jsx-attribute';
  }

  return 'other';
}

/**
 * Extract the first N args as truncated strings.
 */
function extractArgs(node: import('ts-morph').CallExpression, maxArgs = 3): string[] {
  return node
    .getArguments()
    .slice(0, maxArgs)
    .map(a => truncateText(a.getText(), 60));
}

/**
 * Try to parse a numeric literal from a node.
 */
function parseNumericArg(node: Node): number | undefined {
  if (Node.isNumericLiteral(node)) {
    return Number(node.getLiteralValue());
  }
  return undefined;
}

/**
 * Check if a containing function name starts with 'format' (case-sensitive).
 */
function isInsideFormatter(containingFunction: string): boolean {
  return containingFunction.startsWith('format');
}

/**
 * Check if a file path matches a formatter exemption or fixture path.
 * Formatter files define the canonical formatting behavior and are exempt
 * from RAW_TO_FIXED / RAW_TO_LOCALE_STRING observations. Fixture files
 * generate test data, not display values.
 */
function isExemptFile(relativePath: string): boolean {
  for (const exemptPath of astConfig.displayFormat.formatterFilePaths) {
    if (relativePath.includes(exemptPath)) return true;
  }
  return relativePath.startsWith('src/fixtures/');
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractNumberFormatObservations(sf: SourceFile): NumberFormatObservation[] {
  const observations: NumberFormatObservation[] = [];
  const relativePath = path.relative(PROJECT_ROOT, sf.getFilePath());
  const formatFunctions = astConfig.displayFormat.formatFunctions;

  sf.forEachDescendant(node => {
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;

    // --- CallExpression detections ---
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();

      // Direct identifier calls: formatNumber(), formatInt(), formatDuration(), formatCellValue()
      if (Node.isIdentifier(expr)) {
        const name = expr.getText();

        if (name === 'formatNumber' && formatFunctions.has('formatNumber')) {
          const args = extractArgs(node);
          const secondArg = node.getArguments()[1];
          observations.push({
            kind: 'FORMAT_NUMBER_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              callee: 'formatNumber',
              args,
              decimalPlaces: secondArg ? parseNumericArg(secondArg) : undefined,
              containingFunction: getContainingFunctionName(node),
              context: getNodeContext(node),
            },
          });
          return;
        }

        if (name === 'formatInt' && formatFunctions.has('formatInt')) {
          observations.push({
            kind: 'FORMAT_INT_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              callee: 'formatInt',
              args: extractArgs(node),
              containingFunction: getContainingFunctionName(node),
              context: getNodeContext(node),
            },
          });
          return;
        }

        if (name === 'formatDuration' && formatFunctions.has('formatDuration')) {
          observations.push({
            kind: 'FORMAT_DURATION_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              callee: 'formatDuration',
              args: extractArgs(node),
              containingFunction: getContainingFunctionName(node),
              context: getNodeContext(node),
            },
          });
          return;
        }

        if (name === 'formatCellValue' && formatFunctions.has('formatCellValue')) {
          const args = extractArgs(node);
          const unitsArg = node.getArguments()[1];
          observations.push({
            kind: 'FORMAT_CELL_VALUE_CALL',
            file: relativePath,
            line,
            column,
            evidence: {
              callee: 'formatCellValue',
              args,
              unitsType: unitsArg ? truncateText(unitsArg.getText(), 40) : undefined,
              containingFunction: getContainingFunctionName(node),
              context: getNodeContext(node),
            },
          });
          return;
        }
      }

      // Property access calls: <expr>.toFixed(), <expr>.toLocaleString()
      if (Node.isPropertyAccessExpression(expr)) {
        const method = expr.getName();
        const containingFunction = getContainingFunctionName(node);

        if (method === 'toFixed') {
          if (!isInsideFormatter(containingFunction) && !isExemptFile(relativePath)) {
            const args = extractArgs(node);
            const firstArg = node.getArguments()[0];
            observations.push({
              kind: 'RAW_TO_FIXED',
              file: relativePath,
              line,
              column,
              evidence: {
                callee: 'toFixed',
                args,
                decimalPlaces: firstArg ? parseNumericArg(firstArg) : undefined,
                containingFunction,
                context: getNodeContext(node),
              },
            });
          }
          // Do not return -- a toFixed inside a % template may also emit PERCENTAGE_DISPLAY
        }

        if (method === 'toLocaleString') {
          if (!isInsideFormatter(containingFunction) && !isExemptFile(relativePath)) {
            observations.push({
              kind: 'RAW_TO_LOCALE_STRING',
              file: relativePath,
              line,
              column,
              evidence: {
                callee: 'toLocaleString',
                args: extractArgs(node),
                containingFunction,
                context: getNodeContext(node),
              },
            });
          }
          return;
        }
      }
    }

    // --- new Intl.NumberFormat() detection ---
    if (Node.isNewExpression(node)) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const obj = expr.getExpression();
        const prop = expr.getName();
        if (Node.isIdentifier(obj) && obj.getText() === 'Intl' && prop === 'NumberFormat') {
          observations.push({
            kind: 'INTL_NUMBER_FORMAT',
            file: relativePath,
            line,
            column,
            evidence: {
              callee: 'Intl.NumberFormat',
              args: node
                .getArguments()
                .slice(0, 2)
                .map(a => truncateText(a.getText(), 60)),
              containingFunction: getContainingFunctionName(node),
              context: getNodeContext(node),
            },
          });
          return;
        }
      }
    }

    // --- PERCENTAGE_DISPLAY detection: TemplateExpression with % ---
    if (Node.isTemplateExpression(node)) {
      const spans = node.getTemplateSpans();
      for (const span of spans) {
        const literalText = span.getLiteral().getText();
        // Template literal segments: TemplateMiddle starts with }, TemplateTail starts with }
        // The raw text includes the delimiters. Strip leading } and check if next char is %
        const textAfterInterpolation = literalText.startsWith('}') ? literalText.slice(1) : literalText;
        if (!textAfterInterpolation.startsWith('%')) continue;

        const spanExpr = span.getExpression();
        let callee = '';
        let decimalPlaces: number | undefined;

        // Check if the interpolated expression is toFixed(N)
        if (Node.isCallExpression(spanExpr)) {
          const callExpr = spanExpr.getExpression();
          if (Node.isPropertyAccessExpression(callExpr) && callExpr.getName() === 'toFixed') {
            callee = 'toFixed';
            const arg = spanExpr.getArguments()[0];
            decimalPlaces = arg ? parseNumericArg(arg) : undefined;
          } else if (Node.isPropertyAccessExpression(callExpr)) {
            // Math.round(x)
            const objText = callExpr.getExpression().getText();
            const methodName = callExpr.getName();
            if (objText === 'Math' && methodName === 'round') {
              callee = 'Math.round';
              decimalPlaces = 0;
            }
          } else if (Node.isIdentifier(callExpr)) {
            // Direct call like Math.round -- captured by property access above
            callee = callExpr.getText();
          }
        }

        if (callee) {
          observations.push({
            kind: 'PERCENTAGE_DISPLAY',
            file: relativePath,
            line: span.getStartLineNumber(),
            column: sf.getLineAndColumnAtPos(span.getStart()).column,
            evidence: {
              callee,
              decimalPlaces,
              containingFunction: getContainingFunctionName(node),
              context: 'template-literal',
            },
          });
        }
      }
    }
  });

  // Sort by line number
  observations.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

  return observations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeNumberFormat(filePath: string): NumberFormatAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const observations = extractNumberFormatObservations(sf);

  return {
    filePath: relativePath,
    observations,
  };
}

export function analyzeNumberFormatDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): NumberFormatAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: NumberFormatAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('number-format', fp, () => analyzeNumberFormat(fp), options);
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
      'Usage: npx tsx scripts/AST/ast-number-format.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze number formatting patterns (formatNumber, toFixed, Intl.NumberFormat, etc.).\n' +
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

  const allResults: NumberFormatAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeNumberFormatDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('number-format', absolute, () => analyzeNumberFormat(absolute), { noCache });
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
  process.argv[1] &&
  (process.argv[1].endsWith('ast-number-format.ts') || process.argv[1].endsWith('ast-number-format'));

if (isDirectRun) {
  main();
}
