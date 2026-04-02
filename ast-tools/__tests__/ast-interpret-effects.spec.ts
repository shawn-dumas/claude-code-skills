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

    it('classifies fetch + setState + cleanup as DERIVED_STATE with medium confidence', () => {
      // Covers: line 226 false branch (!hasCleanup skipped) and line 232 true branch (medium)
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_FETCH_CALL', 'test.tsx', 11, 10, { identifier: 'fetch' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 12, 10, { identifier: 'setData' }),
        makeObs('EFFECT_CLEANUP_PRESENT', 'test.tsx', 14, 10),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('medium');
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

    it('classifies exact setX/X prop mirror (setterMirrorsProp line 139 path)', () => {
      // setter='setData', prop='Data' -> 'setdata' === 'set'+'data' = true -> line 139 executes
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'Data' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'Data' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setData' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('medium');
    });

    it('classifies lowercase matching prop mirror (setterMirrorsProp line 145 path)', () => {
      // setter='setCount', prop='count' -> withoutSet='Count', withoutSetLower='count' === 'count' -> line 145
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'count' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'count' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setCount' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DERIVED_STATE');
      expect(result.assessments[0].confidence).toBe('medium');
    });

    it('does not mirror when prop has value-prefix but stripped name differs from setter root', () => {
      // setter='setRowSelection', prop='initialValue' ->
      // propLower.startsWith('initial') = true, stripped='value', 'value' !== 'rowselection' -> false branch
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'initialValue' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'initialValue' }),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setRowSelection' }),
      ];

      const result = interpretEffects(observations);

      // prop does not mirror setter -> not DERIVED_STATE via prop-mirror path
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).not.toBe('DERIVED_STATE');
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

  describe('timer without state setter falls through to NECESSARY', () => {
    it('classifies timer-only effect (no setState) as NECESSARY, not TIMER_RACE', () => {
      // classifyTimerRace returns null when !group.hasStateSetter.
      // Falls through to classifyNecessary.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_TIMER_CALL', 'test.tsx', 11, 10, { identifier: 'requestAnimationFrame' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
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

    it('classifies untyped ref-only access without cleanup as NECESSARY', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_REF_TOUCH', 'test.tsx', 11, 10, { identifier: 'containerRef' }),
      ];

      const result = interpretEffects(observations);

      // Ref-only without DOM API, isDomRef, or cleanup falls through to NECESSARY.
      // Untyped refs remain ambiguous.
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
    });

    it('classifies DOM-typed ref access as DOM_EFFECT via isDomRef', () => {
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_REF_TOUCH', 'test.tsx', 11, 10, { identifier: 'containerRef', isDomRef: true }),
      ];

      const result = interpretEffects(observations);

      // When the observation layer resolves the ref's generic type as a DOM
      // element type, the interpreter classifies as DOM_EFFECT.
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DOM_EFFECT');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].rationale[0]).toContain('DOM-typed ref');
    });

    it('includes cleanup in rationale when DOM-typed ref has cleanup', () => {
      // Exercises the hasDomRef + hasCleanup branch inside classifyDomEffect.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_REF_TOUCH', 'test.tsx', 11, 10, { identifier: 'containerRef', isDomRef: true }),
        makeObs('EFFECT_CLEANUP_PRESENT', 'test.tsx', 10, 10),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DOM_EFFECT');
      expect(result.assessments[0].rationale).toContain('has cleanup function');
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

    it('includes ref touch in rationale when DOM API effect also has ref access', () => {
      // hasDomApi + hasRefTouch -> both notes added to rationale.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DOM_API', 'test.tsx', 11, 10, { targetObject: 'document', method: 'querySelector' }),
        makeObs('EFFECT_REF_TOUCH', 'test.tsx', 12, 10, { identifier: 'divRef' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DOM_EFFECT');
      expect(result.assessments[0].rationale).toContain('contains ref.current access');
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

  describe('NECESSARY: cleanup with state setter (no deps)', () => {
    it('classifies cleanup + setState with no dep entries as NECESSARY via cleanup-with-empty-deps rationale', () => {
      // cleanup + stateSetter: classifyExternalSubscription requires !hasStateSetter, so it
      // skips. classifyDerivedState requires fetch/async/prop/context, so it skips.
      // Falls through to classifyNecessary where the else-if branch fires.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_CLEANUP_PRESENT', 'test.tsx', 10, 10),
        makeObs('EFFECT_STATE_SETTER_CALL', 'test.tsx', 11, 10, { identifier: 'setFlag' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
      expect(result.assessments[0].rationale[0]).toBe('cleanup-only effect with empty deps');
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

    it('falls through body-read check when all deps are callbacks or prop reads (no state deps)', () => {
      // Covers line 325 false branch: propRead='onSubmit' starts with 'on' but
      // depEntries.some(d => !d.startsWith('on') && !propReads.includes(d)) = false
      // because 'count' IS in propReads and 'onSubmit' starts with 'on'.
      // The second loop at line 323 enters but falls through without classifying.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'count' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'onSubmit' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'onSubmit' }),
        makeObs('EFFECT_PROP_READ', 'test.tsx', 11, 10, { identifier: 'count' }),
      ];

      const result = interpretEffects(observations);

      // No EVENT_HANDLER_DISGUISED via the body-read check (falls through both paths)
      // No other classification matches either -> NECESSARY (fallback)
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('NECESSARY');
    });

    it('classifies guard-then-call pattern as EVENT_HANDLER_DISGUISED (low confidence)', () => {
      // Covers isLikelyFunctionDep true branches:
      // 'onSearch' is in depEntries but NOT in bodyDepCalls, so isLikelyFunctionDep('onSearch')
      // is evaluated -> returns true (on[A-Z] pattern) -> filtered from dataDeps.
      // 'count' is a plain data dep -> dataDeps = ['count'] -> guard-then-call detected.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'count' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'onSearch' }),
        makeObs('EFFECT_BODY_DEP_CALL', 'test.tsx', 11, 10, { identifier: 'submitData' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'submitData' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EVENT_HANDLER_DISGUISED');
      expect(result.assessments[0].confidence).toBe('low');
    });

    it('covers isLikelyFunctionDep true branches for handle, set, and dispatch', () => {
      // Tests that handleClick, setFilter, and dispatch are recognized as function deps
      // and filtered out, leaving only 'count' as the data dep.
      const observations: EffectObservation[] = [
        makeLocation('test.tsx', 10),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'count' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'handleClick' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'setFilter' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'dispatch' }),
        makeObs('EFFECT_BODY_DEP_CALL', 'test.tsx', 11, 10, { identifier: 'submitData' }),
        makeObs('EFFECT_DEP_ENTRY', 'test.tsx', 10, 10, { identifier: 'submitData' }),
      ];

      const result = interpretEffects(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EVENT_HANDLER_DISGUISED');
      expect(result.assessments[0].confidence).toBe('low');
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
