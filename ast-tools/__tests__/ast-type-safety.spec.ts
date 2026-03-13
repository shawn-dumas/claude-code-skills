import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeTypeSafety, analyzeTypeSafetyDirectory, extractTypeSafetyObservations } from '../ast-type-safety';
import type {
  TypeSafetyAnalysis,
  TypeSafetyViolationType,
  TypeSafetyObservation,
  TypeSafetyObservationKind,
} from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): TypeSafetyAnalysis {
  return analyzeTypeSafety(fixturePath(name));
}

function violationsOfType(analysis: TypeSafetyAnalysis, type: TypeSafetyViolationType) {
  return analysis.violations.filter(v => v.type === type);
}

function observationsOfKind(observations: TypeSafetyObservation[], kind: TypeSafetyObservationKind) {
  return observations.filter(o => o.kind === kind);
}

describe('ast-type-safety', () => {
  describe('AS_ANY', () => {
    it('detects as any with line number', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const asAny = violationsOfType(result, 'AS_ANY');

      expect(asAny.length).toBeGreaterThanOrEqual(1);
      expect(asAny[0].line).toBeGreaterThan(0);
      expect(asAny[0].text).toContain('as any');
    });
  });

  describe('AS_UNKNOWN_AS (double cast)', () => {
    it('detects as unknown as T', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const doubleCast = violationsOfType(result, 'AS_UNKNOWN_AS');

      expect(doubleCast.length).toBeGreaterThanOrEqual(1);
      expect(doubleCast[0].text).toContain('as unknown as');
      expect(doubleCast[0].context).toContain('Double cast');
    });
  });

  describe('NON_NULL_ASSERTION (unguarded)', () => {
    it('detects unguarded non-null assertion', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const nonNull = violationsOfType(result, 'NON_NULL_ASSERTION');
      const unguarded = nonNull.filter(v => v.context === 'guarded: false');

      expect(unguarded.length).toBeGreaterThanOrEqual(1);
      expect(unguarded[0].text).toContain('!');
    });
  });

  describe('NON_NULL_ASSERTION (guarded)', () => {
    it('marks non-null assertion after .has() guard as guarded: true', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const nonNull = violationsOfType(result, 'NON_NULL_ASSERTION');
      const guarded = nonNull.filter(v => v.context === 'guarded: true');

      expect(guarded.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('EXPLICIT_ANY_ANNOTATION', () => {
    it('detects function parameter typed as any', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const explicitAny = violationsOfType(result, 'EXPLICIT_ANY_ANNOTATION');

      expect(explicitAny.length).toBeGreaterThanOrEqual(1);
      const paramAny = explicitAny.find(v => v.text.includes('x: any') || v.text.includes('any'));
      expect(paramAny).toBeDefined();
    });
  });

  describe('Record<string, any>', () => {
    it('detects any in generic type arguments', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const explicitAny = violationsOfType(result, 'EXPLICIT_ANY_ANNOTATION');
      const recordAny = explicitAny.find(v => v.text.includes('any'));

      expect(recordAny).toBeDefined();
    });
  });

  describe('CATCH_ERROR_ANY', () => {
    it('detects catch (error: any)', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const catchAny = violationsOfType(result, 'CATCH_ERROR_ANY');

      expect(catchAny.length).toBeGreaterThanOrEqual(1);
      expect(catchAny[0].context).toContain('unknown');
    });
  });

  describe('TS_DIRECTIVE_NO_COMMENT', () => {
    it('detects @ts-expect-error without explanatory comment', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const directives = violationsOfType(result, 'TS_DIRECTIVE_NO_COMMENT');
      const tsExpectError = directives.find(v => v.text.includes('@ts-expect-error'));

      expect(tsExpectError).toBeDefined();
    });

    it('does NOT flag @ts-expect-error with comment', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const directives = violationsOfType(result, 'TS_DIRECTIVE_NO_COMMENT');
      const withComment = directives.filter(v => v.text.includes('-- testing type coercion'));

      expect(withComment).toHaveLength(0);
    });

    it('detects eslint-disable without comment', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const directives = violationsOfType(result, 'TS_DIRECTIVE_NO_COMMENT');
      const eslintDisable = directives.find(v => v.text.includes('eslint-disable') && !v.text.includes('--'));

      expect(eslintDisable).toBeDefined();
    });
  });

  describe('TRUST_BOUNDARY_CAST', () => {
    it('detects JSON.parse(...) as T', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const trustBoundary = violationsOfType(result, 'TRUST_BOUNDARY_CAST');

      expect(trustBoundary.length).toBeGreaterThanOrEqual(1);
      expect(trustBoundary[0].text).toContain('JSON.parse');
      expect(trustBoundary[0].context).toContain('Trust boundary');
    });
  });

  describe('as const', () => {
    it('does NOT flag as const', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const allViolations = result.violations;
      const asConstViolation = allViolations.find(v => v.text.includes('as const'));

      expect(asConstViolation).toBeUndefined();
    });
  });

  describe('satisfies', () => {
    it('does NOT flag satisfies', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const allViolations = result.violations;
      const satisfiesViolation = allViolations.find(v => v.text.includes('satisfies'));

      expect(satisfiesViolation).toBeUndefined();
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual violation counts', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      const { summary, violations } = result;

      for (const type of Object.keys(summary) as TypeSafetyViolationType[]) {
        const count = violations.filter(v => v.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected violation types', () => {
      const result = analyzeFixture('type-safety-violations.ts');
      expect(result.summary.AS_ANY).toBeGreaterThan(0);
      expect(result.summary.AS_UNKNOWN_AS).toBeGreaterThan(0);
      expect(result.summary.NON_NULL_ASSERTION).toBeGreaterThan(0);
      expect(result.summary.EXPLICIT_ANY_ANNOTATION).toBeGreaterThan(0);
      expect(result.summary.CATCH_ERROR_ANY).toBeGreaterThan(0);
      expect(result.summary.TS_DIRECTIVE_NO_COMMENT).toBeGreaterThan(0);
      expect(result.summary.TRUST_BOUNDARY_CAST).toBeGreaterThan(0);
    });
  });

  describe('real file smoke test', () => {
    it('analyzes a real project file without crashing', () => {
      const realResult = analyzeTypeSafety('src/shared/utils/typedStorage.ts');

      expect(realResult.filePath).toContain('typedStorage');
      expect(realResult.violations).toBeDefined();
      expect(realResult.summary).toBeDefined();

      // Verify all summary keys exist
      const expectedKeys: TypeSafetyViolationType[] = [
        'AS_ANY',
        'AS_UNKNOWN_AS',
        'NON_NULL_ASSERTION',
        'EXPLICIT_ANY_ANNOTATION',
        'CATCH_ERROR_ANY',
        'TS_DIRECTIVE_NO_COMMENT',
        'TRUST_BOUNDARY_CAST',
      ];
      for (const key of expectedKeys) {
        expect(realResult.summary).toHaveProperty(key);
        expect(typeof realResult.summary[key]).toBe('number');
      }
    });
  });
});

describe('analyzeTypeSafetyDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeTypeSafetyDirectory(FIXTURES_DIR);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
    }
  });
});

describe('extractTypeSafetyObservations', () => {
  describe('observation kinds', () => {
    it('extracts AS_ANY_CAST observations', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-violations.ts'));
      const asAnyCasts = observationsOfKind(observations, 'AS_ANY_CAST');

      expect(asAnyCasts.length).toBeGreaterThanOrEqual(1);
      expect(asAnyCasts[0].evidence.castTarget).toBe('any');
    });

    it('extracts AS_UNKNOWN_AS_CAST observations', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-violations.ts'));
      const doubleCasts = observationsOfKind(observations, 'AS_UNKNOWN_AS_CAST');

      expect(doubleCasts.length).toBeGreaterThanOrEqual(1);
      expect(doubleCasts[0].evidence.castTarget).toBeDefined();
      expect(doubleCasts[0].evidence.castTarget).not.toBe('unknown');
    });

    it('extracts TRUST_BOUNDARY_CAST observations with source', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-violations.ts'));
      const trustCasts = observationsOfKind(observations, 'TRUST_BOUNDARY_CAST');

      expect(trustCasts.length).toBeGreaterThanOrEqual(1);
      const jsonParseCast = trustCasts.find(o => o.evidence.trustBoundarySource === 'JSON.parse');
      expect(jsonParseCast).toBeDefined();
    });

    it('extracts TS_DIRECTIVE and ESLINT_DISABLE observations', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-violations.ts'));
      const tsDirectives = observationsOfKind(observations, 'TS_DIRECTIVE');
      const eslintDisables = observationsOfKind(observations, 'ESLINT_DISABLE');

      expect(tsDirectives.length).toBeGreaterThanOrEqual(1);
      expect(eslintDisables.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('guard detection evidence', () => {
    it('marks non-null assertion with .has() guard as hasGuard: true, guardType: has-check', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const nonNullAssertions = observationsOfKind(observations, 'NON_NULL_ASSERTION');
      const guarded = nonNullAssertions.find(o => o.evidence.hasGuard === true && o.evidence.guardType === 'has-check');

      expect(guarded).toBeDefined();
    });

    it('marks unguarded non-null assertion as hasGuard: false', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const nonNullAssertions = observationsOfKind(observations, 'NON_NULL_ASSERTION');
      const unguarded = nonNullAssertions.find(o => o.evidence.hasGuard === false);

      expect(unguarded).toBeDefined();
    });

    it('marks non-null assertion with null-check guard as hasGuard: true', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const nonNullAssertions = observationsOfKind(observations, 'NON_NULL_ASSERTION');
      const nullGuarded = nonNullAssertions.find(
        o =>
          o.evidence.hasGuard === true &&
          (o.evidence.guardType === 'null-check' || o.evidence.guardType === 'if-check'),
      );

      expect(nullGuarded).toBeDefined();
    });
  });

  describe('directive evidence', () => {
    it('marks ts-expect-error with explanation as hasExplanation: true', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const tsDirectives = observationsOfKind(observations, 'TS_DIRECTIVE');
      const withExplanation = tsDirectives.find(o => o.evidence.hasExplanation === true);

      expect(withExplanation).toBeDefined();
    });

    it('marks ts-expect-error without explanation as hasExplanation: false', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const tsDirectives = observationsOfKind(observations, 'TS_DIRECTIVE');
      const withoutExplanation = tsDirectives.find(o => o.evidence.hasExplanation === false);

      expect(withoutExplanation).toBeDefined();
    });

    it('marks eslint-disable with explanation as hasExplanation: true', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const eslintDisables = observationsOfKind(observations, 'ESLINT_DISABLE');
      const withExplanation = eslintDisables.find(o => o.evidence.hasExplanation === true);

      expect(withExplanation).toBeDefined();
    });

    it('marks eslint-disable without explanation as hasExplanation: false', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const eslintDisables = observationsOfKind(observations, 'ESLINT_DISABLE');
      const withoutExplanation = eslintDisables.find(o => o.evidence.hasExplanation === false);

      expect(withoutExplanation).toBeDefined();
    });
  });

  describe('complex type detection', () => {
    it('marks any inside conditional type as isInsideComplexType: true', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const anyAnnotations = observationsOfKind(observations, 'EXPLICIT_ANY_ANNOTATION');
      const insideComplexType = anyAnnotations.find(o => o.evidence.isInsideComplexType === true);

      expect(insideComplexType).toBeDefined();
    });
  });

  describe('trust boundary sources', () => {
    it('detects localStorage trust boundary source', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const trustCasts = observationsOfKind(observations, 'TRUST_BOUNDARY_CAST');
      const localStorageCast = trustCasts.find(o => o.evidence.trustBoundarySource === 'localStorage');

      expect(localStorageCast).toBeDefined();
    });

    it('detects sessionStorage trust boundary source', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-negative.ts'));
      const trustCasts = observationsOfKind(observations, 'TRUST_BOUNDARY_CAST');
      const sessionStorageCast = trustCasts.find(o => o.evidence.trustBoundarySource === 'sessionStorage');

      expect(sessionStorageCast).toBeDefined();
    });
  });

  describe('backward compatibility', () => {
    it('analyzeTypeSafety returns observations field', () => {
      const result = analyzeFixture('type-safety-violations.ts');

      expect(result.observations).toBeDefined();
      expect(Array.isArray(result.observations)).toBe(true);
      expect(result.observations.length).toBeGreaterThan(0);
    });
  });

  describe('astConfig usage', () => {
    it('uses config for trust boundary detection', () => {
      const observations = extractTypeSafetyObservations(fixturePath('type-safety-violations.ts'));
      const trustCasts = observationsOfKind(observations, 'TRUST_BOUNDARY_CAST');

      // JSON.parse is in astConfig.typeSafety.trustBoundaryCalls
      const jsonParseCast = trustCasts.find(o => o.evidence.trustBoundarySource === 'JSON.parse');
      expect(jsonParseCast).toBeDefined();
    });
  });
});
