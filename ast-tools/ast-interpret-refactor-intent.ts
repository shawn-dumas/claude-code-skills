/**
 * Refactor intent interpreter.
 *
 * Takes a RefactorSignalPair (produced by ast-refactor-intent.ts) and an
 * optional AuditContext, then classifies each signal as PRESERVED,
 * INTENTIONALLY_REMOVED, ACCIDENTALLY_DROPPED, ADDED, or CHANGED.
 *
 * This is the core decision engine answering "was this refactor
 * behavior-preserving?"
 */

import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { computeBoundaryConfidence } from './shared';
import { astConfig } from './ast-config';
import type { AnyObservation, AuditContext, IntentSignal, IntentReport, RefactorSignalPair } from './types';

// ---------------------------------------------------------------------------
// Refactor-type heuristic rules
// ---------------------------------------------------------------------------

/**
 * Observation kinds that are expected to be removed for each refactor type.
 * If the audit context has a refactorType but no flaggedKinds/locations,
 * we use these heuristics to infer intentional removal.
 */
/**
 * Calibrated: 2026-03-14
 * Fixtures: 9 intent (7 synthetic, 2 git-history)
 * Accuracy: 100% (55/55)
 * Bias: 0 FP, 0 FN for ACCIDENTALLY_DROPPED
 * Adjustments: added POSTHOG_CALL to service-hook removals (service hooks
 *   must not contain posthog calls per project rules); added STATIC_IMPORT
 *   to service-hook removals (import cleanup follows usage removal).
 */
const REFACTOR_TYPE_EXPECTED_REMOVALS: Record<string, ReadonlySet<string>> = {
  component: new Set(['HOOK_CALL', 'EFFECT_LOCATION']),
  'service-hook': new Set(['TOAST_CALL', 'POSTHOG_CALL', 'WINDOW_MUTATION', 'DIRECT_STORAGE_CALL', 'STATIC_IMPORT']),
  provider: new Set(['FETCH_API_CALL', 'QUERY_HOOK_DEFINITION']),
  route: new Set<string>(),
  hook: new Set<string>(),
  module: new Set<string>(),
  'api-handler': new Set<string>(),
};

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/**
 * Check if a specific observation location was flagged by the audit.
 */
function isLocationFlagged(obs: AnyObservation, auditContext: AuditContext): boolean {
  return auditContext.flaggedLocations.some(
    loc => loc.file === obs.file && loc.line === obs.line && loc.kind === obs.kind,
  );
}

/**
 * Classify an unmatched signal (present in before, missing from after).
 */
function classifyUnmatched(obs: AnyObservation, auditContext: AuditContext | undefined): IntentSignal {
  const base = {
    kind: obs.kind,
    file: obs.file,
    line: obs.line,
    evidence: obs.evidence,
  };

  // (a) Exact location match in audit context
  if (auditContext && auditContext.flaggedKinds.has(obs.kind) && isLocationFlagged(obs, auditContext)) {
    return {
      ...base,
      classification: 'INTENTIONALLY_REMOVED',
      confidence: 'high',
      rationale: `Flagged kind '${obs.kind}' at exact location by audit`,
    };
  }

  // (b) Kind match in audit context but not exact location
  if (auditContext?.flaggedKinds.has(obs.kind)) {
    return {
      ...base,
      classification: 'INTENTIONALLY_REMOVED',
      confidence: 'low',
      rationale: 'Kind was flagged by audit but exact location not matched',
    };
  }

  // (c) Heuristic inference based on refactorType
  if (auditContext) {
    const expectedRemovals = REFACTOR_TYPE_EXPECTED_REMOVALS[auditContext.refactorType];
    if (expectedRemovals?.has(obs.kind)) {
      return {
        ...base,
        classification: 'INTENTIONALLY_REMOVED',
        confidence: 'low',
        rationale: `Kind '${obs.kind}' is expected removal for refactorType '${auditContext.refactorType}'`,
      };
    }
  }

  // (c) No audit context: heuristic by refactorType alone
  // If we have no audit context at all, we cannot justify intentional removal
  // (d) Conservative default
  return {
    ...base,
    classification: 'ACCIDENTALLY_DROPPED',
    confidence: 'high',
    rationale: 'Not flagged by audit. Not explained by refactor type.',
  };
}

/**
 * Classify a novel signal (present in after, missing from before).
 */
function classifyNovel(obs: AnyObservation): IntentSignal {
  return {
    kind: obs.kind,
    file: obs.file,
    line: obs.line,
    evidence: obs.evidence,
    classification: 'ADDED',
    confidence: 'high',
    rationale: 'New signal not present in before snapshot',
  };
}

/**
 * Classify a matched signal pair (present in both before and after).
 */
function classifyMatched(before: AnyObservation, after: AnyObservation, similarity: number): IntentSignal {
  const matchedTo = { file: after.file, line: after.line, kind: after.kind };
  const { thresholds } = astConfig.intentMatcher;

  // Perfect or near-perfect match -> PRESERVED
  if (similarity >= thresholds.warn) {
    const confidence = computeBoundaryConfidence(similarity, [thresholds.warn, thresholds.fail]);
    return {
      kind: before.kind,
      file: before.file,
      line: before.line,
      evidence: before.evidence,
      classification: 'PRESERVED',
      confidence,
      matchedTo,
      rationale: `Matched with similarity ${(similarity * 100).toFixed(0)}%`,
    };
  }

  // Below fail threshold -> should not have been matched (greedy matcher
  // accepted it but the similarity is too low for any classification)
  if (similarity < thresholds.fail) {
    return {
      kind: before.kind,
      file: before.file,
      line: before.line,
      evidence: before.evidence,
      classification: 'ACCIDENTALLY_DROPPED',
      confidence: 'high',
      matchedTo,
      rationale: `Matched with similarity ${(similarity * 100).toFixed(0)}% (below fail threshold ${(thresholds.fail * 100).toFixed(0)}%)`,
    };
  }

  // Above fail threshold but below warn -> CHANGED
  const confidence = computeBoundaryConfidence(similarity, [thresholds.warn, thresholds.fail]);
  return {
    kind: before.kind,
    file: before.file,
    line: before.line,
    evidence: before.evidence,
    classification: 'CHANGED',
    confidence,
    matchedTo,
    rationale: `Matched with similarity ${(similarity * 100).toFixed(0)}% (below preservation threshold)`,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const { signalWeights } = astConfig.intentMatcher;

/**
 * Compute the intent preservation score (0-100).
 * ADDED signals are excluded from the calculation.
 * PRESERVED, INTENTIONALLY_REMOVED, and CHANGED all count as "preserved."
 */
function computeIntentScore(signals: IntentSignal[]): number {
  let preserved = 0;
  let total = 0;

  for (const s of signals) {
    if (s.classification === 'ADDED') continue;
    const w = signalWeights[s.kind] ?? signalWeights._default;
    total += w;
    if (
      s.classification === 'PRESERVED' ||
      s.classification === 'INTENTIONALLY_REMOVED' ||
      s.classification === 'CHANGED'
    ) {
      preserved += w;
    }
  }

  return total === 0 ? 100 : Math.round((preserved / total) * 100);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpret a refactor signal pair and produce an intent report.
 *
 * @param signalPair - Paired observations from ast-refactor-intent
 * @param auditContext - Optional audit context for informed classification
 * @returns Intent report with classifications, score, and summary
 */
export function interpretRefactorIntent(signalPair: RefactorSignalPair, auditContext?: AuditContext): IntentReport {
  const signals: IntentSignal[] = [];

  // Classify unmatched signals (before only -- potentially dropped)
  for (const obs of signalPair.unmatched) {
    signals.push(classifyUnmatched(obs, auditContext));
  }

  // Classify novel signals (after only -- added)
  for (const obs of signalPair.novel) {
    signals.push(classifyNovel(obs));
  }

  // Classify matched signal pairs
  for (const pair of signalPair.matched) {
    signals.push(classifyMatched(pair.before, pair.after, pair.similarity));
  }

  const score = computeIntentScore(signals);

  const summary = {
    preserved: 0,
    intentionallyRemoved: 0,
    accidentallyDropped: 0,
    added: 0,
    changed: 0,
  };

  for (const s of signals) {
    switch (s.classification) {
      case 'PRESERVED':
        summary.preserved++;
        break;
      case 'INTENTIONALLY_REMOVED':
        summary.intentionallyRemoved++;
        break;
      case 'ACCIDENTALLY_DROPPED':
        summary.accidentallyDropped++;
        break;
      case 'ADDED':
        summary.added++;
        break;
      case 'CHANGED':
        summary.changed++;
        break;
    }
  }

  return {
    before: {
      files: signalPair.before.files,
      signalCount: signalPair.before.observations.length,
    },
    after: {
      files: signalPair.after.files,
      signalCount: signalPair.after.observations.length,
    },
    signals,
    score,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Pretty print
// ---------------------------------------------------------------------------

function weightDescription(kind: string): string {
  const w = signalWeights[kind] ?? signalWeights._default;
  if (w >= 2.0) return 'behavior-defining';
  if (w >= 1.5) return 'high-signal';
  if (w >= 1.0) return 'medium-signal';
  return 'low-signal';
}

function formatSignalLine(s: IntentSignal): string {
  const evidence = s.evidence as Record<string, unknown>;
  const identifiers: string[] = [];
  for (const key of ['hookName', 'propName', 'name', 'method', 'target', 'flagName'] as const) {
    const val = evidence[key];
    if (typeof val === 'string' && val.length > 0) {
      identifiers.push(`${key}=${val}`);
    }
  }
  const detail = identifiers.length > 0 ? identifiers.join(', ') : '';
  return `${s.kind}  ${detail}  ${s.file}:${s.line}`;
}

export function prettyPrint(report: IntentReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('=== REFACTOR INTENT REPORT ===');
  lines.push(`Score: ${report.score}/100`);
  lines.push('Summary:');
  lines.push(`  Preserved:             ${String(report.summary.preserved).padStart(3)}`);
  lines.push(
    `  Intentionally removed: ${String(report.summary.intentionallyRemoved).padStart(3)}${report.summary.intentionallyRemoved > 0 ? '  (audit-flagged violations)' : ''}`,
  );
  lines.push(
    `  Accidentally dropped:  ${String(report.summary.accidentallyDropped).padStart(3)}${report.summary.accidentallyDropped > 0 ? '  !! REVIEW' : ''}`,
  );
  lines.push(`  Added:                 ${String(report.summary.added).padStart(3)}`);
  lines.push(`  Changed:               ${String(report.summary.changed).padStart(3)}`);
  lines.push('');

  // ACCIDENTALLY DROPPED section
  const dropped = report.signals.filter(s => s.classification === 'ACCIDENTALLY_DROPPED');
  if (dropped.length > 0) {
    lines.push('ACCIDENTALLY DROPPED:');
    for (const s of dropped) {
      const w = signalWeights[s.kind] ?? signalWeights._default;
      lines.push(`  !! ${formatSignalLine(s)}`);
      lines.push(`     ${s.rationale}`);
      lines.push(`     Weight: ${w} (${weightDescription(s.kind)})`);
    }
    lines.push('');
  }

  // INTENTIONALLY REMOVED section
  const removed = report.signals.filter(s => s.classification === 'INTENTIONALLY_REMOVED');
  if (removed.length > 0) {
    lines.push('INTENTIONALLY REMOVED:');
    for (const s of removed) {
      lines.push(`  ok ${formatSignalLine(s)}`);
      lines.push(`     ${s.rationale}`);
    }
    lines.push('');
  }

  // CHANGED section
  const changed = report.signals.filter(s => s.classification === 'CHANGED');
  if (changed.length > 0) {
    lines.push('CHANGED:');
    for (const s of changed) {
      const matchInfo = s.matchedTo ? ` -> ${s.matchedTo.file}:${s.matchedTo.line}` : '';
      lines.push(`  ~  ${formatSignalLine(s)}${matchInfo}`);
      lines.push(`     ${s.rationale}`);
    }
    lines.push('');
  }

  // PRESERVED section
  const preserved = report.signals.filter(s => s.classification === 'PRESERVED');
  if (verbose && preserved.length > 0) {
    lines.push('PRESERVED:');
    for (const s of preserved) {
      const matchInfo = s.matchedTo ? ` -> ${s.matchedTo.file}:${s.matchedTo.line}` : '';
      lines.push(`  ok ${formatSignalLine(s)}${matchInfo}`);
    }
    lines.push('');
  } else {
    lines.push(`PRESERVED: ${preserved.length} signals (omitted for brevity, use --verbose)`);
    lines.push('');
  }

  // ADDED section
  const added = report.signals.filter(s => s.classification === 'ADDED');
  if (verbose && added.length > 0) {
    lines.push('ADDED:');
    for (const s of added) {
      lines.push(`  +  ${formatSignalLine(s)}`);
    }
    lines.push('');
  } else {
    lines.push(`ADDED: ${added.length} signals (omitted for brevity, use --verbose)`);
    lines.push('');
  }

  lines.push('=== END ===');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readJsonFile<T>(filePath: string): T {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fatal(`Failed to read ${filePath}: ${msg}`);
  }
}

/**
 * Deserialize a JSON-parsed AuditContext, converting the flaggedKinds
 * array back into a Set.
 */
function deserializeAuditContext(raw: {
  flaggedKinds: string[];
  flaggedLocations: { file: string; line: number; kind: string }[];
  refactorType: AuditContext['refactorType'];
}): AuditContext {
  return {
    flaggedKinds: new Set(raw.flaggedKinds),
    flaggedLocations: raw.flaggedLocations,
    refactorType: raw.refactorType,
  };
}

function main(): void {
  const namedOptions = ['--signal-pair', '--audit-context', '--refactor-type'] as const;
  const args = parseArgs(process.argv, namedOptions);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-refactor-intent.ts \\\n' +
        '  --signal-pair <path-to-json> \\\n' +
        '  [--audit-context <path-to-json>] \\\n' +
        '  [--refactor-type component] \\\n' +
        '  [--pretty]\n' +
        '\n' +
        'Interpret a refactor signal pair and classify each signal.\n' +
        '\n' +
        'Classifications:\n' +
        '  PRESERVED              - Signal exists in both before and after\n' +
        '  INTENTIONALLY_REMOVED  - Signal removed, justified by audit or heuristic\n' +
        '  ACCIDENTALLY_DROPPED   - Signal removed with no justification\n' +
        '  ADDED                  - New signal in after, not in before\n' +
        '  CHANGED                - Signal matched but evidence differs\n' +
        '\n' +
        'Exit codes:\n' +
        '  0 - Safe (score >= 90, 0 drops)\n' +
        '  1 - Review (score >= 70 but has drops)\n' +
        '  2 - Investigate (score < 70)\n',
    );
    process.exit(0);
  }

  const signalPairPath = args.options['signal-pair'];
  if (!signalPairPath) {
    fatal('--signal-pair <path> is required. Use --help for usage.');
  }

  const signalPair = readJsonFile<RefactorSignalPair>(signalPairPath);

  let auditContext: AuditContext | undefined;
  const auditContextPath = args.options['audit-context'];
  if (auditContextPath) {
    const raw = readJsonFile<{
      flaggedKinds: string[];
      flaggedLocations: { file: string; line: number; kind: string }[];
      refactorType: AuditContext['refactorType'];
    }>(auditContextPath);
    auditContext = deserializeAuditContext(raw);
  }

  const refactorType = args.options['refactor-type'] as AuditContext['refactorType'] | undefined;
  if (refactorType && !auditContext) {
    // Build a minimal audit context from just the refactor type
    auditContext = {
      flaggedKinds: new Set<string>(),
      flaggedLocations: [],
      refactorType,
    };
  }

  const report = interpretRefactorIntent(signalPair, auditContext);

  if (args.pretty) {
    const verbose = process.argv.includes('--verbose');
    process.stdout.write(prettyPrint(report, verbose) + '\n');
  } else {
    output(report, false);
  }

  // Exit codes
  if (report.score < 70) {
    process.exit(2);
  }
  if (report.summary.accidentallyDropped > 0 || report.score < 90) {
    process.exit(1);
  }
  process.exit(0);
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-refactor-intent.ts') ||
    process.argv[1].endsWith('ast-interpret-refactor-intent'));

if (isDirectRun) {
  main();
}
