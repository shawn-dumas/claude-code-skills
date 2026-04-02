import { describe, it, expect } from 'vitest';
import {
  categorize,
  findingId,
  assignTrack,
  observationsToFindings,
  effectAssessmentsToFindings,
  ownershipAssessmentsToFindings,
  deadCodeAssessmentsToFindings,
  templateAssessmentsToFindings,
  testQualityAssessmentsToFindings,
  testCoverageAssessmentsToFindings,
  displayFormatAssessmentsToFindings,
  deduplicateAndSort,
} from '../ast-audit-findings';
import type {
  Observation,
  EffectAssessment,
  OwnershipAssessment,
  DeadCodeAssessment,
  TemplateAssessment,
  TestQualityAssessment,
  TestGapAssessment,
  DisplayFormatAssessment,
  Finding,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function obs(kind: string, file = 'src/ui/Foo.tsx', line = 10, evidence: Record<string, unknown> = {}): Observation {
  return { kind, file, line, evidence };
}

function assessment<K extends string>(
  kind: K,
  file = 'src/ui/Foo.tsx',
  line = 10,
  confidence: 'high' | 'medium' | 'low' = 'high',
  rationale: string[] = [kind],
): {
  kind: K;
  subject: { file: string; line: number };
  confidence: typeof confidence;
  rationale: string[];
  basedOn: [];
  isCandidate: boolean;
  requiresManualReview: boolean;
} {
  return {
    kind,
    subject: { file, line },
    confidence,
    rationale,
    basedOn: [],
    isCandidate: false,
    requiresManualReview: false,
  };
}

// ---------------------------------------------------------------------------
// categorize
// ---------------------------------------------------------------------------

describe('categorize', () => {
  it('classifies bug kinds', () => {
    expect(categorize('trust-boundary-gap')).toBe('Bug');
    expect(categorize('as-any')).toBe('Bug');
    expect(categorize('non-null-assertion')).toBe('Bug');
    expect(categorize('RAW_ROLE_CHECK')).toBe('Bug');
    expect(categorize('RAW_ROLE_EQUALITY')).toBe('Bug');
    expect(categorize('bug')).toBe('Bug');
    expect(categorize('bug-race')).toBe('Bug');
  });

  it('classifies architecture kinds', () => {
    expect(categorize('ddau-violation')).toBe('Architecture');
    expect(categorize('eliminable-effect')).toBe('Architecture');
    expect(categorize('dead-export')).toBe('Architecture');
    expect(categorize('complexity-hotspot')).toBe('Architecture');
    expect(categorize('circular-dep')).toBe('Architecture');
    expect(categorize('handler-inline-logic')).toBe('Architecture');
    expect(categorize('missing-concern')).toBe('Architecture');
    expect(categorize('branded-type-gap')).toBe('Architecture');
  });

  it('classifies testing kinds', () => {
    expect(categorize('test-gap')).toBe('Testing');
    expect(categorize('mock-internal')).toBe('Testing');
  });

  it('defaults to Style for unknown kinds', () => {
    expect(categorize('style')).toBe('Style');
    expect(categorize('unknown-thing')).toBe('Style');
  });
});

// ---------------------------------------------------------------------------
// findingId
// ---------------------------------------------------------------------------

describe('findingId', () => {
  it('produces deterministic hash', () => {
    const a = findingId('src/foo.ts', 42, 'as-any');
    const b = findingId('src/foo.ts', 42, 'as-any');
    expect(a).toBe(b);
  });

  it('differs for different inputs', () => {
    const a = findingId('src/foo.ts', 42, 'as-any');
    const b = findingId('src/foo.ts', 43, 'as-any');
    const c = findingId('src/bar.ts', 42, 'as-any');
    const d = findingId('src/foo.ts', 42, 'non-null-assertion');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('handles undefined line as 0', () => {
    const a = findingId('src/foo.ts', undefined, 'as-any');
    const b = findingId('src/foo.ts', 0, 'as-any');
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// assignTrack
// ---------------------------------------------------------------------------

describe('assignTrack', () => {
  it('assigns BFF for server paths', () => {
    expect(assignTrack('src/pages/api/teams.ts')).toBe('bff');
    expect(assignTrack('src/server/handlers/foo.ts')).toBe('bff');
    expect(assignTrack('src/server/db/queries.ts')).toBe('bff');
  });

  it('assigns FE for everything else', () => {
    expect(assignTrack('src/ui/page_blocks/foo.tsx')).toBe('fe');
    expect(assignTrack('src/shared/utils/date.ts')).toBe('fe');
    expect(assignTrack('src/pages/dashboard.tsx')).toBe('fe');
    expect(assignTrack('src/fixtures/brand.ts')).toBe('fe');
  });
});

// ---------------------------------------------------------------------------
// observationsToFindings
// ---------------------------------------------------------------------------

describe('observationsToFindings', () => {
  it('maps AS_ANY_CAST to as-any P4', () => {
    const findings = observationsToFindings([obs('AS_ANY_CAST')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('as-any');
    expect(findings[0].priority).toBe('P4');
    expect(findings[0].category).toBe('Bug');
  });

  it('maps NON_NULL_ASSERTION to non-null-assertion P4', () => {
    const findings = observationsToFindings([obs('NON_NULL_ASSERTION')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('non-null-assertion');
    expect(findings[0].priority).toBe('P4');
  });

  it('maps TRUST_BOUNDARY_CAST to trust-boundary-gap P2', () => {
    const findings = observationsToFindings([
      obs('TRUST_BOUNDARY_CAST', 'src/server/foo.ts', 5, { castTarget: 'Foo' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('trust-boundary-gap');
    expect(findings[0].priority).toBe('P2');
    expect(findings[0].track).toBe('bff');
  });

  it('maps FUNCTION_COMPLEXITY CC=26 to complexity-hotspot P1', () => {
    const findings = observationsToFindings([
      obs('FUNCTION_COMPLEXITY', 'src/ui/Foo.tsx', 10, { cyclomaticComplexity: 26, functionName: 'render' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('complexity-hotspot');
    expect(findings[0].priority).toBe('P1');
    expect(findings[0].evidence).toContain('CC=26');
  });

  it('maps FUNCTION_COMPLEXITY CC=15 to complexity-hotspot P2', () => {
    const findings = observationsToFindings([
      obs('FUNCTION_COMPLEXITY', 'src/ui/Foo.tsx', 10, { cyclomaticComplexity: 15, functionName: 'calc' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('P2');
  });

  it('skips FUNCTION_COMPLEXITY below threshold (CC=8)', () => {
    const findings = observationsToFindings([
      obs('FUNCTION_COMPLEXITY', 'src/ui/Foo.tsx', 10, { cyclomaticComplexity: 8, functionName: 'simple' }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('maps RAW_ROLE_CHECK to P1', () => {
    const findings = observationsToFindings([obs('RAW_ROLE_CHECK', 'src/ui/Guard.tsx')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('P1');
    expect(findings[0].kind).toBe('RAW_ROLE_CHECK');
  });

  it('maps HANDLER_INLINE_LOGIC to handler-inline-logic P4', () => {
    const findings = observationsToFindings([
      obs('HANDLER_INLINE_LOGIC', 'src/pages/api/foo.ts', 5, { lineCount: 50 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('handler-inline-logic');
    expect(findings[0].track).toBe('bff');
  });

  it('maps CONTAINER_MISSING_ERROR to missing-concern P4', () => {
    const findings = observationsToFindings([obs('CONTAINER_MISSING_ERROR')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('missing-concern');
  });

  it('skips unknown observation kinds', () => {
    const findings = observationsToFindings([obs('HOOK_CALL'), obs('COMPONENT_DECLARATION')]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// effectAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('effectAssessmentsToFindings', () => {
  it('maps DERIVED_STATE to eliminable-effect', () => {
    const findings = effectAssessmentsToFindings([assessment('DERIVED_STATE') as EffectAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('eliminable-effect');
    expect(findings[0].priority).toBe('P3');
  });

  it('maps EVENT_HANDLER_DISGUISED to eliminable-effect', () => {
    const findings = effectAssessmentsToFindings([assessment('EVENT_HANDLER_DISGUISED') as EffectAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('eliminable-effect');
  });

  it('skips NECESSARY and TIMER_RACE', () => {
    const findings = effectAssessmentsToFindings([
      assessment('NECESSARY') as EffectAssessment,
      assessment('TIMER_RACE') as EffectAssessment,
      assessment('DOM_EFFECT') as EffectAssessment,
      assessment('EXTERNAL_SUBSCRIPTION') as EffectAssessment,
    ]);
    expect(findings).toHaveLength(0);
  });

  it('skips low confidence', () => {
    const findings = effectAssessmentsToFindings([
      assessment('DERIVED_STATE', 'src/ui/Foo.tsx', 10, 'low') as EffectAssessment,
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ownershipAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('ownershipAssessmentsToFindings', () => {
  it('maps LEAF_VIOLATION to ddau-violation', () => {
    const findings = ownershipAssessmentsToFindings([assessment('LEAF_VIOLATION') as OwnershipAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('ddau-violation');
    expect(findings[0].priority).toBe('P3');
  });

  it('skips healthy classifications', () => {
    const findings = ownershipAssessmentsToFindings([
      assessment('CONTAINER') as OwnershipAssessment,
      assessment('DDAU_COMPONENT') as OwnershipAssessment,
      assessment('LAYOUT_SHELL') as OwnershipAssessment,
      assessment('AMBIGUOUS') as OwnershipAssessment,
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deadCodeAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('deadCodeAssessmentsToFindings', () => {
  it('maps DEAD_EXPORT to dead-export P4', () => {
    const findings = deadCodeAssessmentsToFindings([assessment('DEAD_EXPORT') as DeadCodeAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('dead-export');
    expect(findings[0].priority).toBe('P4');
  });

  it('maps CIRCULAR_DEPENDENCY to circular-dep', () => {
    const findings = deadCodeAssessmentsToFindings([assessment('CIRCULAR_DEPENDENCY') as DeadCodeAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('circular-dep');
  });

  it('skips POSSIBLY_DEAD_EXPORT', () => {
    const findings = deadCodeAssessmentsToFindings([assessment('POSSIBLY_DEAD_EXPORT') as DeadCodeAssessment]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// templateAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('templateAssessmentsToFindings', () => {
  it('maps COMPLEXITY_HOTSPOT to complexity-hotspot', () => {
    const findings = templateAssessmentsToFindings([assessment('COMPLEXITY_HOTSPOT') as TemplateAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('complexity-hotspot');
  });

  it('skips EXTRACTION_CANDIDATE', () => {
    const findings = templateAssessmentsToFindings([assessment('EXTRACTION_CANDIDATE') as TemplateAssessment]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// testQualityAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('testQualityAssessmentsToFindings', () => {
  it('maps MOCK_INTERNAL_VIOLATION to mock-internal', () => {
    const findings = testQualityAssessmentsToFindings([assessment('MOCK_INTERNAL_VIOLATION') as TestQualityAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('mock-internal');
  });

  it('skips MOCK_BOUNDARY_COMPLIANT and other healthy kinds', () => {
    const findings = testQualityAssessmentsToFindings([
      assessment('MOCK_BOUNDARY_COMPLIANT') as TestQualityAssessment,
      assessment('CLEANUP_COMPLETE') as TestQualityAssessment,
      assessment('ASSERTION_USER_VISIBLE') as TestQualityAssessment,
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// testCoverageAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('testCoverageAssessmentsToFindings', () => {
  it('maps TEST_GAP with HIGH risk to P2', () => {
    const a = {
      ...assessment('TEST_GAP'),
      coverage: 'UNTESTED' as const,
      risk: 'HIGH' as const,
      suggestedPriority: 'P2' as const,
    } satisfies TestGapAssessment;
    const findings = testCoverageAssessmentsToFindings([a]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('test-gap');
    expect(findings[0].priority).toBe('P2');
  });

  it('maps TEST_GAP with MEDIUM risk to P3', () => {
    const a = {
      ...assessment('TEST_GAP'),
      coverage: 'INDIRECTLY_TESTED' as const,
      risk: 'MEDIUM' as const,
      suggestedPriority: 'P3' as const,
    } satisfies TestGapAssessment;
    const findings = testCoverageAssessmentsToFindings([a]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('P3');
  });
});

// ---------------------------------------------------------------------------
// displayFormatAssessmentsToFindings
// ---------------------------------------------------------------------------

describe('displayFormatAssessmentsToFindings', () => {
  it('maps WRONG_PLACEHOLDER to style P5', () => {
    const findings = displayFormatAssessmentsToFindings([assessment('WRONG_PLACEHOLDER') as DisplayFormatAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('style');
    expect(findings[0].priority).toBe('P5');
  });

  it('maps RAW_FORMAT_BYPASS to style', () => {
    const findings = displayFormatAssessmentsToFindings([assessment('RAW_FORMAT_BYPASS') as DisplayFormatAssessment]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('style');
  });
});

// ---------------------------------------------------------------------------
// deduplicateAndSort
// ---------------------------------------------------------------------------

describe('deduplicateAndSort', () => {
  it('removes duplicates by id, keeping highest confidence', () => {
    const f1: Finding = {
      id: 'abc123',
      kind: 'as-any',
      priority: 'P4',
      category: 'Bug',
      file: 'src/foo.ts',
      line: 10,
      evidence: 'test',
      rationale: ['r1'],
      confidence: 'medium',
      source: 'type-safety',
      astConfirmed: true,
      track: 'fe',
    };
    const f2: Finding = { ...f1, confidence: 'high', source: 'type-safety-2' };

    const result = deduplicateAndSort([f1, f2]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('high');
  });

  it('sorts by priority then file then line', () => {
    const f1: Finding = {
      id: 'id1',
      kind: 'as-any',
      priority: 'P4',
      category: 'Bug',
      file: 'src/b.ts',
      line: 20,
      evidence: 'e',
      rationale: [],
      confidence: 'high',
      source: 's',
      astConfirmed: true,
      track: 'fe',
    };
    const f2: Finding = { ...f1, id: 'id2', priority: 'P1', file: 'src/a.ts', line: 10 };
    const f3: Finding = { ...f1, id: 'id3', priority: 'P4', file: 'src/a.ts', line: 5 };

    const result = deduplicateAndSort([f1, f2, f3]);
    expect(result.map(f => f.id)).toEqual(['id2', 'id3', 'id1']);
  });

  it('handles empty input', () => {
    expect(deduplicateAndSort([])).toEqual([]);
  });

  it('sorts by line number when file and priority match', () => {
    const base: Finding = {
      id: 'id-line-a',
      kind: 'as-any',
      priority: 'P3',
      category: 'Bug',
      file: 'src/same.ts',
      line: 50,
      evidence: 'e',
      rationale: [],
      confidence: 'high',
      source: 's',
      astConfirmed: true,
      track: 'fe',
    };
    const earlier: Finding = { ...base, id: 'id-line-b', line: 10 };
    const nullLine: Finding = { ...base, id: 'id-line-c', line: undefined };

    const result = deduplicateAndSort([base, earlier, nullLine]);
    // nullLine (undefined -> 0) < earlier (10) < base (50)
    expect(result.map(f => f.id)).toEqual(['id-line-c', 'id-line-b', 'id-line-a']);
  });
});
