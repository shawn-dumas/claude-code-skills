/**
 * ast-audit-findings.ts -- Pure mapper from observations/assessments to Finding[].
 *
 * No I/O, no AST infrastructure. Imports only types and lookupPriority.
 * Every function is deterministic: same input produces same output.
 */
import { createHash } from 'crypto';
import { lookupPriority } from './ast-config';
import type {
  Finding,
  FindingCategory,
  FindingTrack,
  AuditPriority,
  Observation,
  Assessment,
  EffectAssessment,
  OwnershipAssessment,
  DeadCodeAssessment,
  TestQualityAssessment,
  TestGapAssessment,
  TemplateAssessment,
  DisplayFormatAssessment,
} from './types';

// ---------------------------------------------------------------------------
// Category derivation
// ---------------------------------------------------------------------------

const BUG_KINDS = new Set([
  'trust-boundary-gap',
  'as-any',
  'non-null-assertion',
  'RAW_ROLE_CHECK',
  'RAW_ROLE_EQUALITY',
]);

const ARCHITECTURE_KINDS = new Set([
  'ddau-violation',
  'eliminable-effect',
  'cross-domain-coupling',
  'circular-dep',
  'dead-export',
  'complexity-hotspot',
  'handler-inline-logic',
  'missing-concern',
  'branded-type-gap',
]);

const TESTING_KINDS = new Set(['test-gap', 'mock-internal']);

export function categorize(kind: string): FindingCategory {
  if (kind.startsWith('bug') || BUG_KINDS.has(kind)) return 'Bug';
  if (ARCHITECTURE_KINDS.has(kind)) return 'Architecture';
  if (TESTING_KINDS.has(kind)) return 'Testing';
  return 'Style';
}

// ---------------------------------------------------------------------------
// Deterministic finding ID
// ---------------------------------------------------------------------------

export function findingId(file: string, line: number | undefined, kind: string): string {
  const raw = `${file}:${line ?? 0}:${kind}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Track assignment
// ---------------------------------------------------------------------------

export function assignTrack(filePath: string): FindingTrack {
  if (filePath.startsWith('src/pages/api/') || filePath.startsWith('src/server/')) return 'bff';
  return 'fe';
}

// ---------------------------------------------------------------------------
// Finding builder helper
// ---------------------------------------------------------------------------

function buildFinding(
  file: string,
  line: number | undefined,
  kind: string,
  evidence: string,
  rationale: readonly string[],
  confidence: 'high' | 'medium' | 'low',
  source: string,
  priorityContext?: Record<string, unknown>,
): Finding {
  const priority = lookupPriority(kind, priorityContext) as AuditPriority;
  return {
    id: findingId(file, line, kind),
    kind,
    priority,
    category: categorize(kind),
    file,
    line,
    evidence,
    rationale,
    confidence,
    source,
    astConfirmed: true,
    track: assignTrack(file),
  };
}

// ---------------------------------------------------------------------------
// Observation-to-finding mapping (direct, no interpreter)
// ---------------------------------------------------------------------------

interface ObsMapping {
  findingKind: string;
  contextBuilder?: (evidence: Record<string, unknown>) => Record<string, unknown> | undefined;
  threshold?: (evidence: Record<string, unknown>) => boolean;
}

const OBS_MAPPINGS: Record<string, ObsMapping> = {
  AS_ANY_CAST: { findingKind: 'as-any' },
  AS_UNKNOWN_AS_CAST: { findingKind: 'as-any' },
  EXPLICIT_ANY_ANNOTATION: { findingKind: 'as-any' },
  NON_NULL_ASSERTION: { findingKind: 'non-null-assertion' },
  TRUST_BOUNDARY_CAST: { findingKind: 'trust-boundary-gap' },
  FUNCTION_COMPLEXITY: {
    findingKind: 'complexity-hotspot',
    threshold: ev => (ev.cyclomaticComplexity as number) >= 10,
    contextBuilder: ev => ({ cyclomaticComplexity: ev.cyclomaticComplexity }),
  },
  RAW_ROLE_CHECK: { findingKind: 'RAW_ROLE_CHECK' },
  RAW_ROLE_EQUALITY: { findingKind: 'RAW_ROLE_EQUALITY' },
  HANDLER_INLINE_LOGIC: { findingKind: 'handler-inline-logic' },
  UNBRANDED_ID_FIELD: { findingKind: 'branded-type-gap' },
  UNBRANDED_PARAM: { findingKind: 'branded-type-gap' },
  CONTAINER_MISSING_LOADING: { findingKind: 'missing-concern' },
  CONTAINER_MISSING_ERROR: { findingKind: 'missing-concern' },
  CONTAINER_MISSING_EMPTY: { findingKind: 'missing-concern' },
  DIRECT_STORAGE_CALL: { findingKind: 'ddau-violation' },
};

export function observationsToFindings(observations: readonly Observation[]): Finding[] {
  const results: Finding[] = [];
  for (const obs of observations) {
    const mapping = OBS_MAPPINGS[obs.kind];
    if (!mapping) continue;
    if (mapping.threshold && !mapping.threshold(obs.evidence)) continue;

    const context = mapping.contextBuilder?.(obs.evidence);
    const evidence = formatObservationEvidence(obs);
    results.push(
      buildFinding(obs.file, obs.line, mapping.findingKind, evidence, [obs.kind], 'high', obs.kind, context),
    );
  }
  return results;
}

function formatObservationEvidence(obs: Observation): string {
  const ev = obs.evidence;
  switch (obs.kind) {
    case 'FUNCTION_COMPLEXITY': {
      const cc = String(ev.cyclomaticComplexity);
      const fn = typeof ev.functionName === 'string' ? ev.functionName : 'anonymous';
      return `CC=${cc} in ${fn}`;
    }
    case 'AS_ANY_CAST':
    case 'AS_UNKNOWN_AS_CAST':
      return `${obs.kind} at ${obs.file}:${String(obs.line)}`;
    case 'TRUST_BOUNDARY_CAST': {
      const target = typeof ev.castTarget === 'string' ? ev.castTarget : 'unknown';
      return `Trust boundary cast: ${target}`;
    }
    case 'RAW_ROLE_CHECK':
    case 'RAW_ROLE_EQUALITY':
      return `Raw role ${obs.kind === 'RAW_ROLE_CHECK' ? 'check' : 'equality'} outside canonical files`;
    case 'HANDLER_INLINE_LOGIC': {
      const lines = typeof ev.lineCount === 'number' ? String(ev.lineCount) : '?';
      return `Inline handler logic (${lines} lines)`;
    }
    case 'CONTAINER_MISSING_LOADING':
    case 'CONTAINER_MISSING_ERROR':
    case 'CONTAINER_MISSING_EMPTY':
      return `Missing ${(obs.kind.split('_').pop() ?? '').toLowerCase()} handling in container`;
    default:
      return `${obs.kind} at ${obs.file}:${obs.line}`;
  }
}

// ---------------------------------------------------------------------------
// Assessment-to-finding mappers
// ---------------------------------------------------------------------------

function assessmentToFinding(
  assessment: Assessment,
  findingKind: string,
  source: string,
  priorityContext?: Record<string, unknown>,
): Finding {
  return buildFinding(
    assessment.subject.file,
    assessment.subject.line,
    findingKind,
    assessment.rationale[0] ?? assessment.kind,
    assessment.rationale,
    assessment.confidence,
    source,
    priorityContext,
  );
}

// --- Effects ---

const EFFECT_VIOLATION_KINDS = new Set(['DERIVED_STATE', 'EVENT_HANDLER_DISGUISED']);

export function effectAssessmentsToFindings(assessments: readonly EffectAssessment[]): Finding[] {
  return assessments
    .filter(a => EFFECT_VIOLATION_KINDS.has(a.kind) && a.confidence !== 'low')
    .map(a => assessmentToFinding(a, 'eliminable-effect', 'interpret-effects'));
}

// --- Ownership ---

export function ownershipAssessmentsToFindings(assessments: readonly OwnershipAssessment[]): Finding[] {
  return assessments
    .filter(a => a.kind === 'LEAF_VIOLATION' && a.confidence !== 'low')
    .map(a => assessmentToFinding(a, 'ddau-violation', 'interpret-ownership'));
}

// --- Dead code ---

export function deadCodeAssessmentsToFindings(assessments: readonly DeadCodeAssessment[]): Finding[] {
  return assessments
    .filter(a => {
      if (a.kind === 'DEAD_EXPORT' || a.kind === 'DEAD_BARREL_REEXPORT') return a.confidence !== 'low';
      if (a.kind === 'CIRCULAR_DEPENDENCY') return a.confidence !== 'low';
      return false;
    })
    .map(a => {
      if (a.kind === 'CIRCULAR_DEPENDENCY') {
        const isTypeOnly = a.basedOn.some(ref => ref.kind.includes('type'));
        return assessmentToFinding(a, 'circular-dep', 'interpret-dead-code', { isTypeOnly });
      }
      return assessmentToFinding(a, 'dead-export', 'interpret-dead-code');
    });
}

// --- Template ---

export function templateAssessmentsToFindings(assessments: readonly TemplateAssessment[]): Finding[] {
  return assessments
    .filter(a => a.kind === 'COMPLEXITY_HOTSPOT' && a.confidence !== 'low')
    .map(a => assessmentToFinding(a, 'complexity-hotspot', 'interpret-template'));
}

// --- Test quality ---

export function testQualityAssessmentsToFindings(assessments: readonly TestQualityAssessment[]): Finding[] {
  return assessments
    .filter(a => a.kind === 'MOCK_INTERNAL_VIOLATION' && a.confidence !== 'low')
    .map(a => assessmentToFinding(a, 'mock-internal', 'interpret-test-quality', { confidence: a.confidence }));
}

// --- Test coverage ---

export function testCoverageAssessmentsToFindings(assessments: readonly TestGapAssessment[]): Finding[] {
  return assessments
    .filter(a => a.kind === 'TEST_GAP')
    .map(a => assessmentToFinding(a, 'test-gap', 'interpret-test-coverage', { risk: a.risk }));
}

// --- Display format ---

const DISPLAY_VIOLATION_KINDS = new Set([
  'WRONG_PLACEHOLDER',
  'MISSING_PLACEHOLDER',
  'FALSY_COALESCE_NUMERIC',
  'HARDCODED_DASH',
  'RAW_FORMAT_BYPASS',
  'PERCENTAGE_PRECISION_MISMATCH',
  'ZERO_NULL_CONFLATION',
  'INCONSISTENT_EMPTY_MESSAGE',
]);

export function displayFormatAssessmentsToFindings(assessments: readonly DisplayFormatAssessment[]): Finding[] {
  return assessments
    .filter(a => DISPLAY_VIOLATION_KINDS.has(a.kind) && a.confidence !== 'low')
    .map(a => assessmentToFinding(a, 'style', 'interpret-display-format'));
}

// ---------------------------------------------------------------------------
// Deduplication + sorting
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3, P5: 4 };

export function deduplicateAndSort(findings: Finding[]): Finding[] {
  // Group by id, keep highest confidence per group
  const byId = new Map<string, Finding>();
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

  for (const f of findings) {
    const existing = byId.get(f.id);
    if (!existing || (confidenceRank[f.confidence] ?? 0) > (confidenceRank[existing.confidence] ?? 0)) {
      byId.set(f.id, f);
    }
  }

  const deduped = [...byId.values()];
  deduped.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return (a.line ?? 0) - (b.line ?? 0);
  });

  return deduped;
}
