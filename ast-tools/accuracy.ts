/**
 * Accuracy self-assessment infrastructure for AST interpreters.
 *
 * Compares interpreter assessments against ground truth files to compute
 * precision, recall, F1, bias ratio, and per-kind accuracy. Ground truth
 * files live in `scripts/AST/ground-truth/<tool-name>.json`.
 *
 * CLI: `npx tsx scripts/AST/accuracy.ts <interpreter> <ground-truth-file> <target-dir>`
 */

import fs from 'fs';
import path from 'path';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import type { Assessment, AssessmentResult } from './types';

// ---------------------------------------------------------------------------
// Ground truth types
// ---------------------------------------------------------------------------

/**
 * A single ground truth entry representing the expected assessment
 * for a specific file + line location.
 */
export interface GroundTruthEntry {
  /** Relative file path from project root */
  readonly file: string;
  /** Line number in the file */
  readonly line: number;
  /** Expected assessment kind (e.g., 'DERIVED_STATE', 'MOCK_INTERNAL_VIOLATION') */
  readonly expectedKind: string;
  /** Optional symbol name for disambiguation */
  readonly symbol?: string;
  /** Human-readable note explaining the ground truth decision */
  readonly note?: string;
}

/**
 * Ground truth file format. Each file covers one interpreter.
 */
export interface GroundTruthFile {
  /** Interpreter name (e.g., 'ast-interpret-effects') */
  readonly interpreter: string;
  /** ISO date when the ground truth was last reviewed */
  readonly lastReviewed: string;
  /** Ground truth entries */
  readonly entries: readonly GroundTruthEntry[];
}

// ---------------------------------------------------------------------------
// Accuracy report types
// ---------------------------------------------------------------------------

export interface PerKindAccuracy {
  readonly kind: string;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface AccuracyReport {
  readonly interpreter: string;
  readonly totalGroundTruth: number;
  readonly totalAssessments: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Ratio of assessments to ground truth entries. >1 means over-reporting. */
  readonly biasRatio: number;
  readonly perKind: readonly PerKindAccuracy[];
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

function matchKey(file: string, line: number): string {
  return `${file}:${line}`;
}

/**
 * Compute accuracy metrics by matching assessments against ground truth.
 * Matches by file + line. When multiple assessments match the same line,
 * the first match by kind wins.
 */
export function measureAccuracy(assessments: readonly Assessment[], groundTruth: GroundTruthFile): AccuracyReport {
  // Build lookup maps
  const gtByKey = new Map<string, GroundTruthEntry[]>();
  for (const entry of groundTruth.entries) {
    const key = matchKey(entry.file, entry.line);
    const existing = gtByKey.get(key) ?? [];
    existing.push(entry);
    gtByKey.set(key, existing);
  }

  const assessmentsByKey = new Map<string, Assessment[]>();
  for (const a of assessments) {
    const key = matchKey(a.subject.file, a.subject.line ?? 0);
    const existing = assessmentsByKey.get(key) ?? [];
    existing.push(a);
    assessmentsByKey.set(key, existing);
  }

  // Compute global TP, FP, FN
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  // Per-kind tracking
  const kindStats = new Map<string, { tp: number; fp: number; fn: number }>();

  function getKindStats(kind: string): { tp: number; fp: number; fn: number } {
    let stats = kindStats.get(kind);
    if (!stats) {
      stats = { tp: 0, fp: 0, fn: 0 };
      kindStats.set(kind, stats);
    }
    return stats;
  }

  // Check each ground truth entry against assessments
  const matchedAssessmentKeys = new Set<string>();

  for (const entry of groundTruth.entries) {
    const key = matchKey(entry.file, entry.line);
    const matchingAssessments = assessmentsByKey.get(key) ?? [];

    const kindMatch = matchingAssessments.find(a => a.kind === entry.expectedKind);

    if (kindMatch) {
      truePositives++;
      getKindStats(entry.expectedKind).tp++;
      matchedAssessmentKeys.add(`${key}:${entry.expectedKind}`);
    } else {
      falseNegatives++;
      getKindStats(entry.expectedKind).fn++;
    }
  }

  // Check each assessment for false positives (not in ground truth)
  for (const a of assessments) {
    const key = matchKey(a.subject.file, a.subject.line ?? 0);
    const assessmentKey = `${key}:${a.kind}`;

    if (!matchedAssessmentKeys.has(assessmentKey)) {
      // Check if there's a ground truth entry at this location with a different kind
      const gtEntries = gtByKey.get(key);
      if (!gtEntries || !gtEntries.some(gt => gt.expectedKind === a.kind)) {
        falsePositives++;
        getKindStats(a.kind).fp++;
      }
    }
  }

  // Compute aggregate metrics
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const biasRatio = groundTruth.entries.length > 0 ? assessments.length / groundTruth.entries.length : 0;

  // Compute per-kind metrics
  const perKind: PerKindAccuracy[] = [];
  for (const [kind, stats] of kindStats.entries()) {
    const kPrecision = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const kRecall = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    const kF1 = kPrecision + kRecall > 0 ? (2 * kPrecision * kRecall) / (kPrecision + kRecall) : 0;

    perKind.push({
      kind,
      truePositives: stats.tp,
      falsePositives: stats.fp,
      falseNegatives: stats.fn,
      precision: kPrecision,
      recall: kRecall,
      f1: kF1,
    });
  }

  // Sort per-kind by F1 ascending (worst first)
  perKind.sort((a, b) => a.f1 - b.f1);

  return {
    interpreter: groundTruth.interpreter,
    totalGroundTruth: groundTruth.entries.length,
    totalAssessments: assessments.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    biasRatio,
    perKind,
  };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatReport(report: AccuracyReport): string {
  const lines: string[] = [];
  lines.push(`Accuracy Report: ${report.interpreter}`);
  lines.push('');
  lines.push(`Ground truth entries: ${report.totalGroundTruth}`);
  lines.push(`Total assessments:    ${report.totalAssessments}`);
  lines.push(`True positives:       ${report.truePositives}`);
  lines.push(`False positives:      ${report.falsePositives}`);
  lines.push(`False negatives:      ${report.falseNegatives}`);
  lines.push('');
  lines.push(`Precision: ${(report.precision * 100).toFixed(1)}%`);
  lines.push(`Recall:    ${(report.recall * 100).toFixed(1)}%`);
  lines.push(`F1:        ${(report.f1 * 100).toFixed(1)}%`);
  lines.push(`Bias:      ${report.biasRatio.toFixed(2)}x`);

  if (report.perKind.length > 0) {
    lines.push('');
    lines.push('Per-Kind Breakdown:');
    lines.push(' Kind                        | TP | FP | FN | Precision | Recall | F1');
    lines.push('-----------------------------+----+----+----+-----------+--------+------');

    for (const k of report.perKind) {
      const kind = k.kind.padEnd(27);
      const tp = String(k.truePositives).padStart(2);
      const fp = String(k.falsePositives).padStart(2);
      const fn = String(k.falseNegatives).padStart(2);
      const p = `${(k.precision * 100).toFixed(0)}%`.padStart(9);
      const r = `${(k.recall * 100).toFixed(0)}%`.padStart(6);
      const f = `${(k.f1 * 100).toFixed(0)}%`.padStart(5);
      lines.push(` ${kind} | ${tp} | ${fp} | ${fn} | ${p} | ${r} | ${f}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Ground truth loading
// ---------------------------------------------------------------------------

function loadGroundTruth(filePath: string): GroundTruthFile {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Ground truth file not found: ${absolute}`);
  }

  const content = fs.readFileSync(absolute, 'utf-8');
  const parsed = JSON.parse(content) as GroundTruthFile;

  if (!parsed.interpreter || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid ground truth file format: missing 'interpreter' or 'entries'`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/accuracy.ts <interpreter> <ground-truth-file> <target-dir> [--pretty]\n' +
        '\n' +
        'Measure interpreter accuracy against ground truth.\n' +
        '\n' +
        '  <interpreter>        Interpreter name (e.g., ast-interpret-effects)\n' +
        '  <ground-truth-file>  Path to ground truth JSON file\n' +
        '  <target-dir>         Directory to analyze\n' +
        '  --pretty             Format output as a human-readable report\n',
    );
    process.exit(0);
  }

  if (args.paths.length < 3) {
    fatal('Usage: npx tsx scripts/AST/accuracy.ts <interpreter> <ground-truth-file> <target-dir>');
  }

  const interpreterName = args.paths[0];
  const gtFilePath = args.paths[1];
  const targetDir = args.paths[2];

  // Load ground truth
  const groundTruth = loadGroundTruth(gtFilePath);

  // Run the interpreter (dynamic import based on name)
  // For now, output the ground truth validation
  if (groundTruth.interpreter !== interpreterName) {
    fatal(`Ground truth file is for '${groundTruth.interpreter}', but interpreter '${interpreterName}' was specified.`);
  }

  // The actual interpreter execution would be plugged in here.
  // For the infrastructure, we validate the ground truth and output the format.
  process.stdout.write(`Ground truth loaded: ${groundTruth.entries.length} entries for ${groundTruth.interpreter}\n`);
  process.stdout.write(`Target directory: ${targetDir}\n`);
  process.stdout.write(`Use programmatic API: measureAccuracy(assessments, groundTruth)\n`);

  if (args.pretty) {
    // Show a sample empty report
    const emptyReport = measureAccuracy([], groundTruth);
    process.stdout.write('\n' + formatReport(emptyReport) + '\n');
  } else {
    output({ interpreter: interpreterName, groundTruthEntries: groundTruth.entries.length, targetDir }, false);
  }
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('accuracy.ts') || process.argv[1].endsWith('accuracy'));

if (isDirectRun) {
  main();
}
