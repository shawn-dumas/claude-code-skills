import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeTypeSafety } from '../ast-type-safety';
import type { TypeSafetyAnalysis, TypeSafetyViolationType } from '../types';

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

describe('ast-type-safety', () => {
  const result = analyzeFixture('type-safety-violations.ts');

  describe('AS_ANY', () => {
    it('detects as any with line number', () => {
      const asAny = violationsOfType(result, 'AS_ANY');

      expect(asAny.length).toBeGreaterThanOrEqual(1);
      expect(asAny[0].line).toBeGreaterThan(0);
      expect(asAny[0].text).toContain('as any');
    });
  });

  describe('AS_UNKNOWN_AS (double cast)', () => {
    it('detects as unknown as T', () => {
      const doubleCast = violationsOfType(result, 'AS_UNKNOWN_AS');

      expect(doubleCast.length).toBeGreaterThanOrEqual(1);
      expect(doubleCast[0].text).toContain('as unknown as');
      expect(doubleCast[0].context).toContain('Double cast');
    });
  });

  describe('NON_NULL_ASSERTION (unguarded)', () => {
    it('detects unguarded non-null assertion', () => {
      const nonNull = violationsOfType(result, 'NON_NULL_ASSERTION');
      const unguarded = nonNull.filter(v => v.context === 'guarded: false');

      expect(unguarded.length).toBeGreaterThanOrEqual(1);
      expect(unguarded[0].text).toContain('!');
    });
  });

  describe('NON_NULL_ASSERTION (guarded)', () => {
    it('marks non-null assertion after .has() guard as guarded: true', () => {
      const nonNull = violationsOfType(result, 'NON_NULL_ASSERTION');
      const guarded = nonNull.filter(v => v.context === 'guarded: true');

      expect(guarded.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('EXPLICIT_ANY_ANNOTATION', () => {
    it('detects function parameter typed as any', () => {
      const explicitAny = violationsOfType(result, 'EXPLICIT_ANY_ANNOTATION');

      expect(explicitAny.length).toBeGreaterThanOrEqual(1);
      const paramAny = explicitAny.find(v => v.text.includes('x: any') || v.text.includes('any'));
      expect(paramAny).toBeDefined();
    });
  });

  describe('Record<string, any>', () => {
    it('detects any in generic type arguments', () => {
      const explicitAny = violationsOfType(result, 'EXPLICIT_ANY_ANNOTATION');
      const recordAny = explicitAny.find(v => v.text.includes('any'));

      expect(recordAny).toBeDefined();
    });
  });

  describe('CATCH_ERROR_ANY', () => {
    it('detects catch (error: any)', () => {
      const catchAny = violationsOfType(result, 'CATCH_ERROR_ANY');

      expect(catchAny.length).toBeGreaterThanOrEqual(1);
      expect(catchAny[0].context).toContain('unknown');
    });
  });

  describe('TS_DIRECTIVE_NO_COMMENT', () => {
    it('detects @ts-expect-error without explanatory comment', () => {
      const directives = violationsOfType(result, 'TS_DIRECTIVE_NO_COMMENT');
      const tsExpectError = directives.find(v => v.text.includes('@ts-expect-error'));

      expect(tsExpectError).toBeDefined();
    });

    it('does NOT flag @ts-expect-error with comment', () => {
      const directives = violationsOfType(result, 'TS_DIRECTIVE_NO_COMMENT');
      const withComment = directives.filter(v => v.text.includes('-- testing type coercion'));

      expect(withComment).toHaveLength(0);
    });

    it('detects eslint-disable without comment', () => {
      const directives = violationsOfType(result, 'TS_DIRECTIVE_NO_COMMENT');
      const eslintDisable = directives.find(v => v.text.includes('eslint-disable') && !v.text.includes('--'));

      expect(eslintDisable).toBeDefined();
    });
  });

  describe('TRUST_BOUNDARY_CAST', () => {
    it('detects JSON.parse(...) as T', () => {
      const trustBoundary = violationsOfType(result, 'TRUST_BOUNDARY_CAST');

      expect(trustBoundary.length).toBeGreaterThanOrEqual(1);
      expect(trustBoundary[0].text).toContain('JSON.parse');
      expect(trustBoundary[0].context).toContain('Trust boundary');
    });
  });

  describe('as const', () => {
    it('does NOT flag as const', () => {
      const allViolations = result.violations;
      const asConstViolation = allViolations.find(v => v.text.includes('as const'));

      expect(asConstViolation).toBeUndefined();
    });
  });

  describe('satisfies', () => {
    it('does NOT flag satisfies', () => {
      const allViolations = result.violations;
      const satisfiesViolation = allViolations.find(v => v.text.includes('satisfies'));

      expect(satisfiesViolation).toBeUndefined();
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual violation counts', () => {
      const { summary, violations } = result;

      for (const type of Object.keys(summary) as TypeSafetyViolationType[]) {
        const count = violations.filter(v => v.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected violation types', () => {
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
