/**
 * ast-interpret-plan-audit.ts
 *
 * Interpreter for plan audit observations. Consumes observations from
 * ast-plan-audit.ts and produces per-check assessments with confidence,
 * rationale, and basedOn references. Computes a weighted score and
 * rollup verdict (CERTIFIED / CONDITIONAL / BLOCKED).
 *
 * All severity classifications, weights, and thresholds are sourced
 * from astConfig.planAudit.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-interpret-plan-audit.ts <plan-file> [--prompts '<glob>'] [--pretty] [--verbose]
 */

import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { parseArgs, output, fatal } from './cli';
import { resolveConfig } from './ast-config';
import { analyzePlan } from './ast-plan-audit';
import type {
  PlanAuditObservation,
  PlanAuditObservationKind,
  PlanAuditAssessment,
  PlanAuditAssessmentKind,
  PlanAuditVerdict,
  PlanAuditVerdictReport,
  ObservationRef,
} from './types';

// ---------------------------------------------------------------------------
// Observation grouping
// ---------------------------------------------------------------------------

/** Group observations by kind for batch classification. */
function groupByKind(
  observations: readonly PlanAuditObservation[],
): Map<PlanAuditObservationKind, PlanAuditObservation[]> {
  const map = new Map<PlanAuditObservationKind, PlanAuditObservation[]>();
  for (const obs of observations) {
    const group = map.get(obs.kind);
    if (group) {
      group.push(obs);
    } else {
      map.set(obs.kind, [obs]);
    }
  }
  return map;
}

/** Convert an observation to an ObservationRef for basedOn. */
function toRef(obs: PlanAuditObservation): ObservationRef {
  return { kind: obs.kind, file: obs.file, line: obs.line };
}

// ---------------------------------------------------------------------------
// Per-check classifiers
// ---------------------------------------------------------------------------

/**
 * Each classifier takes a group of observations (or the absence of
 * certain kinds) and returns assessments. The classifier decides the
 * assessment kind based on the observation kind.
 */

function classifyHeaders(grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>): PlanAuditAssessment[] {
  const assessments: PlanAuditAssessment[] = [];
  const missing = grouped.get('PLAN_HEADER_MISSING') ?? [];
  const invalid = grouped.get('PLAN_HEADER_INVALID') ?? [];
  const deficiencies = [...missing, ...invalid];

  if (deficiencies.length === 0) {
    assessments.push({
      kind: 'HEADER_COMPLETE',
      subject: { file: '', symbol: 'plan-header' },
      confidence: 'high',
      rationale: ['All required header fields present and correctly formatted.'],
      basedOn: [],
      isCandidate: false,
      requiresManualReview: false,
    });
  } else {
    for (const obs of deficiencies) {
      const detail =
        obs.kind === 'PLAN_HEADER_MISSING'
          ? `Required header field '${obs.evidence.field ?? 'unknown'}' is missing.`
          : `Header field '${obs.evidence.field ?? 'unknown'}' has invalid format: ${obs.evidence.value ?? ''}.`;

      assessments.push({
        kind: 'HEADER_DEFICIENCY',
        subject: { file: obs.file, line: obs.line, symbol: obs.evidence.field },
        confidence: 'high',
        rationale: [detail],
        basedOn: [toRef(obs)],
        isCandidate: false,
        requiresManualReview: false,
      });
    }
  }

  return assessments;
}

function classifyVerification(grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>): PlanAuditAssessment[] {
  const missing = grouped.get('VERIFICATION_BLOCK_MISSING') ?? [];
  if (missing.length === 0) {
    return [
      {
        kind: 'VERIFICATION_PRESENT',
        subject: { file: '', symbol: 'verification-block' },
        confidence: 'high',
        rationale: ['Plan contains a verification section.'],
        basedOn: [],
        isCandidate: false,
        requiresManualReview: false,
      },
    ];
  }

  return missing.map(obs => ({
    kind: 'VERIFICATION_ABSENT' as const,
    subject: { file: obs.file, symbol: 'verification-block' },
    confidence: 'high' as const,
    rationale: ['Plan has no verification section. Execution cannot be verified.'],
    basedOn: [toRef(obs)],
    isCandidate: false,
    requiresManualReview: false,
  }));
}

function classifyCleanup(grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>): PlanAuditAssessment[] {
  const missing = grouped.get('CLEANUP_FILE_MISSING') ?? [];
  if (missing.length === 0) {
    return [
      {
        kind: 'CLEANUP_REFERENCED',
        subject: { file: '', symbol: 'cleanup-reference' },
        confidence: 'high',
        rationale: ['Plan references a cleanup file.'],
        basedOn: [],
        isCandidate: false,
        requiresManualReview: false,
      },
    ];
  }

  return missing.map(obs => ({
    kind: 'CLEANUP_UNREFERENCED' as const,
    subject: { file: obs.file, symbol: 'cleanup-reference' },
    confidence: 'high' as const,
    rationale: ['No cleanup file referenced. Accumulated cleanup items have no destination.'],
    basedOn: [toRef(obs)],
    isCandidate: false,
    requiresManualReview: false,
  }));
}

function classifyStandingElements(
  grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>,
): PlanAuditAssessment[] {
  const missing = grouped.get('STANDING_ELEMENT_MISSING') ?? [];
  if (missing.length === 0) {
    return [
      {
        kind: 'STANDING_ELEMENTS_COMPLETE',
        subject: { file: '', symbol: 'standing-elements' },
        confidence: 'high',
        rationale: ['All standing elements have answers.'],
        basedOn: [],
        isCandidate: false,
        requiresManualReview: false,
      },
    ];
  }

  const names = missing.map(obs => obs.evidence.elementName ?? 'unknown');
  return [
    {
      kind: 'STANDING_ELEMENTS_INCOMPLETE',
      subject: { file: missing[0].file, symbol: 'standing-elements' },
      confidence: 'high',
      rationale: [`${missing.length} standing element(s) unanswered: ${names.join(', ')}.`],
      basedOn: missing.map(toRef),
      isCandidate: false,
      requiresManualReview: missing.length >= 3,
    },
  ];
}

function classifyPreFlight(grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>): PlanAuditAssessment[] {
  const certified = grouped.get('PRE_FLIGHT_CERTIFIED') ?? [];
  const conditional = grouped.get('PRE_FLIGHT_CONDITIONAL') ?? [];
  const blocked = grouped.get('PRE_FLIGHT_BLOCKED') ?? [];
  const missingMark = grouped.get('PRE_FLIGHT_MARK_MISSING') ?? [];

  if (certified.length > 0) {
    const obs = certified[0];
    return [
      {
        kind: 'CERTIFIED',
        subject: { file: obs.file, line: obs.line, symbol: 'pre-flight' },
        confidence: 'high',
        rationale: [
          `Pre-flight mark: ${obs.evidence.certificationTier ?? 'present'} ${obs.evidence.certificationDate ?? ''}.`,
        ],
        basedOn: [toRef(obs)],
        isCandidate: false,
        requiresManualReview: false,
      },
    ];
  }

  if (conditional.length > 0) {
    const obs = conditional[0];
    return [
      {
        kind: 'CONDITIONAL_PREFLIGHT',
        subject: { file: obs.file, line: obs.line, symbol: 'pre-flight' },
        confidence: 'high',
        rationale: [
          `Pre-flight mark: ${obs.evidence.certificationTier} ${obs.evidence.certificationDate ?? ''}. Plan was not fully certified at pre-flight.`,
        ],
        basedOn: [toRef(obs)],
        isCandidate: false,
        requiresManualReview: true,
      },
    ];
  }

  if (blocked.length > 0) {
    const obs = blocked[0];
    return [
      {
        kind: 'BLOCKED_PREFLIGHT',
        subject: { file: obs.file, line: obs.line, symbol: 'pre-flight' },
        confidence: 'high',
        rationale: [
          `Pre-flight mark: ${obs.evidence.certificationTier} ${obs.evidence.certificationDate ?? ''}. Plan was blocked at pre-flight.`,
        ],
        basedOn: [toRef(obs)],
        isCandidate: false,
        requiresManualReview: true,
      },
    ];
  }

  if (missingMark.length > 0) {
    return [
      {
        kind: 'CERTIFICATION_MISSING',
        subject: { file: missingMark[0].file, symbol: 'pre-flight' },
        confidence: 'high',
        rationale: ['No pre-flight certification mark. Plan has not been audited.'],
        basedOn: missingMark.map(toRef),
        isCandidate: false,
        requiresManualReview: true,
      },
    ];
  }

  return [];
}

function classifyPrompts(grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>): PlanAuditAssessment[] {
  const assessments: PlanAuditAssessment[] = [];

  // Dependency cycles
  const cycles = grouped.get('PROMPT_DEPENDENCY_CYCLE') ?? [];
  for (const obs of cycles) {
    assessments.push({
      kind: 'DEPENDENCY_CYCLE_DETECTED',
      subject: { file: obs.file, symbol: 'prompt-graph' },
      confidence: 'high',
      rationale: [`Circular dependency in prompt graph: ${(obs.evidence.cyclePath ?? []).join(' -> ')}.`],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  // Missing prompt files
  const missingFiles = grouped.get('PROMPT_FILE_MISSING') ?? [];
  for (const obs of missingFiles) {
    assessments.push({
      kind: 'PROMPT_FILE_UNRESOLVED',
      subject: { file: obs.file, line: obs.line, symbol: obs.evidence.promptFile },
      confidence: 'high',
      rationale: [`Prompt table references '${obs.evidence.promptFile ?? 'unknown'}' but no matching file found.`],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  // Missing verification in prompt files
  const missingVerification = grouped.get('PROMPT_VERIFICATION_MISSING') ?? [];
  for (const obs of missingVerification) {
    assessments.push({
      kind: 'PROMPT_DEFICIENCY',
      subject: { file: obs.file, line: obs.line, symbol: 'verification' },
      confidence: 'high',
      rationale: [
        `Prompt file '${obs.evidence.promptFile ?? obs.file}' has no verification section with runnable commands.`,
      ],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  // Missing reconciliation template
  const missingRecon = grouped.get('RECONCILIATION_TEMPLATE_MISSING') ?? [];
  for (const obs of missingRecon) {
    assessments.push({
      kind: 'PROMPT_DEFICIENCY',
      subject: { file: obs.file, line: obs.line, symbol: 'reconciliation' },
      confidence: 'high',
      rationale: [`Prompt file '${obs.evidence.promptFile ?? obs.file}' has no reconciliation template.`],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  // Unset modes
  const unsetModes = grouped.get('PROMPT_MODE_UNSET') ?? [];
  for (const obs of unsetModes) {
    assessments.push({
      kind: 'PROMPT_DEFICIENCY',
      subject: { file: obs.file, line: obs.line, symbol: obs.evidence.promptName },
      confidence: 'high',
      rationale: [`Prompt '${obs.evidence.promptName ?? 'unknown'}' has no auto/manual mode set.`],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  // If no prompt issues found, emit a positive signal
  const totalIssues =
    cycles.length + missingFiles.length + missingVerification.length + missingRecon.length + unsetModes.length;
  if (totalIssues === 0) {
    assessments.push({
      kind: 'PROMPT_WELL_FORMED',
      subject: { file: '', symbol: 'prompts' },
      confidence: 'high',
      rationale: ['All prompts have verification, reconciliation, and mode set. No dependency cycles.'],
      basedOn: [],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  return assessments;
}

function classifyConventions(grouped: Map<PlanAuditObservationKind, PlanAuditObservation[]>): PlanAuditAssessment[] {
  const assessments: PlanAuditAssessment[] = [];

  // Client-side aggregation is a risk signal
  const aggregation = grouped.get('CLIENT_SIDE_AGGREGATION') ?? [];
  for (const obs of aggregation) {
    assessments.push({
      kind: 'AGGREGATION_RISK',
      subject: { file: obs.file, line: obs.line },
      confidence: 'medium',
      rationale: [`Client-side aggregation pattern detected: ${obs.evidence.matchedText ?? ''}.`],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: true,
    });
  }

  // Deferred cleanup references
  const deferred = grouped.get('DEFERRED_CLEANUP_REFERENCE') ?? [];
  for (const obs of deferred) {
    assessments.push({
      kind: 'DEFERRED_CLEANUP_NOTED',
      subject: { file: obs.file, line: obs.line },
      confidence: 'high',
      rationale: [`Cleanup deferred: ${obs.evidence.deferredItem ?? ''}.`],
      basedOn: [toRef(obs)],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  // Naming conventions, file paths, skill references are informational
  const naming = grouped.get('NAMING_CONVENTION_INSTRUCTION') ?? [];
  const filePaths = grouped.get('FILE_PATH_REFERENCE') ?? [];
  const skills = grouped.get('SKILL_REFERENCE') ?? [];
  const infoObs = [...naming, ...filePaths, ...skills];

  if (infoObs.length > 0) {
    assessments.push({
      kind: 'CONVENTION_REFERENCE',
      subject: { file: infoObs[0].file },
      confidence: 'high',
      rationale: [
        `${naming.length} naming convention(s), ${filePaths.length} file path(s), ${skills.length} skill reference(s) found.`,
      ],
      basedOn: infoObs.map(toRef),
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  return assessments;
}

// ---------------------------------------------------------------------------
// Scoring and verdict
// ---------------------------------------------------------------------------

function computeScore(observations: readonly PlanAuditObservation[]): number {
  const config = resolveConfig();
  const { checkWeights } = config.planAudit;
  let score = 100;

  for (const obs of observations) {
    const weight = checkWeights[obs.kind] ?? checkWeights._default ?? 5;
    score -= weight;
  }

  return Math.max(0, score);
}

function hasBlocker(observations: readonly PlanAuditObservation[]): boolean {
  const config = resolveConfig();
  const { severityMap } = config.planAudit;
  return observations.some(obs => severityMap[obs.kind] === 'blocker');
}

function computeVerdict(score: number, blocked: boolean): PlanAuditVerdict {
  const config = resolveConfig();
  const { verdictThresholds } = config.planAudit;

  if (blocked) return 'BLOCKED';
  if (score >= verdictThresholds.certified) return 'CERTIFIED';
  if (score >= verdictThresholds.conditional) return 'CONDITIONAL';
  return 'BLOCKED';
}

function countBySeverity(observations: readonly PlanAuditObservation[]): {
  blockers: number;
  warnings: number;
  info: number;
} {
  const config = resolveConfig();
  const { severityMap } = config.planAudit;
  let blockers = 0;
  let warnings = 0;
  let info = 0;

  for (const obs of observations) {
    const severity = severityMap[obs.kind] ?? 'warning';
    if (severity === 'blocker') blockers++;
    else if (severity === 'warning') warnings++;
    else info++;
  }

  return { blockers, warnings, info };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpret plan audit observations into assessments and a rollup verdict.
 *
 * @param planFile - Relative path to the plan file (for the report)
 * @param promptFiles - Relative paths to prompt files (for the report)
 * @param observations - Observations from analyzePlan()
 * @returns Verdict report with assessments, score, and verdict
 */
export function interpretPlanAudit(
  planFile: string,
  promptFiles: readonly string[],
  observations: readonly PlanAuditObservation[],
): PlanAuditVerdictReport {
  const grouped = groupByKind(observations);

  const assessments: PlanAuditAssessment[] = [
    ...classifyHeaders(grouped),
    ...classifyVerification(grouped),
    ...classifyCleanup(grouped),
    ...classifyStandingElements(grouped),
    ...classifyPreFlight(grouped),
    ...classifyPrompts(grouped),
    ...classifyConventions(grouped),
  ];

  const score = computeScore(observations);
  const blocked = hasBlocker(observations);
  const verdict = computeVerdict(score, blocked);
  const counts = countBySeverity(observations);

  return {
    verdict,
    score,
    blockerCount: counts.blockers,
    warningCount: counts.warnings,
    infoCount: counts.info,
    assessments,
    planFile,
    promptFiles,
  };
}

// ---------------------------------------------------------------------------
// Pretty print
// ---------------------------------------------------------------------------

const VERDICT_LABELS: Record<PlanAuditVerdict, string> = {
  CERTIFIED: 'CERTIFIED  -- plan is ready for execution',
  CONDITIONAL: 'CONDITIONAL  -- plan needs review before execution',
  BLOCKED: 'BLOCKED  -- plan cannot execute until issues are resolved',
};

/** Assessment kinds that represent positive signals. */
const POSITIVE_KINDS = new Set<PlanAuditAssessmentKind>([
  'HEADER_COMPLETE',
  'VERIFICATION_PRESENT',
  'CLEANUP_REFERENCED',
  'STANDING_ELEMENTS_COMPLETE',
  'CERTIFIED',
  'PROMPT_WELL_FORMED',
  'CONVENTION_REFERENCE',
  'DEFERRED_CLEANUP_NOTED',
]);

function formatAssessment(a: PlanAuditAssessment): string {
  const isPositive = POSITIVE_KINDS.has(a.kind);
  const marker = isPositive ? 'ok' : '!!';
  const subject = a.subject.symbol ? `${a.subject.file || 'plan'}:${a.subject.symbol}` : a.subject.file || 'plan';
  const confidence = a.confidence === 'high' ? '' : ` [${a.confidence} confidence]`;
  const review = a.requiresManualReview ? ' [needs manual review]' : '';
  return `  ${marker} ${a.kind}  ${subject}${confidence}${review}\n     ${a.rationale.join(' ')}`;
}

export function prettyPrint(report: PlanAuditVerdictReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('=== PLAN AUDIT VERDICT ===');
  lines.push(`Verdict: ${VERDICT_LABELS[report.verdict]}`);
  lines.push(`Score: ${report.score}/100`);
  lines.push(`Blockers: ${report.blockerCount}  Warnings: ${report.warningCount}  Info: ${report.infoCount}`);
  lines.push(`Plan: ${report.planFile}`);
  if (report.promptFiles.length > 0) {
    lines.push(`Prompts: ${report.promptFiles.length} file(s)`);
  }
  lines.push('');

  // Negative assessments first (blockers/warnings)
  const negative = report.assessments.filter(a => !POSITIVE_KINDS.has(a.kind));
  if (negative.length > 0) {
    lines.push('ISSUES:');
    for (const a of negative) {
      lines.push(formatAssessment(a));
    }
    lines.push('');
  }

  // Positive assessments
  const positive = report.assessments.filter(a => POSITIVE_KINDS.has(a.kind));
  if (verbose && positive.length > 0) {
    lines.push('COMPLIANT:');
    for (const a of positive) {
      lines.push(formatAssessment(a));
    }
    lines.push('');
  } else {
    lines.push(`COMPLIANT: ${positive.length} check(s) passed (use --verbose to see details)`);
    lines.push('');
  }

  lines.push('=== END ===');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(): void {
  const args = parseArgs(process.argv, { namedOptions: ['--prompts'] });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-plan-audit.ts <plan-file> [--prompts <glob>] [--pretty] [--verbose]\n\n' +
        'Interpret plan audit observations and produce a verdict.\n\n' +
        'Verdicts:\n' +
        '  CERTIFIED    Plan is ready for execution (score >= 90, no blockers)\n' +
        '  CONDITIONAL  Plan needs review (score >= 60, no blockers)\n' +
        '  BLOCKED      Plan cannot execute (blockers found or score < 60)\n\n' +
        'Exit codes:\n' +
        '  0 - CERTIFIED\n' +
        '  1 - CONDITIONAL\n' +
        '  2 - BLOCKED\n\n' +
        'Options:\n' +
        '  --prompts <glob>  Glob pattern for prompt files\n' +
        '  --pretty          Human-readable output\n' +
        '  --verbose         Show compliant checks in pretty output\n' +
        '  --help            Show this help\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) fatal('No plan file path provided. Use --help for usage.');

  const planPath = path.resolve(args.paths[0].replace(/^~/, process.env.HOME ?? '~'));

  let promptPaths: string[] = [];
  if (args.options.prompts) {
    const expanded = args.options.prompts.replace(/^~/, process.env.HOME ?? '~');
    promptPaths = fg.sync(expanded, { absolute: true });
  }
  for (let i = 1; i < args.paths.length; i++) {
    const p = path.resolve(args.paths[i].replace(/^~/, process.env.HOME ?? '~'));
    if (fs.existsSync(p)) promptPaths.push(p);
  }

  // Run observation layer
  const result = analyzePlan(planPath, promptPaths);

  // Run interpreter
  const relPrompts = promptPaths.map(p => path.relative(process.cwd(), p));
  const report = interpretPlanAudit(result.filePath, relPrompts, result.observations);

  if (args.pretty) {
    const verbose = process.argv.includes('--verbose');
    process.stdout.write(prettyPrint(report, verbose) + '\n');
  } else {
    output(report, false);
  }

  // Exit codes
  if (report.verdict === 'BLOCKED') process.exit(2);
  if (report.verdict === 'CONDITIONAL') process.exit(1);
  process.exit(0);
}

/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-plan-audit.ts') || process.argv[1].endsWith('ast-interpret-plan-audit'));

if (isDirectRun) {
  main();
}
/* v8 ignore stop */
