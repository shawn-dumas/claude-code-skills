/**
 * AST tool: Date Handling Analysis
 *
 * Detects raw Date usage vs. proper date handling (Temporal, formatDate,
 * formatDuration, etc.). Answers the question: "are we rawdogging dates?"
 *
 * Observation kinds:
 *
 * - RAW_DATE_CONSTRUCTOR: `new Date()`, `new Date(string)`, `new Date(number)`
 * - RAW_DATE_STATIC: `Date.now()`, `Date.parse()`
 * - RAW_DATE_ACCESSOR: `.getFullYear()`, `.getMonth()`, `.getDate()`,
 *   `.getHours()`, `.getMinutes()`, `.getSeconds()`, `.getTime()`,
 *   `.getTimezoneOffset()`
 * - RAW_DATE_FORMAT: `.toISOString()`, `.toLocaleDateString()`,
 *   `.toLocaleTimeString()`, `.toLocaleString()`, `.toDateString()`,
 *   `.toTimeString()`, `.toUTCString()`
 * - MANUAL_DATE_STRING_OP: `.replace('T', ' ')`, `.split('T')`,
 *   `.slice(0, 10)` on likely date strings (heuristic)
 * - TEMPORAL_USAGE: `Temporal.PlainDate`, `Temporal.ZonedDateTime`, etc.
 *   (positive signal -- proper usage)
 * - FORMAT_UTIL_USAGE: `formatDate()`, `formatDuration()`, `toJSDate()`
 *   (positive signal -- using codebase utilities)
 *
 * Usage:
 *   npx tsx scripts/AST/ast-date-handling.ts <path...> [--pretty] [--test-files]
 *   npx tsx scripts/AST/ast-date-handling.ts <path...> --kind RAW_DATE_CONSTRUCTOR --pretty
 *   npx tsx scripts/AST/ast-date-handling.ts <path...> --count
 *   npx tsx scripts/AST/ast-date-handling.ts src/ --summary --pretty
 */

import { Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { FileFilter } from './shared';
import { cached } from './ast-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateObservationKind =
  | 'RAW_DATE_CONSTRUCTOR'
  | 'RAW_DATE_STATIC'
  | 'RAW_DATE_ACCESSOR'
  | 'RAW_DATE_FORMAT'
  | 'MANUAL_DATE_STRING_OP'
  | 'TEMPORAL_USAGE'
  | 'FORMAT_UTIL_USAGE';

interface DateObservation {
  kind: DateObservationKind;
  file: string;
  line: number;
  evidence: {
    pattern: string;
    context: string;
    layer: 'fe' | 'bff' | 'shared' | 'test' | 'fixture';
  };
}

interface DateAnalysis {
  filePath: string;
  observations: DateObservation[];
  summary: Record<DateObservationKind, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RAW_ACCESSORS = new Set([
  'getFullYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'getSeconds',
  'getMilliseconds',
  'getTime',
  'getTimezoneOffset',
  'getUTCFullYear',
  'getUTCMonth',
  'getUTCDate',
  'getUTCDay',
  'getUTCHours',
  'getUTCMinutes',
  'getUTCSeconds',
  'getUTCMilliseconds',
  'setFullYear',
  'setMonth',
  'setDate',
  'setHours',
  'setMinutes',
  'setSeconds',
  'setMilliseconds',
  'setTime',
]);

const RAW_FORMAT_METHODS = new Set([
  'toISOString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toDateString',
  'toTimeString',
  'toUTCString',
]);

// Methods shared between Date and Number/Object -- only flag when receiver is Date-typed
const AMBIGUOUS_FORMAT_METHODS = new Set(['toLocaleString', 'toJSON']);

const FORMAT_UTILS = new Set([
  'formatDate',
  'formatDuration',
  'formatInt',
  'toJSDate',
  'getFormattedDates',
  'calculatePeriodEndsByDays',
  'calculatePeriodEndsByDates',
  'getStartEndTimes',
  'getDaysDiff',
]);

// ---------------------------------------------------------------------------
// Layer classification
// ---------------------------------------------------------------------------

function classifyLayer(relativePath: string): DateObservation['evidence']['layer'] {
  if (relativePath.includes('__tests__/') || relativePath.includes('.spec.')) return 'test';
  if (relativePath.includes('fixtures/') || relativePath.includes('.fixture.')) return 'fixture';
  if (relativePath.includes('src/server/') || relativePath.includes('src/pages/api/')) return 'bff';
  if (relativePath.includes('src/shared/')) return 'shared';
  return 'fe';
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeFile(filePath: string): DateObservation[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const layer = classifyLayer(relativePath);

  return cached('ast-date-handling', absolute, () => {
    const sf = getSourceFile(absolute);
    if (!sf) return [];

    const obs: DateObservation[] = [];

    function emit(kind: DateObservationKind, line: number, pattern: string, context: string): void {
      obs.push({ kind, file: relativePath, line, evidence: { pattern, context, layer } });
    }

    sf.forEachDescendant(node => {
      // --- new Date(...) ---
      if (Node.isNewExpression(node)) {
        const expr = node.getExpression();
        if (expr.getText() === 'Date') {
          const args = node.getArguments();
          const argText = args.length > 0 ? args.map(a => a.getText()).join(', ') : '';
          const pattern = args.length === 0 ? 'new Date()' : `new Date(${argText.slice(0, 40)})`;
          emit('RAW_DATE_CONSTRUCTOR', node.getStartLineNumber(), pattern, node.getText().slice(0, 80));
        }
      }

      // --- Date.now(), Date.parse() ---
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr)) {
          const obj = expr.getExpression();
          const method = expr.getName();
          if (obj.getText() === 'Date' && (method === 'now' || method === 'parse' || method === 'UTC')) {
            emit('RAW_DATE_STATIC', node.getStartLineNumber(), `Date.${method}()`, node.getText().slice(0, 80));
          }
        }
      }

      // --- .getFullYear(), .getMonth(), etc. ---
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr)) {
          const method = expr.getName();
          if (RAW_ACCESSORS.has(method)) {
            emit('RAW_DATE_ACCESSOR', node.getStartLineNumber(), `.${method}()`, node.getText().slice(0, 80));
          }
        }
      }

      // --- .toISOString(), .toLocaleDateString(), etc. ---
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr)) {
          const method = expr.getName();
          if (RAW_FORMAT_METHODS.has(method)) {
            emit('RAW_DATE_FORMAT', node.getStartLineNumber(), `.${method}()`, node.getText().slice(0, 80));
          } else if (AMBIGUOUS_FORMAT_METHODS.has(method)) {
            // toLocaleString/toJSON exist on Number and Object too.
            // Use the type checker to confirm the receiver is Date.
            const receiver = expr.getExpression();
            try {
              const typeName = receiver.getType().getText();
              if (typeName === 'Date' || typeName.includes('Date')) {
                emit('RAW_DATE_FORMAT', node.getStartLineNumber(), `.${method}()`, node.getText().slice(0, 80));
              }
            } catch {
              // Type checker unavailable -- skip ambiguous method
            }
          }
        }
      }

      // --- .replace('T', ' ') / .replace(/T/, ' ') -- manual date string manipulation ---
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'replace') {
          const args = node.getArguments();
          if (args.length >= 2) {
            const firstArg = args[0].getText();
            // Matches 'T', "T", /T/
            if (/^['"]T['"]$/.test(firstArg) || /^\/T\/$/.test(firstArg)) {
              emit(
                'MANUAL_DATE_STRING_OP',
                node.getStartLineNumber(),
                ".replace('T', ...)",
                node.getText().slice(0, 80),
              );
            }
          }
        }
      }

      // --- .split('T') -- splitting ISO date strings ---
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'split') {
          const args = node.getArguments();
          if (args.length >= 1 && /^['"]T['"]$/.test(args[0].getText())) {
            emit('MANUAL_DATE_STRING_OP', node.getStartLineNumber(), ".split('T')", node.getText().slice(0, 80));
          }
        }
      }

      // --- Temporal.* usage (positive signal) ---
      if (Node.isPropertyAccessExpression(node)) {
        const obj = node.getExpression();
        if (obj.getText() === 'Temporal') {
          const prop = node.getName();
          emit('TEMPORAL_USAGE', node.getStartLineNumber(), `Temporal.${prop}`, node.getText().slice(0, 80));
        }
      }

      // --- Format utility calls (positive signal) ---
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        const name = Node.isIdentifier(expr) ? expr.getText() : null;
        if (name && FORMAT_UTILS.has(name)) {
          emit('FORMAT_UTIL_USAGE', node.getStartLineNumber(), `${name}()`, node.getText().slice(0, 80));
        }
      }
    });

    return obs;
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function buildSummary(observations: DateObservation[]): {
  total: Record<DateObservationKind, number>;
  byLayer: Record<string, Record<DateObservationKind, number>>;
  rawCount: number;
  properCount: number;
  ratio: string;
} {
  const total: Record<string, number> = {};
  const byLayer: Record<string, Record<string, number>> = {};
  let rawCount = 0;
  let properCount = 0;

  for (const obs of observations) {
    total[obs.kind] = (total[obs.kind] ?? 0) + 1;

    const layer = obs.evidence.layer;
    if (!byLayer[layer]) byLayer[layer] = {};
    byLayer[layer][obs.kind] = (byLayer[layer][obs.kind] ?? 0) + 1;

    if (obs.kind.startsWith('RAW_') || obs.kind === 'MANUAL_DATE_STRING_OP') {
      rawCount++;
    } else {
      properCount++;
    }
  }

  const totalOps = rawCount + properCount;
  const ratio =
    totalOps > 0
      ? `${rawCount}/${totalOps} raw (${Math.round((100 * rawCount) / totalOps)}%)`
      : 'no date operations found';

  return {
    total: total as Record<DateObservationKind, number>,
    byLayer: byLayer as Record<string, Record<DateObservationKind, number>>,
    rawCount,
    properCount,
    ratio,
  };
}

// ---------------------------------------------------------------------------
// Public API (for registry adapter if registered later)
// ---------------------------------------------------------------------------

export { analyzeFile as analyzeDateHandling };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv, {
    extraBooleanFlags: ['--summary'],
  });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-date-handling.ts <path...> [--pretty] [--test-files] [--kind <kind>] [--count]\n' +
        '       npx tsx scripts/AST/ast-date-handling.ts <path...> --summary [--pretty]\n' +
        '\n' +
        'Detect raw Date usage vs. proper date handling (Temporal, formatDate, etc.).\n' +
        '\n' +
        '  <path...>      One or more files or directories to scan\n' +
        '  --pretty       Format JSON output with indentation\n' +
        '  --test-files   Scan test files instead of production files\n' +
        '  --kind <kind>  Filter to a specific observation kind\n' +
        '  --count        Output observation kind counts\n' +
        '  --summary      Output summary with raw/proper ratio by layer\n' +
        '\n' +
        'Observation kinds:\n' +
        '  RAW_DATE_CONSTRUCTOR    new Date()\n' +
        '  RAW_DATE_STATIC         Date.now(), Date.parse()\n' +
        '  RAW_DATE_ACCESSOR       .getFullYear(), .getMonth(), .getTime(), etc.\n' +
        '  RAW_DATE_FORMAT         .toISOString(), .toLocaleDateString(), etc.\n' +
        "  MANUAL_DATE_STRING_OP   .replace('T', ' '), .split('T')\n" +
        '  TEMPORAL_USAGE          Temporal.PlainDate, etc. (positive)\n' +
        '  FORMAT_UTIL_USAGE       formatDate(), formatDuration(), etc. (positive)\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const testFiles = args.flags.has('test-files');
  const filter: FileFilter = testFiles ? 'test' : 'production';
  const allObservations: DateObservation[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);
    const filePaths = stat.isDirectory() ? getFilesInDirectory(absolute, filter) : [absolute];

    for (const fp of filePaths) {
      allObservations.push(...analyzeFile(fp));
    }
  }

  // --summary mode
  if (args.flags.has('summary')) {
    const summary = buildSummary(allObservations);
    const output = JSON.stringify(summary, null, args.pretty ? 2 : 0);
    process.stdout.write(output + '\n');
    return;
  }

  // Standard output (compatible with outputFiltered)
  const result = {
    filePath: args.paths.join(', '),
    observations: allObservations,
  };

  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-date-handling.ts') || process.argv[1].endsWith('ast-date-handling'));

if (isDirectRun) {
  main();
}
