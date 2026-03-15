import { describe, it, expect } from 'vitest';
import { interpretRefactorIntent } from '../ast-interpret-refactor-intent';
import { computeBoundaryConfidence } from '../shared';
import { astConfig } from '../ast-config';
import type {
  AnyObservation,
  AuditContext,
  RefactorSignalPair,
  HookObservation,
  SideEffectObservation,
  DataLayerObservation,
  ComponentObservation,
} from '../types';

// ---------------------------------------------------------------------------
// Observation builders
// ---------------------------------------------------------------------------

function makeHookCall(
  file: string,
  line: number,
  hookName: string,
  extra: Partial<HookObservation['evidence']> = {},
): HookObservation {
  return {
    kind: 'HOOK_CALL',
    file,
    line,
    evidence: { hookName, ...extra },
  };
}

function makeSideEffect(
  kind: SideEffectObservation['kind'],
  file: string,
  line: number,
  extra: Partial<SideEffectObservation['evidence']> = {},
): SideEffectObservation {
  return { kind, file, line, evidence: extra };
}

function makeDataLayer(
  kind: DataLayerObservation['kind'],
  file: string,
  line: number,
  extra: Partial<DataLayerObservation['evidence']> = {},
): DataLayerObservation {
  return { kind, file, line, evidence: extra };
}

function makeComponent(file: string, line: number, componentName: string): ComponentObservation {
  return {
    kind: 'COMPONENT_DECLARATION',
    file,
    line,
    evidence: { componentName, kind: 'function' },
  };
}

/**
 * Build a RefactorSignalPair with pre-matched, unmatched, and novel signals.
 */
function buildPair(opts: {
  beforeFiles?: string[];
  afterFiles?: string[];
  beforeObs?: AnyObservation[];
  afterObs?: AnyObservation[];
  matched?: Array<{ before: AnyObservation; after: AnyObservation; similarity: number }>;
  unmatched?: AnyObservation[];
  novel?: AnyObservation[];
}): RefactorSignalPair {
  return {
    before: {
      files: opts.beforeFiles ?? ['src/before.tsx'],
      observations: opts.beforeObs ?? [],
    },
    after: {
      files: opts.afterFiles ?? ['src/after.tsx'],
      observations: opts.afterObs ?? [],
    },
    matched: opts.matched ?? [],
    unmatched: opts.unmatched ?? [],
    novel: opts.novel ?? [],
  };
}

describe('ast-interpret-refactor-intent', () => {
  describe('classification logic', () => {
    it('classifies all preserved when before and after signals are identical', () => {
      const hookA = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hookB = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const comp = makeComponent('src/comp.tsx', 5, 'MyComp');
      const compAfter = makeComponent('src/comp.tsx', 5, 'MyComp');

      const pair = buildPair({
        beforeObs: [hookA, comp],
        afterObs: [hookB, compAfter],
        matched: [
          { before: hookA, after: hookB, similarity: 1.0 },
          { before: comp, after: compAfter, similarity: 1.0 },
        ],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.score).toBe(100);
      expect(report.summary.preserved).toBe(2);
      expect(report.summary.accidentallyDropped).toBe(0);
      expect(report.summary.intentionallyRemoved).toBe(0);
      expect(report.summary.added).toBe(0);
      expect(report.summary.changed).toBe(0);
    });

    it('classifies intentional removal when audit context flags the kind and location', () => {
      const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
        object: 'toast',
        method: 'success',
      });

      const auditContext: AuditContext = {
        flaggedKinds: new Set(['TOAST_CALL']),
        flaggedLocations: [{ file: 'src/hook.ts', line: 25, kind: 'TOAST_CALL' }],
        refactorType: 'service-hook',
      };

      const pair = buildPair({
        beforeObs: [toast],
        unmatched: [toast],
      });

      const report = interpretRefactorIntent(pair, auditContext);

      expect(report.summary.intentionallyRemoved).toBe(1);
      expect(report.summary.accidentallyDropped).toBe(0);
      const signal = report.signals.find(s => s.classification === 'INTENTIONALLY_REMOVED');
      expect(signal).toBeDefined();
      expect(signal!.confidence).toBe('high');
      expect(signal!.rationale).toContain('exact location');
    });

    it('classifies accidental drop without audit context', () => {
      const posthog = makeSideEffect('POSTHOG_CALL', 'src/comp.tsx', 30, {
        object: 'posthog',
        method: 'capture',
      });

      const pair = buildPair({
        beforeObs: [posthog],
        unmatched: [posthog],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.accidentallyDropped).toBe(1);
      const signal = report.signals.find(s => s.classification === 'ACCIDENTALLY_DROPPED');
      expect(signal).toBeDefined();
      expect(signal!.confidence).toBe('high');
      expect(signal!.rationale).toContain('Not flagged by audit');
    });

    it('classifies intentional removal via refactor-type heuristic for service-hook', () => {
      const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 15, {
        object: 'toast',
        method: 'success',
      });

      const auditContext: AuditContext = {
        flaggedKinds: new Set<string>(),
        flaggedLocations: [],
        refactorType: 'service-hook',
      };

      const pair = buildPair({
        beforeObs: [toast],
        unmatched: [toast],
      });

      const report = interpretRefactorIntent(pair, auditContext);

      expect(report.summary.intentionallyRemoved).toBe(1);
      const signal = report.signals.find(s => s.classification === 'INTENTIONALLY_REMOVED');
      expect(signal).toBeDefined();
      expect(signal!.confidence).toBe('low');
      expect(signal!.rationale).toContain('service-hook');
    });

    it('computes score based on signal weights', () => {
      // Create a pair with one HOOK_CALL (weight 2.0) preserved and
      // one TOAST_CALL (weight 1.5) accidentally dropped
      const hook = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'Container' });
      const hookAfter = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'Container' });
      const toast = makeSideEffect('TOAST_CALL', 'src/comp.tsx', 20, {
        object: 'toast',
        method: 'success',
      });

      const pair = buildPair({
        beforeObs: [hook, toast],
        afterObs: [hookAfter],
        matched: [{ before: hook, after: hookAfter, similarity: 1.0 }],
        unmatched: [toast],
      });

      const report = interpretRefactorIntent(pair);

      // HOOK_CALL weight=2.0 preserved, TOAST_CALL weight=1.5 dropped
      // score = (2.0 / (2.0 + 1.5)) * 100 = 57 (rounded)
      expect(report.score).toBe(57);
      expect(report.summary.preserved).toBe(1);
      expect(report.summary.accidentallyDropped).toBe(1);
    });

    it('handles file split: signals from 1 file before matched across 2 files after', () => {
      const hook1 = makeHookCall('src/old.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hook2 = makeHookCall('src/old.tsx', 15, 'useQuery', { parentFunction: 'MyComp' });
      const hook1After = makeHookCall('src/newA.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hook2After = makeHookCall('src/newB.tsx', 15, 'useQuery', { parentFunction: 'MyComp' });

      const pair = buildPair({
        beforeFiles: ['src/old.tsx'],
        afterFiles: ['src/newA.tsx', 'src/newB.tsx'],
        beforeObs: [hook1, hook2],
        afterObs: [hook1After, hook2After],
        matched: [
          { before: hook1, after: hook1After, similarity: 0.85 },
          { before: hook2, after: hook2After, similarity: 0.85 },
        ],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.score).toBe(100);
      expect(report.summary.preserved).toBe(2);
      expect(report.summary.accidentallyDropped).toBe(0);
    });

    it('classifies CHANGED when matched signal has different evidence', () => {
      // Similarity between warn and fail thresholds -> CHANGED
      const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'Container' });
      const hookAfter = makeHookCall('src/comp.tsx', 12, 'useTeamsQuery', { parentFunction: 'Container' });

      // Similarity is 0.7 -- between fail (0.6) and warn (0.8)
      const pair = buildPair({
        beforeObs: [hookBefore],
        afterObs: [hookAfter],
        matched: [{ before: hookBefore, after: hookAfter, similarity: 0.7 }],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.changed).toBe(1);
      const signal = report.signals.find(s => s.classification === 'CHANGED');
      expect(signal).toBeDefined();
      expect(signal!.matchedTo).toEqual({
        file: 'src/comp.tsx',
        line: 12,
        kind: 'HOOK_CALL',
      });
    });

    it('classifies matched signal as ACCIDENTALLY_DROPPED when similarity is below fail threshold', () => {
      // Similarity below fail threshold (0.6) -> ACCIDENTALLY_DROPPED despite being matched
      const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'OldComp' });
      const hookAfter = makeHookCall('src/comp.tsx', 50, 'useQuery', { parentFunction: 'NewComp' });

      const pair = buildPair({
        beforeObs: [hookBefore],
        afterObs: [hookAfter],
        matched: [{ before: hookBefore, after: hookAfter, similarity: 0.45 }],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.accidentallyDropped).toBe(1);
      const signal = report.signals.find(s => s.classification === 'ACCIDENTALLY_DROPPED');
      expect(signal).toBeDefined();
      expect(signal!.rationale).toContain('below fail threshold');
    });

    it('classifies all unmatched as ACCIDENTALLY_DROPPED without audit context or refactor type', () => {
      const hook = makeHookCall('src/comp.tsx', 10, 'useState');
      const toast = makeSideEffect('TOAST_CALL', 'src/comp.tsx', 20, { object: 'toast' });
      const fetch = makeDataLayer('FETCH_API_CALL', 'src/comp.tsx', 30, { url: '/api/data' });

      const pair = buildPair({
        beforeObs: [hook, toast, fetch],
        unmatched: [hook, toast, fetch],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.accidentallyDropped).toBe(3);
      expect(report.summary.intentionallyRemoved).toBe(0);
      for (const s of report.signals) {
        expect(s.classification).toBe('ACCIDENTALLY_DROPPED');
      }
    });

    it('assigns low confidence when similarity is near boundary threshold', () => {
      // Use similarity at exactly the warn threshold (0.8) -- boundary confidence should be 'low'
      const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery');
      const hookAfter = makeHookCall('src/comp.tsx', 10, 'useQuery');

      const pair = buildPair({
        matched: [{ before: hookBefore, after: hookAfter, similarity: 0.8 }],
      });

      const report = interpretRefactorIntent(pair);

      // At exactly threshold=0.8, computeBoundaryConfidence returns 'low'
      const signal = report.signals[0];
      expect(signal.classification).toBe('PRESERVED');
      // Verify computeBoundaryConfidence behavior directly
      const conf = computeBoundaryConfidence(0.8, [
        astConfig.intentMatcher.thresholds.warn,
        astConfig.intentMatcher.thresholds.fail,
      ]);
      expect(conf).toBe('low');
      expect(signal.confidence).toBe('low');
    });
  });

  describe('scoring', () => {
    it('returns 100 for empty signal pair', () => {
      const pair = buildPair({});
      const report = interpretRefactorIntent(pair);
      expect(report.score).toBe(100);
    });

    it('excludes ADDED signals from score computation', () => {
      const hook = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hookAfter = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const novel = makeHookCall('src/comp.tsx', 20, 'useEffect', { parentFunction: 'MyComp' });

      const pair = buildPair({
        matched: [{ before: hook, after: hookAfter, similarity: 1.0 }],
        novel: [novel],
      });

      const report = interpretRefactorIntent(pair);

      // ADDED should not affect score
      expect(report.score).toBe(100);
      expect(report.summary.added).toBe(1);
      expect(report.summary.preserved).toBe(1);
    });
  });

  describe('report structure', () => {
    it('includes file metadata in report', () => {
      const pair = buildPair({
        beforeFiles: ['src/A.tsx', 'src/B.tsx'],
        afterFiles: ['src/C.tsx'],
        beforeObs: [],
        afterObs: [],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.before.files).toEqual(['src/A.tsx', 'src/B.tsx']);
      expect(report.after.files).toEqual(['src/C.tsx']);
    });
  });
});
