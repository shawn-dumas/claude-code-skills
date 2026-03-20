import path from 'path';
import { output, fatal } from './cli';
import type {
  TestCoverageObservation,
  TestGapAssessment,
  TestGapDirectoryStats,
  ObservationRef,
  AssessmentResult,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirectoryGroup {
  directory: string;
  observations: TestCoverageObservation[];
}

// ---------------------------------------------------------------------------
// Observation grouping
// ---------------------------------------------------------------------------

/**
 * Group observations by directory for summary stats.
 */
function groupByDirectory(observations: readonly TestCoverageObservation[]): DirectoryGroup[] {
  const byDir = new Map<string, TestCoverageObservation[]>();

  for (const obs of observations) {
    const dir = path.dirname(obs.file);
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push(obs);
  }

  const groups: DirectoryGroup[] = [];
  for (const [directory, obs] of byDir.entries()) {
    groups.push({ directory, observations: obs });
  }

  return groups;
}

/**
 * Compute directory-level coverage stats.
 */
function computeDirectoryStats(group: DirectoryGroup): TestGapDirectoryStats {
  const totalFiles = group.observations.length;
  let tested = 0;
  let indirectlyTested = 0;
  let untested = 0;

  for (const obs of group.observations) {
    switch (obs.evidence.coverage) {
      case 'TESTED':
        tested++;
        break;
      case 'INDIRECTLY_TESTED':
        indirectlyTested++;
        break;
      case 'UNTESTED':
        untested++;
        break;
    }
  }

  const coveragePercent = totalFiles > 0 ? Math.round(((tested + indirectlyTested) / totalFiles) * 100) : 0;

  return {
    directory: group.directory,
    totalFiles,
    tested,
    indirectlyTested,
    untested,
    coveragePercent,
  };
}

// ---------------------------------------------------------------------------
// Assessment emission rules
// ---------------------------------------------------------------------------

/**
 * Determine whether a TEST_COVERAGE observation should emit a TEST_GAP assessment.
 *
 * Rules:
 * - UNTESTED + HIGH risk -> emit (P2)
 * - UNTESTED + MEDIUM risk -> emit (P3)
 * - UNTESTED + LOW risk -> do NOT emit
 * - INDIRECTLY_TESTED + HIGH risk -> emit (P3)
 * - INDIRECTLY_TESTED + MEDIUM risk -> emit (P4)
 * - INDIRECTLY_TESTED + LOW risk -> do NOT emit
 * - TESTED (any risk) -> do NOT emit
 */
function shouldEmitGap(
  coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED',
  risk: 'HIGH' | 'MEDIUM' | 'LOW',
): boolean {
  if (coverage === 'TESTED') return false;
  if (risk === 'LOW') return false;
  return true;
}

/**
 * Assign priority for a TEST_GAP assessment.
 * Uses the observation's suggestedPriority for UNTESTED files.
 * For INDIRECTLY_TESTED files, priority is one level lower than UNTESTED.
 */
function assignGapPriority(coverage: 'UNTESTED' | 'INDIRECTLY_TESTED', risk: 'HIGH' | 'MEDIUM'): 'P2' | 'P3' | 'P4' {
  if (coverage === 'UNTESTED') {
    return risk === 'HIGH' ? 'P2' : 'P3';
  }
  // INDIRECTLY_TESTED
  return risk === 'HIGH' ? 'P3' : 'P4';
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

function buildBasedOn(observation: TestCoverageObservation): readonly ObservationRef[] {
  return [
    {
      kind: observation.kind,
      file: observation.file,
      line: observation.line,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret TEST_COVERAGE observations and produce TEST_GAP assessments.
 *
 * Groups by directory for summary stats. Emits assessments for files
 * meeting the coverage + risk criteria.
 */
export function interpretTestCoverage(
  observations: readonly TestCoverageObservation[],
): AssessmentResult<TestGapAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const groups = groupByDirectory(observations);
  const dirStatsMap = new Map<string, TestGapDirectoryStats>();

  for (const group of groups) {
    dirStatsMap.set(group.directory, computeDirectoryStats(group));
  }

  const assessments: TestGapAssessment[] = [];

  for (const obs of observations) {
    const { coverage, risk } = obs.evidence;

    if (!shouldEmitGap(coverage, risk)) {
      continue;
    }

    // Type narrowing: at this point coverage is UNTESTED or INDIRECTLY_TESTED,
    // and risk is HIGH or MEDIUM
    const gapCoverage = coverage as 'UNTESTED' | 'INDIRECTLY_TESTED';
    const gapRisk = risk as 'HIGH' | 'MEDIUM';
    const priority = assignGapPriority(gapCoverage, gapRisk);

    const dir = path.dirname(obs.file);
    const directoryStats = dirStatsMap.get(dir);

    const rationale: string[] = [];
    if (gapCoverage === 'UNTESTED') {
      rationale.push(`${gapRisk} risk file with no test coverage`);
    } else {
      rationale.push(`${gapRisk} risk file with only indirect test coverage`);
    }
    rationale.push(`risk score: ${obs.evidence.riskScore}`);

    assessments.push({
      kind: 'TEST_GAP',
      subject: {
        file: obs.file,
        line: 1,
      },
      confidence: gapCoverage === 'UNTESTED' ? 'high' : 'medium',
      rationale,
      basedOn: buildBasedOn(obs),
      isCandidate: false,
      requiresManualReview: false,
      coverage: gapCoverage,
      risk: gapRisk,
      suggestedPriority: priority,
      directoryStats,
    });
  }

  return { assessments };
}

// Export the directory stats computation for testing
export { computeDirectoryStats, groupByDirectory };

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<TestGapAssessment>): string {
  const lines: string[] = [];
  lines.push('Test Coverage Gap Assessments');
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No test gaps found.');
    return lines.join('\n');
  }

  // Group assessments by directory for display
  const byDir = new Map<string, TestGapAssessment[]>();
  for (const a of result.assessments) {
    const dir = a.directoryStats?.directory ?? path.dirname(a.subject.file);
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push(a);
  }

  for (const [dir, dirAssessments] of byDir.entries()) {
    const stats = dirAssessments[0].directoryStats;
    if (stats) {
      lines.push(
        `${stats.directory}/ -- ${stats.tested + stats.indirectlyTested}/${stats.totalFiles} tested (${stats.coveragePercent}%)`,
      );
    } else {
      lines.push(`${dir}/`);
    }

    for (const a of dirAssessments) {
      const filename = path.basename(a.subject.file);
      lines.push(`  ${a.suggestedPriority} ${a.coverage.padEnd(19)} ${a.risk.padEnd(6)} ${filename}`);
    }
    lines.push('');
  }

  lines.push(`Total gaps: ${result.assessments.length}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Stdin reading
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

/**
 * Parse piped JSON input into TEST_COVERAGE observations.
 * Accepts either:
 * - An array of TestCoverageAnalysis objects (each with filePath + observations)
 * - A single TestCoverageAnalysis object
 * - A raw array of observations
 */
function parseObservationsFromJson(json: string): TestCoverageObservation[] {
  const parsed: unknown = JSON.parse(json);
  const observations: TestCoverageObservation[] = [];

  function extractFromItem(item: unknown): void {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;

    if (Array.isArray(obj.observations)) {
      for (const obs of obj.observations) {
        if (obs && typeof obs === 'object' && (obs as Record<string, unknown>).kind === 'TEST_COVERAGE') {
          observations.push(obs as TestCoverageObservation);
        }
      }
    } else if (obj.kind === 'TEST_COVERAGE') {
      observations.push(obj as TestCoverageObservation);
    }
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      extractFromItem(item);
    }
  } else {
    extractFromItem(parsed);
  }

  return observations;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '')));

  if (flags.has('help')) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-test-coverage.ts <dir> --json | npx tsx scripts/AST/ast-interpret-test-coverage.ts [--pretty] [--json] [--count]\n' +
        '\n' +
        'Interpret TEST_COVERAGE observations and emit TEST_GAP assessments.\n' +
        'Reads observations from stdin (piped JSON).\n' +
        '\n' +
        '  --pretty  Format output as a human-readable directory summary\n' +
        '  --json    Output as formatted JSON\n' +
        '  --count   Output assessment count only\n',
    );
    process.exit(0);
  }

  // Check if stdin is a pipe (not a TTY)
  if (process.stdin.isTTY) {
    fatal(
      'No input. Pipe TEST_COVERAGE observations via stdin.\nExample: npx tsx scripts/AST/ast-test-coverage.ts src/ --json | npx tsx scripts/AST/ast-interpret-test-coverage.ts --json',
    );
  }

  const input = await readStdin();
  if (!input.trim()) {
    fatal('Empty input on stdin.');
  }

  let observations: TestCoverageObservation[];
  try {
    observations = parseObservationsFromJson(input);
  } catch (e) {
    fatal(`Failed to parse stdin JSON: ${e}`);
  }

  const result = interpretTestCoverage(observations);

  if (flags.has('count')) {
    const counts: Record<string, number> = {};
    for (const a of result.assessments) {
      counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    }
    output(counts, false);
  } else if (flags.has('pretty')) {
    process.stdout.write(formatPrettyOutput(result) + '\n');
  } else {
    output(result, flags.has('json'));
  }
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-test-coverage.ts') ||
    process.argv[1].endsWith('ast-interpret-test-coverage'));

if (isDirectRun) {
  main().catch(e => {
    fatal(`Unhandled error: ${e}`);
  });
}
