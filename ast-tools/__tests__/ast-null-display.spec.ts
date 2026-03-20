import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeNullDisplay, analyzeNullDisplayDirectory, extractNullDisplayObservations } from '../ast-null-display';
import { getSourceFile, PROJECT_ROOT } from '../project';
import type { NullDisplayAnalysis, NullDisplayObservation, NullDisplayObservationKind } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): NullDisplayAnalysis {
  return analyzeNullDisplay(fixturePath(name));
}

function observationsOfKind(
  analysis: NullDisplayAnalysis,
  kind: NullDisplayObservationKind,
): NullDisplayObservation[] {
  return analysis.observations.filter(o => o.kind === kind) as NullDisplayObservation[];
}

describe('ast-null-display', () => {
  describe('positive detection (null-display-samples.tsx)', () => {
    describe('NULL_COALESCE_FALLBACK', () => {
      it('detects ?? with dash placeholder', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'NULL_COALESCE_FALLBACK');
        const dashObs = obs.find(o => o.evidence.fallbackValue === "'-'");

        expect(dashObs).toBeDefined();
        expect(dashObs!.line).toBe(8);
        expect(dashObs!.evidence.operator).toBe('??');
        expect(dashObs!.evidence.containingFunction).toBe('columnWithNullCoalesce');
      });

      it('detects ?? with N/A placeholder', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'NULL_COALESCE_FALLBACK');
        const naObs = obs.find(o => o.evidence.fallbackValue === "'N/A'");

        expect(naObs).toBeDefined();
        expect(naObs!.line).toBe(13);
        expect(naObs!.evidence.containingFunction).toBe('columnWithNA');
      });

      it('emits exactly 2 NULL_COALESCE_FALLBACK observations', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'NULL_COALESCE_FALLBACK');
        expect(obs).toHaveLength(2);
      });
    });

    describe('FALSY_COALESCE_FALLBACK', () => {
      it('detects || with dash placeholder', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'FALSY_COALESCE_FALLBACK');

        expect(obs).toHaveLength(1);
        expect(obs[0].line).toBe(18);
        expect(obs[0].evidence.operator).toBe('||');
        expect(obs[0].evidence.fallbackValue).toBe("'-'");
        expect(obs[0].evidence.containingFunction).toBe('columnWithFalsyCoalesce');
      });
    });

    describe('NO_FALLBACK_CELL', () => {
      it('detects bare getValue() in columnHelper.accessor cell', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'NO_FALLBACK_CELL');

        expect(obs).toHaveLength(1);
        expect(obs[0].evidence.isTableColumn).toBe(true);
        expect(obs[0].evidence.context).toContain('no null handling');
      });
    });

    describe('HARDCODED_PLACEHOLDER', () => {
      it('detects hardcoded dash in return statement', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'HARDCODED_PLACEHOLDER');
        const dashReturn = obs.find(o => o.evidence.containingFunction === 'columnWithHardcodedDash');

        expect(dashReturn).toBeDefined();
        expect(dashReturn!.evidence.fallbackValue).toBe("'-'");
        expect(dashReturn!.evidence.usesConstant).toBe(false);
      });

      it('detects hardcoded dash in ternary', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'HARDCODED_PLACEHOLDER');
        const ternaryDash = obs.find(o => o.evidence.containingFunction === 'metricWithDash');

        expect(ternaryDash).toBeDefined();
        expect(ternaryDash!.evidence.fallbackValue).toBe("'-'");
      });

      it('emits at least 2 HARDCODED_PLACEHOLDER observations', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'HARDCODED_PLACEHOLDER');
        expect(obs.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('EMPTY_STATE_MESSAGE', () => {
      it('detects wrong empty state message', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'EMPTY_STATE_MESSAGE');
        const wrong = obs.find(o => o.evidence.context === 'wrong empty state message');

        expect(wrong).toBeDefined();
        expect(wrong!.evidence.fallbackValue).toBe("'No data available'");
        expect(wrong!.evidence.containingFunction).toBe('tableEmptyState');
      });

      it('detects canonical empty state message', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'EMPTY_STATE_MESSAGE');
        const canonical = obs.find(o => o.evidence.context === 'canonical empty state message');

        expect(canonical).toBeDefined();
        expect(canonical!.evidence.fallbackValue).toBe("'There is no data'");
        expect(canonical!.evidence.containingFunction).toBe('tableEmptyStateCorrect');
      });

      it('emits exactly 2 EMPTY_STATE_MESSAGE observations', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'EMPTY_STATE_MESSAGE');
        expect(obs).toHaveLength(2);
      });
    });

    describe('ZERO_CONFLATION', () => {
      it('detects !value with numeric string return', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'ZERO_CONFLATION');
        const numericReturn = obs.find(o => o.evidence.containingFunction === 'formatWithZeroConflation');

        expect(numericReturn).toBeDefined();
        expect(numericReturn!.evidence.operator).toBe('!');
        expect(numericReturn!.evidence.fallbackValue).toBe("'0.00'");
      });

      it('detects truthy check with format function call', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'ZERO_CONFLATION');
        const formatCall = obs.find(o => o.evidence.containingFunction === 'cellWithZeroConflation');

        expect(formatCall).toBeDefined();
        expect(formatCall!.evidence.operator).toBe('?:');
      });

      it('emits exactly 2 ZERO_CONFLATION observations', () => {
        const result = analyzeFixture('null-display-samples.tsx');
        const obs = observationsOfKind(result, 'ZERO_CONFLATION');
        expect(obs).toHaveLength(2);
      });
    });
  });

  describe('negative detection (null-display-negative.tsx)', () => {
    it('does not emit HARDCODED_PLACEHOLDER when NO_VALUE_PLACEHOLDER is imported', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      const obs = observationsOfKind(result, 'HARDCODED_PLACEHOLDER');
      expect(obs).toHaveLength(0);
    });

    it('does not emit NULL_COALESCE_FALLBACK for ?? 0 (numeric default)', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      const obs = observationsOfKind(result, 'NULL_COALESCE_FALLBACK');
      expect(obs).toHaveLength(0);
    });

    it('does not emit FALSY_COALESCE_FALLBACK for boolean || expression', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      const obs = observationsOfKind(result, 'FALSY_COALESCE_FALLBACK');
      expect(obs).toHaveLength(0);
    });

    it('does not emit NULL_COALESCE_FALLBACK for ?? empty string (CSS)', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      const obs = observationsOfKind(result, 'NULL_COALESCE_FALLBACK');
      expect(obs).toHaveLength(0);
    });

    it('does not emit NULL_COALESCE_FALLBACK for ?? "/" (URL fallback)', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      const obs = observationsOfKind(result, 'NULL_COALESCE_FALLBACK');
      expect(obs).toHaveLength(0);
    });

    it('does not emit any observation for ?? someVariable (non-literal RHS)', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      // dynamicFallback uses ?? fallback (non-literal)
      const allObs = result.observations;
      const dynamicObs = allObs.filter(o => o.evidence.containingFunction === 'dynamicFallback');
      expect(dynamicObs).toHaveLength(0);
    });

    it('emits zero total observations for the negative fixture', () => {
      const result = analyzeFixture('null-display-negative.tsx');
      expect(result.observations).toHaveLength(0);
    });
  });

  describe('observation structure', () => {
    it('all observations have required fields', () => {
      const result = analyzeFixture('null-display-samples.tsx');
      for (const obs of result.observations) {
        expect(obs.kind).toBeDefined();
        expect(obs.file).toBeDefined();
        expect(obs.line).toBeGreaterThan(0);
        expect(obs.evidence).toBeDefined();
        expect(obs.evidence.containingFunction).toBeDefined();
      }
    });

    it('observations are sorted by line number', () => {
      const result = analyzeFixture('null-display-samples.tsx');
      for (let i = 1; i < result.observations.length; i++) {
        expect(result.observations[i].line).toBeGreaterThanOrEqual(result.observations[i - 1].line);
      }
    });
  });

  describe('directory analysis', () => {
    it('returns results for the fixtures directory', () => {
      const results = analyzeNullDisplayDirectory(FIXTURES_DIR, { filter: 'all' });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('direct extraction', () => {
    it('works from a SourceFile', () => {
      const sf = getSourceFile(fixturePath('null-display-samples.tsx'));
      const observations = extractNullDisplayObservations(sf);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations[0].kind).toBeDefined();
    });
  });

  describe('constant definition file exemption', () => {
    it('does NOT emit HARDCODED_PLACEHOLDER for the file that defines NO_VALUE_PLACEHOLDER', () => {
      const result = analyzeNullDisplay(
        path.join(PROJECT_ROOT, 'src', 'shared', 'constants', 'global.ts'),
      );
      const hardcoded = result.observations.filter(o => o.kind === 'HARDCODED_PLACEHOLDER');
      expect(hardcoded).toHaveLength(0);
    });
  });
});
