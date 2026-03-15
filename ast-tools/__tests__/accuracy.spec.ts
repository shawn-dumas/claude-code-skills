import { describe, it, expect } from 'vitest';
import { measureAccuracy, type GroundTruthFile, type AccuracyReport } from '../accuracy';
import type { Assessment } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssessment(file: string, line: number, kind: string): Assessment {
  return {
    kind,
    subject: { file, line },
    confidence: 'high',
    rationale: [`test assessment: ${kind}`],
    basedOn: [{ kind: 'TEST_OBS', file, line }],
    isCandidate: false,
    requiresManualReview: false,
  };
}

function makeGroundTruth(
  interpreter: string,
  entries: Array<{ file: string; line: number; expectedKind: string }>,
): GroundTruthFile {
  return {
    interpreter,
    lastReviewed: '2026-03-14',
    entries: entries.map(e => ({
      file: e.file,
      line: e.line,
      expectedKind: e.expectedKind,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('measureAccuracy', () => {
  describe('perfect accuracy', () => {
    it('returns 100% precision, recall, and F1 when all match', () => {
      const assessments: Assessment[] = [
        makeAssessment('a.ts', 10, 'DERIVED_STATE'),
        makeAssessment('b.ts', 20, 'TIMER_RACE'),
      ];

      const gt = makeGroundTruth('test', [
        { file: 'a.ts', line: 10, expectedKind: 'DERIVED_STATE' },
        { file: 'b.ts', line: 20, expectedKind: 'TIMER_RACE' },
      ]);

      const report = measureAccuracy(assessments, gt);

      expect(report.truePositives).toBe(2);
      expect(report.falsePositives).toBe(0);
      expect(report.falseNegatives).toBe(0);
      expect(report.precision).toBe(1);
      expect(report.recall).toBe(1);
      expect(report.f1).toBe(1);
      expect(report.biasRatio).toBe(1);
    });
  });

  describe('partial accuracy', () => {
    it('computes correct metrics for partial matches', () => {
      const assessments: Assessment[] = [
        makeAssessment('a.ts', 10, 'DERIVED_STATE'),
        makeAssessment('c.ts', 30, 'DOM_EFFECT'), // FP: not in ground truth
      ];

      const gt = makeGroundTruth('test', [
        { file: 'a.ts', line: 10, expectedKind: 'DERIVED_STATE' },
        { file: 'b.ts', line: 20, expectedKind: 'TIMER_RACE' }, // FN: not in assessments
      ]);

      const report = measureAccuracy(assessments, gt);

      expect(report.truePositives).toBe(1);
      expect(report.falsePositives).toBe(1);
      expect(report.falseNegatives).toBe(1);
      expect(report.precision).toBe(0.5);
      expect(report.recall).toBe(0.5);
      expect(report.biasRatio).toBe(1);
    });

    it('handles wrong kind at correct location', () => {
      const assessments: Assessment[] = [
        makeAssessment('a.ts', 10, 'DOM_EFFECT'), // wrong kind
      ];

      const gt = makeGroundTruth('test', [{ file: 'a.ts', line: 10, expectedKind: 'DERIVED_STATE' }]);

      const report = measureAccuracy(assessments, gt);

      expect(report.truePositives).toBe(0);
      expect(report.falsePositives).toBe(1);
      expect(report.falseNegatives).toBe(1);
      expect(report.precision).toBe(0);
      expect(report.recall).toBe(0);
      expect(report.f1).toBe(0);
    });
  });

  describe('zero matches', () => {
    it('returns zeros when no assessments are provided', () => {
      const gt = makeGroundTruth('test', [
        { file: 'a.ts', line: 10, expectedKind: 'DERIVED_STATE' },
        { file: 'b.ts', line: 20, expectedKind: 'TIMER_RACE' },
      ]);

      const report = measureAccuracy([], gt);

      expect(report.truePositives).toBe(0);
      expect(report.falsePositives).toBe(0);
      expect(report.falseNegatives).toBe(2);
      expect(report.precision).toBe(0);
      expect(report.recall).toBe(0);
      expect(report.f1).toBe(0);
      expect(report.biasRatio).toBe(0);
    });

    it('returns zeros when ground truth is empty', () => {
      const assessments: Assessment[] = [makeAssessment('a.ts', 10, 'DERIVED_STATE')];

      const gt = makeGroundTruth('test', []);

      const report = measureAccuracy(assessments, gt);

      expect(report.truePositives).toBe(0);
      expect(report.falsePositives).toBe(1);
      expect(report.falseNegatives).toBe(0);
      expect(report.recall).toBe(0);
      expect(report.biasRatio).toBe(0);
    });

    it('handles both empty', () => {
      const gt = makeGroundTruth('test', []);
      const report = measureAccuracy([], gt);

      expect(report.truePositives).toBe(0);
      expect(report.falsePositives).toBe(0);
      expect(report.falseNegatives).toBe(0);
      expect(report.f1).toBe(0);
    });
  });

  describe('per-kind breakdown', () => {
    it('computes per-kind accuracy correctly', () => {
      const assessments: Assessment[] = [
        makeAssessment('a.ts', 10, 'DERIVED_STATE'),
        makeAssessment('b.ts', 20, 'DERIVED_STATE'),
        makeAssessment('c.ts', 30, 'TIMER_RACE'),
        makeAssessment('d.ts', 40, 'DOM_EFFECT'), // FP
      ];

      const gt = makeGroundTruth('test', [
        { file: 'a.ts', line: 10, expectedKind: 'DERIVED_STATE' },
        { file: 'b.ts', line: 20, expectedKind: 'DERIVED_STATE' },
        { file: 'c.ts', line: 30, expectedKind: 'TIMER_RACE' },
        { file: 'e.ts', line: 50, expectedKind: 'TIMER_RACE' }, // FN
      ]);

      const report = measureAccuracy(assessments, gt);

      expect(report.perKind.length).toBeGreaterThan(0);

      const derivedState = report.perKind.find(k => k.kind === 'DERIVED_STATE');
      expect(derivedState).toBeDefined();
      expect(derivedState!.truePositives).toBe(2);
      expect(derivedState!.falsePositives).toBe(0);
      expect(derivedState!.falseNegatives).toBe(0);
      expect(derivedState!.precision).toBe(1);
      expect(derivedState!.recall).toBe(1);

      const timerRace = report.perKind.find(k => k.kind === 'TIMER_RACE');
      expect(timerRace).toBeDefined();
      expect(timerRace!.truePositives).toBe(1);
      expect(timerRace!.falseNegatives).toBe(1);
      expect(timerRace!.recall).toBe(0.5);

      const domEffect = report.perKind.find(k => k.kind === 'DOM_EFFECT');
      expect(domEffect).toBeDefined();
      expect(domEffect!.falsePositives).toBe(1);
      expect(domEffect!.precision).toBe(0);
    });

    it('sorts per-kind by F1 ascending', () => {
      const assessments: Assessment[] = [
        makeAssessment('a.ts', 10, 'GOOD_KIND'),
        makeAssessment('b.ts', 20, 'BAD_KIND'),
      ];

      const gt = makeGroundTruth('test', [
        { file: 'a.ts', line: 10, expectedKind: 'GOOD_KIND' },
        { file: 'c.ts', line: 30, expectedKind: 'BAD_KIND' }, // different line -> FN
      ]);

      const report = measureAccuracy(assessments, gt);

      // BAD_KIND: TP=0 (line mismatch), FP=1, FN=1 -> F1=0
      // GOOD_KIND: TP=1, FP=0, FN=0 -> F1=1
      expect(report.perKind[0].f1).toBeLessThanOrEqual(report.perKind[report.perKind.length - 1].f1);
    });
  });

  describe('report structure', () => {
    it('includes interpreter name from ground truth', () => {
      const gt = makeGroundTruth('ast-interpret-effects', []);
      const report = measureAccuracy([], gt);
      expect(report.interpreter).toBe('ast-interpret-effects');
    });

    it('computes bias ratio correctly', () => {
      const assessments: Assessment[] = [
        makeAssessment('a.ts', 10, 'A'),
        makeAssessment('b.ts', 20, 'B'),
        makeAssessment('c.ts', 30, 'C'),
      ];

      const gt = makeGroundTruth('test', [{ file: 'a.ts', line: 10, expectedKind: 'A' }]);

      const report = measureAccuracy(assessments, gt);
      expect(report.biasRatio).toBe(3);
    });
  });
});
