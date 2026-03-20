import path from 'path';
import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT, getSourceFile } from './project';
import { getFilesInDirectory } from './shared';
import { extractNumberFormatObservations } from './ast-number-format';
import { extractNullDisplayObservations } from './ast-null-display';
import { astConfig } from './ast-config';
import type {
  NumberFormatObservation,
  NullDisplayObservation,
  ObservationRef,
  AssessmentResult,
  DisplayFormatAssessment,
  DisplayFormatAssessmentKind,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassificationResult {
  kind: DisplayFormatAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

function buildBasedOnNumber(observation: NumberFormatObservation): readonly ObservationRef[] {
  return [
    {
      kind: observation.kind,
      file: observation.file,
      line: observation.line,
    },
  ];
}

function buildBasedOnNull(observation: NullDisplayObservation): readonly ObservationRef[] {
  return [
    {
      kind: observation.kind,
      file: observation.file,
      line: observation.line,
    },
  ];
}

// ---------------------------------------------------------------------------
// Context detection for percentage precision
// ---------------------------------------------------------------------------

type PercentageContext = 'table' | 'progressBar' | 'spaceConstrained' | 'chartTooltip' | 'unknown';

function detectPercentageContext(
  containingFunction: string | undefined,
  filePath: string,
): { context: PercentageContext; functionMatch: boolean; pathMatch: boolean } {
  let functionMatch = false;
  let pathMatch = false;
  let functionContext: PercentageContext = 'unknown';
  let pathContext: PercentageContext = 'unknown';

  if (containingFunction) {
    const lower = containingFunction.toLowerCase();
    if (lower.includes('table')) {
      functionContext = 'table';
      functionMatch = true;
    } else if (lower.includes('progress')) {
      functionContext = 'progressBar';
      functionMatch = true;
    } else if (lower.includes('stacked') || lower.includes('bar')) {
      functionContext = 'spaceConstrained';
      functionMatch = true;
    }
  }

  if (filePath.includes('Table') || filePath.includes('Columns') || filePath.includes('Column')) {
    pathContext = 'table';
    pathMatch = true;
  } else if (filePath.includes('ProgressBar')) {
    pathContext = 'progressBar';
    pathMatch = true;
  } else if (filePath.includes('StackedBar')) {
    pathContext = 'spaceConstrained';
    pathMatch = true;
  } else if (filePath.includes('Chart') || filePath.includes('Tooltip')) {
    pathContext = 'chartTooltip';
    pathMatch = true;
  }

  // Function match takes precedence
  const context = functionMatch ? functionContext : pathContext;
  return { context, functionMatch, pathMatch };
}

function getExpectedDecimals(context: PercentageContext): number | null {
  const precision = astConfig.displayFormat.percentagePrecision;
  switch (context) {
    case 'table':
      return precision.tableCell;
    case 'chartTooltip':
      return precision.chartTooltip;
    case 'progressBar':
      return precision.progressBar;
    case 'spaceConstrained':
      return precision.spaceConstrained;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Classification rules (one per assessment kind)
// ---------------------------------------------------------------------------

/**
 * WRONG_PLACEHOLDER: null coalescing to a wrong placeholder value.
 */
function classifyWrongPlaceholder(observation: NullDisplayObservation): ClassificationResult | null {
  if (observation.kind !== 'NULL_COALESCE_FALLBACK' && observation.kind !== 'FALSY_COALESCE_FALLBACK') {
    return null;
  }

  const rawValue = observation.evidence.fallbackValue;
  if (!rawValue) return null;

  // Strip quotes: evidence stores "'N/A'" but config has 'N/A'
  const unquoted = rawValue.replace(/^'|'$/g, '');

  if (!astConfig.displayFormat.wrongPlaceholders.has(unquoted)) {
    return null;
  }

  const isNA = unquoted === 'N/A';

  return {
    kind: 'WRONG_PLACEHOLDER',
    confidence: 'high',
    rationale: [
      `uses ${rawValue} as fallback instead of NO_VALUE_PLACEHOLDER ('-')`,
      isNA ? "N/A may be semantic 'not applicable' text -- verify before replacing" : '',
    ].filter(Boolean),
    isCandidate: true,
    requiresManualReview: isNA,
  };
}

/**
 * MISSING_PLACEHOLDER: table cell with no null check on getValue().
 *
 * The observer only emits NO_FALLBACK_CELL for bare getValue() as the sole
 * return inside a columnHelper.accessor() or columnHelper.display() cell
 * property. If getValue() is wrapped in a formatter (e.g., formatCellValue),
 * the observer does not emit. So by the time this classification runs, the
 * finding is high-confidence: the cell genuinely returns a raw value with
 * no null handling.
 */
function classifyMissingPlaceholder(observation: NullDisplayObservation): ClassificationResult | null {
  if (observation.kind !== 'NO_FALLBACK_CELL') {
    return null;
  }

  return {
    kind: 'MISSING_PLACEHOLDER',
    confidence: 'high',
    rationale: [
      'table cell renders getValue() with no null handling',
      'null/undefined values will render as blank',
      'add ?? NO_VALUE_PLACEHOLDER after getValue()',
    ],
    isCandidate: true,
    requiresManualReview: false,
  };
}

/**
 * FALSY_COALESCE_NUMERIC: || operator in a context that suggests numeric data.
 */
function classifyFalsyCoalesceNumeric(observation: NullDisplayObservation): ClassificationResult | null {
  if (observation.kind !== 'FALSY_COALESCE_FALLBACK') {
    return null;
  }

  // Heuristic: file path contains Columns/Column, or the fallback is '-'
  const filePath = observation.file;
  const containingFunction = observation.evidence.containingFunction ?? '';
  const isColumnContext =
    filePath.includes('Columns') ||
    filePath.includes('Column') ||
    /^use\w*Columns/.test(containingFunction) ||
    observation.evidence.isTableColumn;

  if (!isColumnContext) {
    return null;
  }

  return {
    kind: 'FALSY_COALESCE_NUMERIC',
    confidence: 'medium',
    rationale: [
      `uses || operator in column context (${containingFunction || filePath})`,
      'if the column contains numeric data, zero values will be hidden',
      'use ?? (nullish coalescing) instead unless empty strings should also show placeholder',
    ],
    isCandidate: false,
    requiresManualReview: true,
  };
}

/**
 * HARDCODED_DASH: literal '-' without using NO_VALUE_PLACEHOLDER constant.
 *
 * Matches both HARDCODED_PLACEHOLDER (ternary, return, etc.) and
 * NULL_COALESCE_FALLBACK / FALSY_COALESCE_FALLBACK where the fallback
 * is the canonical '-' value but the file does not import the constant.
 *
 * The null-display observer (ast-null-display.ts) skips HARDCODED_PLACEHOLDER
 * for coalesce RHS to avoid double-counting with NULL_COALESCE_FALLBACK /
 * FALSY_COALESCE_FALLBACK. We compensate here by also checking coalesce
 * observations for the canonical '-' without the constant import.
 * See the skip guard in extractNullDisplayObservations() for the other half
 * of this coupling.
 */
function classifyHardcodedDash(observation: NullDisplayObservation): ClassificationResult | null {
  const rawValue = observation.evidence.fallbackValue;
  const unquoted = rawValue ? rawValue.replace(/^'|'$/g, '') : '';

  if (unquoted !== astConfig.displayFormat.placeholderValue) {
    return null;
  }

  if (observation.kind === 'HARDCODED_PLACEHOLDER') {
    if (observation.evidence.usesConstant) {
      return null;
    }
  } else if (observation.kind === 'NULL_COALESCE_FALLBACK' || observation.kind === 'FALSY_COALESCE_FALLBACK') {
    if (observation.evidence.usesConstant) {
      return null;
    }
  } else {
    return null;
  }

  return {
    kind: 'HARDCODED_DASH',
    confidence: 'high',
    rationale: [
      "uses hardcoded '-' instead of NO_VALUE_PLACEHOLDER constant",
      'import NO_VALUE_PLACEHOLDER from @/shared/constants for traceability',
    ],
    isCandidate: true,
    requiresManualReview: false,
  };
}

/**
 * RAW_FORMAT_BYPASS: raw toFixed or toLocaleString outside formatter implementations.
 */
function classifyRawFormatBypass(observation: NumberFormatObservation): ClassificationResult | null {
  if (observation.kind !== 'RAW_TO_FIXED' && observation.kind !== 'RAW_TO_LOCALE_STRING') {
    return null;
  }

  const callee = observation.evidence.callee;
  const replacement = callee === 'toFixed' ? 'formatNumber' : 'formatInt or formatNumber';

  return {
    kind: 'RAW_FORMAT_BYPASS',
    confidence: 'high',
    rationale: [
      `uses ${callee}() directly for display formatting`,
      `use ${replacement}() from shared utils instead`,
    ],
    isCandidate: true,
    requiresManualReview: false,
  };
}

/**
 * PERCENTAGE_PRECISION_MISMATCH: percentage display with wrong decimal precision for context.
 */
function classifyPercentagePrecision(observation: NumberFormatObservation): ClassificationResult | null {
  if (observation.kind !== 'PERCENTAGE_DISPLAY') {
    return null;
  }

  const detectedDecimals = observation.evidence.decimalPlaces;
  if (detectedDecimals === undefined) return null;

  const { context, functionMatch, pathMatch } = detectPercentageContext(
    observation.evidence.containingFunction,
    observation.file,
  );

  const expectedDecimals = getExpectedDecimals(context);
  if (expectedDecimals === null) {
    // Unknown context -- flag with manual review
    if (detectedDecimals !== 2) {
      // Only flag non-default precision in unknown contexts
      return {
        kind: 'PERCENTAGE_PRECISION_MISMATCH',
        confidence: 'medium',
        rationale: [
          `percentage display uses ${detectedDecimals} decimal places`,
          'context could not be determined -- verify precision is correct',
        ],
        isCandidate: false,
        requiresManualReview: true,
      };
    }
    return null;
  }

  if (detectedDecimals === expectedDecimals) {
    return null;
  }

  const confidence = functionMatch && pathMatch ? 'high' : 'medium';

  return {
    kind: 'PERCENTAGE_PRECISION_MISMATCH',
    confidence,
    rationale: [
      `${context} context expects ${expectedDecimals} decimal places, found ${detectedDecimals}`,
      `detected via ${functionMatch ? 'function name' : ''}${functionMatch && pathMatch ? ' + ' : ''}${pathMatch ? 'file path' : ''}`,
    ].filter(Boolean),
    isCandidate: false,
    requiresManualReview: !(functionMatch && pathMatch),
  };
}

/**
 * ZERO_NULL_CONFLATION: !value guard that conflates zero with null.
 */
function classifyZeroNullConflation(observation: NullDisplayObservation): ClassificationResult | null {
  if (observation.kind !== 'ZERO_CONFLATION') {
    return null;
  }

  return {
    kind: 'ZERO_NULL_CONFLATION',
    confidence: 'medium',
    rationale: [
      'truthy/falsy check conflates 0 with null/undefined',
      'use explicit null check (value == null) to preserve zero as a valid value',
    ],
    isCandidate: false,
    requiresManualReview: true,
  };
}

/**
 * INCONSISTENT_EMPTY_MESSAGE: wrong empty state message text.
 */
function classifyInconsistentEmptyMessage(observation: NullDisplayObservation): ClassificationResult | null {
  if (observation.kind !== 'EMPTY_STATE_MESSAGE') {
    return null;
  }

  const rawValue = observation.evidence.fallbackValue;
  if (!rawValue) return null;

  const unquoted = rawValue.replace(/^'|'$/g, '');

  if (!astConfig.displayFormat.wrongEmptyMessages.has(unquoted)) {
    return null;
  }

  return {
    kind: 'INCONSISTENT_EMPTY_MESSAGE',
    confidence: 'high',
    rationale: [
      `uses '${unquoted}' instead of canonical '${astConfig.displayFormat.canonicalEmptyMessage}'`,
      'standardize to the Table component default empty message',
    ],
    isCandidate: true,
    requiresManualReview: false,
  };
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret number format and null display observations to produce
 * display convention assessments.
 */
export function interpretDisplayFormat(
  numberObs: readonly NumberFormatObservation[],
  nullObs: readonly NullDisplayObservation[],
): AssessmentResult<DisplayFormatAssessment> {
  if (numberObs.length === 0 && nullObs.length === 0) {
    return { assessments: [] };
  }

  const assessments: DisplayFormatAssessment[] = [];

  // Process null display observations
  for (const observation of nullObs) {
    // Try each classification rule in order.
    // WRONG_PLACEHOLDER must be checked before FALSY_COALESCE_NUMERIC
    // because a FALSY_COALESCE_FALLBACK with a wrong placeholder is
    // primarily a WRONG_PLACEHOLDER issue.
    const wrongPlaceholder = classifyWrongPlaceholder(observation);
    if (wrongPlaceholder) {
      assessments.push({
        kind: wrongPlaceholder.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: wrongPlaceholder.confidence,
        rationale: wrongPlaceholder.rationale,
        basedOn: buildBasedOnNull(observation),
        isCandidate: wrongPlaceholder.isCandidate,
        requiresManualReview: wrongPlaceholder.requiresManualReview,
      });
      // Do not also emit FALSY_COALESCE_NUMERIC for the same observation
      continue;
    }

    const missingPlaceholder = classifyMissingPlaceholder(observation);
    if (missingPlaceholder) {
      assessments.push({
        kind: missingPlaceholder.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: missingPlaceholder.confidence,
        rationale: missingPlaceholder.rationale,
        basedOn: buildBasedOnNull(observation),
        isCandidate: missingPlaceholder.isCandidate,
        requiresManualReview: missingPlaceholder.requiresManualReview,
      });
      continue;
    }

    const falsyCoalesce = classifyFalsyCoalesceNumeric(observation);
    if (falsyCoalesce) {
      assessments.push({
        kind: falsyCoalesce.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: falsyCoalesce.confidence,
        rationale: falsyCoalesce.rationale,
        basedOn: buildBasedOnNull(observation),
        isCandidate: falsyCoalesce.isCandidate,
        requiresManualReview: falsyCoalesce.requiresManualReview,
      });
      continue;
    }

    const hardcodedDash = classifyHardcodedDash(observation);
    if (hardcodedDash) {
      assessments.push({
        kind: hardcodedDash.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: hardcodedDash.confidence,
        rationale: hardcodedDash.rationale,
        basedOn: buildBasedOnNull(observation),
        isCandidate: hardcodedDash.isCandidate,
        requiresManualReview: hardcodedDash.requiresManualReview,
      });
      continue;
    }

    const zeroConflation = classifyZeroNullConflation(observation);
    if (zeroConflation) {
      assessments.push({
        kind: zeroConflation.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: zeroConflation.confidence,
        rationale: zeroConflation.rationale,
        basedOn: buildBasedOnNull(observation),
        isCandidate: zeroConflation.isCandidate,
        requiresManualReview: zeroConflation.requiresManualReview,
      });
      continue;
    }

    const emptyMessage = classifyInconsistentEmptyMessage(observation);
    if (emptyMessage) {
      assessments.push({
        kind: emptyMessage.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: emptyMessage.confidence,
        rationale: emptyMessage.rationale,
        basedOn: buildBasedOnNull(observation),
        isCandidate: emptyMessage.isCandidate,
        requiresManualReview: emptyMessage.requiresManualReview,
      });
      continue;
    }
  }

  // Process number format observations
  for (const observation of numberObs) {
    const rawBypass = classifyRawFormatBypass(observation);
    if (rawBypass) {
      assessments.push({
        kind: rawBypass.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: rawBypass.confidence,
        rationale: rawBypass.rationale,
        basedOn: buildBasedOnNumber(observation),
        isCandidate: rawBypass.isCandidate,
        requiresManualReview: rawBypass.requiresManualReview,
      });
      continue;
    }

    const percentagePrecision = classifyPercentagePrecision(observation);
    if (percentagePrecision) {
      assessments.push({
        kind: percentagePrecision.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.containingFunction,
        },
        confidence: percentagePrecision.confidence,
        rationale: percentagePrecision.rationale,
        basedOn: buildBasedOnNumber(observation),
        isCandidate: percentagePrecision.isCandidate,
        requiresManualReview: percentagePrecision.requiresManualReview,
      });
      continue;
    }
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<DisplayFormatAssessment>, targetPath: string): string {
  const lines: string[] = [];
  lines.push(`Display Format Assessments: ${targetPath}`);
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No display convention issues found.');
    return lines.join('\n');
  }

  lines.push(
    ` File${' '.repeat(35)} | Line | Kind${' '.repeat(28)} | Confidence | Review`,
  );
  lines.push(
    `${'-'.repeat(40)}-+------+${'-'.repeat(33)}-+------------+--------`,
  );

  for (const a of result.assessments) {
    const file = a.subject.file.slice(0, 40).padEnd(40);
    const line = String(a.subject.line ?? '?').padStart(5);
    const kind = a.kind.padEnd(33);
    const confidence = a.confidence.padEnd(10);
    const review = a.requiresManualReview ? 'yes' : 'no ';
    lines.push(`${file} | ${line} | ${kind} | ${confidence} | ${review}`);
  }

  lines.push('');
  lines.push('Rationale:');
  for (const a of result.assessments) {
    const symbol = a.subject.symbol ?? a.subject.file;
    lines.push(`  [${a.kind}] ${symbol}: ${a.rationale.join('; ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-display-format.ts <dir|file> [--pretty]\n' +
        '\n' +
        'Interpret number format and null display observations to classify\n' +
        'display convention violations.\n' +
        '\n' +
        'Assessment kinds:\n' +
        '  WRONG_PLACEHOLDER              - Uses N/A, --, etc. instead of NO_VALUE_PLACEHOLDER\n' +
        '  MISSING_PLACEHOLDER            - Table cell has no null fallback\n' +
        '  FALSY_COALESCE_NUMERIC         - || operator in numeric column hides zero\n' +
        '  HARDCODED_DASH                 - Uses literal \'-\' instead of constant\n' +
        '  RAW_FORMAT_BYPASS              - Uses toFixed/toLocaleString instead of shared formatter\n' +
        '  PERCENTAGE_PRECISION_MISMATCH  - Wrong decimal places for context\n' +
        '  ZERO_NULL_CONFLATION           - Falsy check conflates 0 with null\n' +
        '  INCONSISTENT_EMPTY_MESSAGE     - Wrong empty state message text\n' +
        '\n' +
        '  <dir|file>  A .ts/.tsx file or directory to analyze\n' +
        '  --pretty    Format output as a human-readable table\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  const allNumberObs: NumberFormatObservation[] = [];
  const allNullObs: NullDisplayObservation[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);
    const filePaths = stat.isDirectory() ? getFilesInDirectory(absolute) : [absolute];

    for (const fp of filePaths) {
      const sf = getSourceFile(fp);
      allNumberObs.push(...extractNumberFormatObservations(sf));
      allNullObs.push(...extractNullDisplayObservations(sf));
    }
  }

  const result = interpretDisplayFormat(allNumberObs, allNullObs);

  if (args.pretty) {
    const relativePath = path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, args.paths[0]));
    process.stdout.write(formatPrettyOutput(result, relativePath) + '\n');
  } else {
    output(result, false);
  }
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-display-format.ts') ||
    process.argv[1].endsWith('ast-interpret-display-format'));

if (isDirectRun) {
  main();
}
