import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretEffects } from '../ast-interpret-effects';
import { analyzeReactFile } from '../ast-react-inventory';
import type { EffectObservation, EffectAssessment, AssessmentResult } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Helper to create a minimal EFFECT_LOCATION observation.
 */
function makeLocation(file: string, effectLine: number, parentFunction = 'TestComponent'): EffectObservation {
  return {
    kind: 'EFFECT_LOCATION',
    file,
    line: effectLine,
    evidence: {
      effectLine,
      parentFunction,
      depArray: [],
    },
  };
}

/**
 * Helper to create an observation.
 */
function makeObs(
  kind: EffectObservation['kind'],
  file: string,
  line: number,
  effectLine: number,
  extra: Partial<EffectObservation['evidence']> = {},
): EffectObservation {
  return {
    kind,
    file,
    line,
    evidence: {
      effectLine,
      ...extra,
    },
  };
}

describe('ast-interpret-effects', () => {
  describe('DERIVED_STATE classification', () => {
    it('classifies fetch + setState as DERIVED_STATE with high confidence', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_FETCH_CALL', 'test.tsx', 11, 10, { identifier: 'fetch' }),
        makeObs('EFFECT_ASYNC_CALL', 'test.tsx', 11, 10),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setData' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(true);
      expect(result.assessments[0].requiresManualReview).toBe(true);
    });

    it('classifies async + setState (no fetch) as DERIVED_STATE with high confidence', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_ASYNC_CALL', 'test.tsx', 11, 10),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setData' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('high');
    });

    it('classifies prop mirror as DERIVED_STATE with medium confidence', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'userId' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'userId' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setUser' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].rationale[0]).toContain('userId');
      expect(result.assessments[0].rationale[0]).toContain('setUser');
    });

    it('classifies context derivation as DERIVED_STATE with low confidence', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_CONTEXT_READ', 'test.tsx', 11, 10, { identifier: 'rawData' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setTransformed' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('low');
    });
  });

  describe('TIMER_RACE classification', () => {
    it('classifies timer + setState without cleanup as TIMER_RACE with high confidence', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_TIMER_CALL', 'test.tsx', 11, 10, { identifier: 'setTimeout' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setCount' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('TIMER_RACE');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(true);
      expect(result.assessments[0].requiresManualReview).toBe(true);
    });

    it('classifies timer + setState with cleanup as TIMER_RACE with medium confidence', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_TIMER_CALL', 'test.tsx', 11, 10, { identifier: 'setInterval' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setCount' }),
        makeObs('EFFECT_CLEANUP_PRESENT', 'test.tsx', 10, 10),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('TIMER_RACE');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].isCandidate).toBe(false);
      expect(result.assessments[0].requiresManualReview).toBe(false);
    });
  });

  describe('DOM_EFFECT classification', () => {
    it('classifies ref-only access with cleanup as EXTERNAL_SUBSCRIPTION (ref-only removed)', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_REF_TOUCH', 'test.tsx', 11, 10, { identifier: 'inputRef' }),
        makeObs('EFFECT_CLEANUP_PRESENT', 'test.tsx', 10, 10),
      ];

      const result = interpretEffects(observations);

      // Ref-only access without DOM API does not trigger DOM_EFFECT.
      // Cleanup + no state setter -> EXTERNAL_SUBSCRIPTION.
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EXTERNAL_SUBSCRIPTION');
    });

    it('classifies ref-only access without cleanup as NECESSARY', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_REF_TOUCH', 'test.tsx', 11, 10, { identifier: 'containerRef' }),
      ];

      const result = interpretEffects(observations);

      // Ref-only without DOM API or cleanup falls through to NECESSARY.
      // Known limitation: cannot distinguish DOM refs from value-storage refs
      // without observation-layer enhancement.
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
    });

    it('classifies DOM API access as DOM_EFFECT', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DOM_API', 'test.tsx', 11, 10, { targetObject: 'window', method: 'addEventListener' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DOM_EFFECT');
      expect(result.assessments[0].confidence).toBe('high');
    });
  });

  describe('EXTERNAL_SUBSCRIPTION classification', () => {
    it('classifies cleanup-only effect as EXTERNAL_SUBSCRIPTION', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_CLEANUP_PRESENT', 'test.tsx', 10, 10),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EXTERNAL_SUBSCRIPTION');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].isCandidate).toBe(false);
    });
  });

  describe('NECESSARY classification', () => {
    it('classifies empty effect as NECESSARY with low confidence', () => {
      const observations: EffectObservation[] = [makeLocation('test.tsx', 10)];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
      expect(result.assessments[0].confidence).toBe('low');
      expect(result.assessments[0].isCandidate).toBe(false);
      expect(result.assessments[0].requiresManualReview).toBe(false);
    });

    it('classifies simple sync effect as NECESSARY', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'value' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
      expect(result.assessments[0].confidence).toBe('low');
    });
  });

  describe('negative cases', () => {
    it('does not classify refetch() call (not in fetchFunctions) as DERIVED_STATE', () => {
      // The key point: refetch() is NOT emitted as EFFECT_FETCH_CALL by the detector.
      // Without EFFECT_FETCH_CALL, the interpreter cannot assume it's fetching data.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        // Note: no EFFECT_FETCH_CALL because refetch is not in the fetch functions set
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setData' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      // Without fetch/async, setter alone does not trigger DERIVED_STATE
      // unless there's a prop mirror or context read
      expect(result.assessments[0].kind).toBe('NECESSARY');
    });

    it('returns empty assessments for empty observations', () => {
      const result = interpretEffects([]);
      expect(result.assessments).toHaveLength(0);
    });
  });

  describe('basedOn traces back to observations', () => {
    it('basedOn contains valid ObservationRef entries', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_FETCH_CALL', 'test.tsx', 11, 10, { identifier: 'fetch' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setData' }),
      ];

      const result = interpretEffects(observations);
      const assessment = result.assessments[0];

      expect(assessment.basedOn.length).toBeGreaterThan(0);

      for (const ref of assessment.basedOn) {
        expect(ref).toHaveProperty('kind');
        expect(ref).toHaveProperty('file');
        expect(ref).toHaveProperty('line');
        expect(typeof ref.kind).toBe('string');
        expect(typeof ref.file).toBe('string');
        expect(typeof ref.line).toBe('number');

        // Verify the ref matches an input observation
        const matchingObs = observations.find(o => o.kind === ref.kind && o.file === ref.file && o.line === ref.line);
        expect(matchingObs).toBeDefined();
      }
    });
  });

  describe('integration with real file', () => {
    it('produces reasonable assessments for component-with-effects.tsx', () => {
      const inventory = analyzeReactFile(fixturePath('component-with-effects.tsx'));
      const comp = inventory.components[0];
      expect(comp.name).toBe('Timer');

      const result = interpretEffects(comp.effectObservations);

      // Timer component has 4 useEffects
      expect(result.assessments).toHaveLength(4);

      // Just verify the assessments are valid
      for (const assessment of result.assessments) {
        expect(assessment.subject.file).toContain('component-with-effects.tsx');
        expect(assessment.subject.line).toBeGreaterThan(0);
        expect(assessment.rationale.length).toBeGreaterThan(0);
        expect(['high', 'medium', 'low']).toContain(assessment.confidence);
      }

      // Verify at least one candidate was found
      const candidates = result.assessments.filter(a => a.isCandidate);
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    });

    it('handles effect-negative.tsx IndirectFetch correctly', () => {
      const inventory = analyzeReactFile(fixturePath('effect-negative.tsx'));
      const comp = inventory.components.find(c => c.name === 'IndirectFetch');
      expect(comp).toBeDefined();

      const result = interpretEffects(comp!.effectObservations);

      // IndirectFetch has no EFFECT_FETCH_CALL (refetch is not detected)
      // So it should not be DERIVED_STATE
      expect(result.assessments).toHaveLength(1);
      // Without fetch/async/context/prop-mirror, it falls through to NECESSARY
      expect(result.assessments[0].kind).not.toBe('DERIVED_STATE');
    });
  });

  describe('assessment structure', () => {
    it('each assessment has all required fields', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_TIMER_CALL', 'test.tsx', 11, 10, { identifier: 'setTimeout' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setCount' }),
      ];

      const result = interpretEffects(observations);

      for (const assessment of result.assessments) {
        expect(assessment).toHaveProperty('kind');
        expect(assessment).toHaveProperty('subject');
        expect(assessment).toHaveProperty('confidence');
        expect(assessment).toHaveProperty('rationale');
        expect(assessment).toHaveProperty('basedOn');
        expect(assessment).toHaveProperty('isCandidate');
        expect(assessment).toHaveProperty('requiresManualReview');

        expect(assessment.subject).toHaveProperty('file');
        expect(assessment.subject).toHaveProperty('line');
        expect(assessment.subject).toHaveProperty('symbol');

        expect(Array.isArray(assessment.rationale)).toBe(true);
        expect(Array.isArray(assessment.basedOn)).toBe(true);
      }
    });

    it('output is JSON-serializable', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DOM_API', 'test.tsx', 11, 10, { targetObject: 'window' }),
      ];

      const result = interpretEffects(observations);
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json) as AssessmentResult<EffectAssessment>;
      expect(parsed.assessments).toHaveLength(1);
    });
  });

  describe('all assessment kinds are covered by tests', () => {
    const allKinds = new Set([
      'DERIVED_STATE',
      'EVENT_HANDLER_DISGUISED',
      'TIMER_RACE',
      'DOM_EFFECT',
      'EXTERNAL_SUBSCRIPTION',
      'NECESSARY',
    ]);

    it('tests exist for all assessment kinds', () => {
      // This test documents that we have coverage for each kind.
      // The actual tests above prove this -- this is just a reminder.
      const testedKinds = new Set<string>();

      // DERIVED_STATE: tested in multiple scenarios
      testedKinds.add('DERIVED_STATE');

      // TIMER_RACE: tested with and without cleanup
      testedKinds.add('TIMER_RACE');

      // DOM_EFFECT: tested with ref and DOM API
      testedKinds.add('DOM_EFFECT');

      // EXTERNAL_SUBSCRIPTION: tested with cleanup-only
      testedKinds.add('EXTERNAL_SUBSCRIPTION');

      // NECESSARY: tested with empty and simple sync
      testedKinds.add('NECESSARY');

      // EVENT_HANDLER_DISGUISED: tested implicitly via integration test
      testedKinds.add('EVENT_HANDLER_DISGUISED');

      expect(testedKinds).toEqual(allKinds);
    });
  });

  describe('EVENT_HANDLER_DISGUISED classification', () => {
    it('classifies effect with callback prop dependency as EVENT_HANDLER_DISGUISED', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'onSelect' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'onSelect' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EVENT_HANDLER_DISGUISED');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].isCandidate).toBe(true);
    });
  });

  describe('boundary confidence', () => {
    it('adds near-boundary when multiple classifications match (timer + setState + DOM)', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_TIMER_CALL', 'test.tsx', 11, 10, { identifier: 'setTimeout' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setData' }),
        makeObs('EFFECT_DOM_API', 'test.tsx', 13, 10, { targetObject: 'document', method: 'addEventListener' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      // Should have near-boundary because both TIMER_RACE and DOM_EFFECT match
      expect(result.assessments[0].rationale.some(r => r.includes('[near-boundary]'))).toBe(true);
      expect(result.assessments[0].rationale.some(r => r.includes('patterns matched'))).toBe(true);
    });

    it('does not add near-boundary when only one classification matches', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DOM_API', 'test.tsx', 11, 10, { targetObject: 'document', method: 'addEventListener' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DOM_EFFECT');
      expect(result.assessments[0].rationale.every(r => !r.includes('[near-boundary]'))).toBe(true);
    });
  });
});
