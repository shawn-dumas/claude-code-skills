import { describe, it, expectTypeOf } from 'vitest';
import type {
  Observation,
  ObservationRef,
  Assessment,
  EffectObservation,
  EffectObservationKind,
  EffectObservationEvidence,
  EffectAssessment,
  EffectAssessmentKind,
  ObservationResult,
  AssessmentResult,
} from '../types';

describe('Semantic Layering Types', () => {
  describe('Observation', () => {
    it('accepts generic parameters correctly', () => {
      type TestEvidence = { foo: string; bar: number };
      type TestObservation = Observation<'TEST_KIND', TestEvidence>;

      const obs: TestObservation = {
        kind: 'TEST_KIND',
        file: '/path/to/file.ts',
        line: 42,
        evidence: { foo: 'hello', bar: 123 },
      };

      expectTypeOf(obs.kind).toEqualTypeOf<'TEST_KIND'>();
      expectTypeOf(obs.file).toEqualTypeOf<string>();
      expectTypeOf(obs.line).toEqualTypeOf<number>();
      expectTypeOf(obs.column).toEqualTypeOf<number | undefined>();
      expectTypeOf(obs.evidence).toEqualTypeOf<TestEvidence>();
    });

    it('works with optional column', () => {
      const withColumn: Observation = {
        kind: 'ANY',
        file: 'test.ts',
        line: 1,
        column: 5,
        evidence: {},
      };

      const withoutColumn: Observation = {
        kind: 'ANY',
        file: 'test.ts',
        line: 1,
        evidence: {},
      };

      expectTypeOf(withColumn.column).toEqualTypeOf<number | undefined>();
      expectTypeOf(withoutColumn.column).toEqualTypeOf<number | undefined>();
    });

    it('defaults to generic string kind and empty evidence', () => {
      const obs: Observation = {
        kind: 'anything',
        file: 'test.ts',
        line: 1,
        evidence: { anyKey: 'anyValue' },
      };

      expectTypeOf(obs.kind).toEqualTypeOf<string>();
      expectTypeOf(obs.evidence).toEqualTypeOf<Record<string, unknown>>();
    });
  });

  describe('ObservationRef', () => {
    it('can be constructed from an Observation', () => {
      const obs: Observation<'TEST', { data: string }> = {
        kind: 'TEST',
        file: '/path/to/file.ts',
        line: 42,
        evidence: { data: 'value' },
      };

      const ref: ObservationRef = {
        kind: obs.kind,
        file: obs.file,
        line: obs.line,
      };

      expectTypeOf(ref.kind).toEqualTypeOf<string>();
      expectTypeOf(ref.file).toEqualTypeOf<string>();
      expectTypeOf(ref.line).toEqualTypeOf<number>();
    });

    it('requires all three fields', () => {
      const ref: ObservationRef = {
        kind: 'SOME_KIND',
        file: 'test.ts',
        line: 10,
      };

      expectTypeOf(ref).toMatchTypeOf<ObservationRef>();
    });
  });

  describe('Assessment', () => {
    it('requires all fields', () => {
      const assessment: Assessment<'TEST_ASSESSMENT'> = {
        kind: 'TEST_ASSESSMENT',
        subject: {
          file: '/path/to/file.ts',
          line: 42,
          symbol: 'someFunction',
        },
        confidence: 'high',
        rationale: ['reason 1', 'reason 2'],
        basedOn: [{ kind: 'OBS', file: 'test.ts', line: 1 }],
        isCandidate: true,
        requiresManualReview: false,
      };

      expectTypeOf(assessment.kind).toEqualTypeOf<'TEST_ASSESSMENT'>();
      expectTypeOf(assessment.subject.file).toEqualTypeOf<string>();
      expectTypeOf(assessment.subject.line).toEqualTypeOf<number | undefined>();
      expectTypeOf(assessment.subject.symbol).toEqualTypeOf<string | undefined>();
      expectTypeOf(assessment.confidence).toEqualTypeOf<'high' | 'medium' | 'low'>();
      expectTypeOf(assessment.rationale).toEqualTypeOf<readonly string[]>();
      expectTypeOf(assessment.basedOn).toEqualTypeOf<readonly ObservationRef[]>();
      expectTypeOf(assessment.isCandidate).toEqualTypeOf<boolean>();
      expectTypeOf(assessment.requiresManualReview).toEqualTypeOf<boolean>();
    });

    it('subject line and symbol are optional', () => {
      const assessment: Assessment = {
        kind: 'SOME_KIND',
        subject: {
          file: '/path/to/file.ts',
        },
        confidence: 'low',
        rationale: [],
        basedOn: [],
        isCandidate: false,
        requiresManualReview: true,
      };

      expectTypeOf(assessment.subject.line).toEqualTypeOf<number | undefined>();
      expectTypeOf(assessment.subject.symbol).toEqualTypeOf<string | undefined>();
    });
  });

  describe('EffectObservation', () => {
    it('is properly typed with EffectObservationKind', () => {
      const obs: EffectObservation = {
        kind: 'EFFECT_STATE_SETTER_CALL',
        file: 'component.tsx',
        line: 15,
        evidence: {
          effectLine: 10,
          parentFunction: 'MyComponent',
          identifier: 'setCount',
        },
      };

      expectTypeOf(obs.kind).toMatchTypeOf<EffectObservationKind>();
      expectTypeOf(obs.evidence).toMatchTypeOf<EffectObservationEvidence>();
    });

    it('accepts all EffectObservationKind values', () => {
      const kinds: EffectObservationKind[] = [
        'EFFECT_LOCATION',
        'EFFECT_DEP_ENTRY',
        'EFFECT_STATE_SETTER_CALL',
        'EFFECT_FETCH_CALL',
        'EFFECT_TIMER_CALL',
        'EFFECT_NAVIGATION_CALL',
        'EFFECT_STORAGE_CALL',
        'EFFECT_TOAST_CALL',
        'EFFECT_CLEANUP_PRESENT',
        'EFFECT_ASYNC_CALL',
        'EFFECT_PROP_READ',
        'EFFECT_CONTEXT_READ',
        'EFFECT_REF_TOUCH',
        'EFFECT_DOM_API',
      ];

      expectTypeOf(kinds).toEqualTypeOf<EffectObservationKind[]>();
    });

    it('evidence fields are properly typed', () => {
      const evidence: EffectObservationEvidence = {
        effectLine: 10,
        parentFunction: 'useMyHook',
        depArray: ['dep1', 'dep2'],
        identifier: 'setState',
        targetObject: 'window',
        method: 'addEventListener',
      };

      expectTypeOf(evidence.effectLine).toEqualTypeOf<number>();
      expectTypeOf(evidence.parentFunction).toEqualTypeOf<string | undefined>();
      expectTypeOf(evidence.depArray).toEqualTypeOf<string[] | undefined>();
      expectTypeOf(evidence.identifier).toEqualTypeOf<string | undefined>();
      expectTypeOf(evidence.targetObject).toEqualTypeOf<string | undefined>();
      expectTypeOf(evidence.method).toEqualTypeOf<string | undefined>();
    });
  });

  describe('EffectAssessment', () => {
    it('is properly typed with EffectAssessmentKind', () => {
      const assessment: EffectAssessment = {
        kind: 'DERIVED_STATE',
        subject: {
          file: 'component.tsx',
          line: 15,
          symbol: 'useEffect',
        },
        confidence: 'high',
        rationale: ['Sets state based on props'],
        basedOn: [{ kind: 'EFFECT_STATE_SETTER_CALL', file: 'component.tsx', line: 16 }],
        isCandidate: true,
        requiresManualReview: false,
      };

      expectTypeOf(assessment.kind).toMatchTypeOf<EffectAssessmentKind>();
    });

    it('accepts all EffectAssessmentKind values', () => {
      const kinds: EffectAssessmentKind[] = [
        'DERIVED_STATE',
        'EVENT_HANDLER_DISGUISED',
        'TIMER_RACE',
        'DOM_EFFECT',
        'EXTERNAL_SUBSCRIPTION',
        'NECESSARY',
      ];

      expectTypeOf(kinds).toEqualTypeOf<EffectAssessmentKind[]>();
    });
  });

  describe('ObservationResult', () => {
    it('contains filePath and observations array', () => {
      const result: ObservationResult<EffectObservation> = {
        filePath: '/path/to/file.tsx',
        observations: [
          {
            kind: 'EFFECT_LOCATION',
            file: '/path/to/file.tsx',
            line: 10,
            evidence: { effectLine: 10 },
          },
        ],
      };

      expectTypeOf(result.filePath).toEqualTypeOf<string>();
      expectTypeOf(result.observations).toEqualTypeOf<readonly EffectObservation[]>();
    });

    it('works with generic Observation', () => {
      const result: ObservationResult = {
        filePath: 'test.ts',
        observations: [{ kind: 'ANY', file: 'test.ts', line: 1, evidence: {} }],
      };

      expectTypeOf(result.observations).toEqualTypeOf<readonly Observation[]>();
    });
  });

  describe('AssessmentResult', () => {
    it('contains assessments array', () => {
      const result: AssessmentResult<EffectAssessment> = {
        assessments: [
          {
            kind: 'NECESSARY',
            subject: { file: 'test.tsx', line: 10 },
            confidence: 'high',
            rationale: ['External subscription with cleanup'],
            basedOn: [],
            isCandidate: false,
            requiresManualReview: false,
          },
        ],
      };

      expectTypeOf(result.assessments).toEqualTypeOf<readonly EffectAssessment[]>();
    });

    it('works with generic Assessment', () => {
      const result: AssessmentResult = {
        assessments: [
          {
            kind: 'ANY_KIND',
            subject: { file: 'test.ts' },
            confidence: 'medium',
            rationale: [],
            basedOn: [],
            isCandidate: false,
            requiresManualReview: true,
          },
        ],
      };

      expectTypeOf(result.assessments).toEqualTypeOf<readonly Assessment[]>();
    });
  });
});
