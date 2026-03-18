import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeAuthZ } from '../ast-authz-audit';
import type { AuthZAnalysis } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): AuthZAnalysis {
  return analyzeAuthZ(fixturePath(name));
}

describe('ast-authz-audit', () => {
  describe('positive fixture (should flag)', () => {
    it('produces 9 observations from authz-positive.tsx', () => {
      const result = analyzeFixture('authz-positive.tsx');
      expect(result.observations).toHaveLength(9);
    });

    it('detects includes method', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const includesObs = result.observations.filter(o => o.evidence.method === 'includes');
      expect(includesObs.length).toBeGreaterThanOrEqual(2);
    });

    it('detects indexOf method', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const indexOfObs = result.observations.filter(o => o.evidence.method === 'indexOf');
      expect(indexOfObs).toHaveLength(1);
    });

    it('detects some method', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const someObs = result.observations.filter(o => o.evidence.method === 'some');
      expect(someObs).toHaveLength(2);
    });

    it('extracts correct roleMember values', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const members = result.observations.map(o => o.evidence.roleMember);
      expect(members).toContain('ADMIN');
      expect(members).toContain('TEAM_OWNER');
      expect(members).toContain('MEMBER');
      expect(members).toContain('SUPER_ADMIN');
      expect(members).toContain('INTERNAL_ADMIN');
    });

    it('populates containingFunction', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const functions = result.observations.map(o => o.evidence.containingFunction).filter(Boolean);
      expect(functions).toContain('CorePatterns');
      expect(functions).toContain('EdgeCases');
      expect(functions).toContain('EqualityPatterns');
    });

    it('includes expression text', () => {
      const result = analyzeFixture('authz-positive.tsx');
      for (const obs of result.observations) {
        expect(obs.evidence.expression).toBeTruthy();
        expect(obs.evidence.expression.length).toBeLessThanOrEqual(80);
      }
    });

    it('detects destructured variable pattern', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const superAdminObs = result.observations.find(o => o.evidence.roleMember === 'SUPER_ADMIN');
      expect(superAdminObs).toBeDefined();
    });

    it('detects inline JSX expression', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const internalObs = result.observations.find(o => o.evidence.roleMember === 'INTERNAL_ADMIN');
      expect(internalObs).toBeDefined();
    });
  });

  describe('RAW_ROLE_EQUALITY observations', () => {
    it('produces 3 equality observations from authz-positive.tsx', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const equalityObs = result.observations.filter(o => o.kind === 'RAW_ROLE_EQUALITY');
      expect(equalityObs).toHaveLength(3);
    });

    it('detects === operator', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const strictEq = result.observations.filter(o => o.kind === 'RAW_ROLE_EQUALITY' && o.evidence.method === '===');
      expect(strictEq).toHaveLength(2);
    });

    it('detects !== operator', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const notEq = result.observations.filter(o => o.kind === 'RAW_ROLE_EQUALITY' && o.evidence.method === '!==');
      expect(notEq).toHaveLength(1);
    });

    it('extracts correct roleMember for equality checks', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const equalityObs = result.observations.filter(o => o.kind === 'RAW_ROLE_EQUALITY');
      const members = equalityObs.map(o => o.evidence.roleMember);
      expect(members).toContain('ADMIN');
      expect(members).toContain('SUPER_ADMIN');
      expect(members).toContain('INTERNAL_ADMIN');
    });

    it('populates containingFunction for equality checks', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const equalityObs = result.observations.filter(o => o.kind === 'RAW_ROLE_EQUALITY');
      for (const obs of equalityObs) {
        expect(obs.evidence.containingFunction).toBe('EqualityPatterns');
      }
    });
  });

  describe('negative fixture (should not flag)', () => {
    it('produces 0 observations from authz-negative.tsx', () => {
      const result = analyzeFixture('authz-negative.tsx');
      expect(result.observations).toHaveLength(0);
    });
  });

  describe('canonical file exclusion', () => {
    it('produces 0 observations for roleChecks.ts', () => {
      const result = analyzeAuthZ(path.join(process.cwd(), 'src/shared/utils/user/roleChecks.ts'));
      expect(result.observations).toHaveLength(0);
    });

    it('produces 0 observations for RequireRoles.tsx', () => {
      const result = analyzeAuthZ(path.join(process.cwd(), 'src/ui/components/8flow/RequireRoles.tsx'));
      expect(result.observations).toHaveLength(0);
    });
  });

  describe('real-world smoke test', () => {
    it('InsightsFiltersContainer has 0 violations (fixed in P03)', () => {
      const result = analyzeAuthZ(
        path.join(process.cwd(), 'src/ui/page_blocks/dashboard/ui/InsightsFilters/InsightsFiltersContainer.tsx'),
      );
      expect(result.observations).toHaveLength(0);
    });

    it('OpportunitiesFiltersContainer has 0 violations (fixed in P03)', () => {
      const result = analyzeAuthZ(
        path.join(
          process.cwd(),
          'src/ui/page_blocks/dashboard/opportunities/OpportunityFilters/OpportunitiesFiltersContainer.tsx',
        ),
      );
      expect(result.observations).toHaveLength(0);
    });
  });

  describe('output modes', () => {
    it('all observations have a valid authz kind', () => {
      const result = analyzeFixture('authz-positive.tsx');
      const validKinds = new Set(['RAW_ROLE_CHECK', 'RAW_ROLE_EQUALITY']);
      for (const obs of result.observations) {
        expect(validKinds.has(obs.kind)).toBe(true);
      }
    });
  });
});
