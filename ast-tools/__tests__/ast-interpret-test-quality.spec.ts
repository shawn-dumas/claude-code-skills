import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretTestQuality } from '../ast-interpret-test-quality';
import { analyzeTestFile } from '../ast-test-analysis';
import { astConfig } from '../ast-config';
import type { TestObservation, TestQualityAssessment, AssessmentResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation<K extends TestObservation['kind']>(
  kind: K,
  file: string,
  line: number,
  evidence: TestObservation['evidence'] = {},
): TestObservation {
  return { kind, file, line, evidence } as TestObservation;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ast-interpret-test-quality', () => {
  describe('Mock classification', () => {
    it('classifies boundary package mock (next/router) as MOCK_BOUNDARY_COMPLIANT', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: 'next/router',
          returnShapeText: '() => ({ push: vi.fn() })',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_BOUNDARY_COMPLIANT');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].confidence).toBe('high');
      expect(mockAssessments[0].rationale[0]).toContain('boundary packages list');
    });

    it('classifies firebase mock as MOCK_BOUNDARY_COMPLIANT', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: 'firebase/auth',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_BOUNDARY_COMPLIANT');
      expect(mockAssessments).toHaveLength(1);
    });

    it('classifies third-party package mock as MOCK_BOUNDARY_COMPLIANT with medium confidence', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: 'lodash',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_BOUNDARY_COMPLIANT');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].confidence).toBe('medium');
      expect(mockAssessments[0].rationale[0]).toContain('third-party package');
    });

    it('classifies own hook mock as MOCK_INTERNAL_VIOLATION', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: './useMyHook',
        }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 5, {
          target: './useMyHook',
          resolvedPath: 'src/hooks/useMyHook.ts',
          exportNames: ['useMyHook', 'MyHookReturn'],
          fileExtension: '.ts',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_INTERNAL_VIOLATION');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].confidence).toBe('high');
      expect(mockAssessments[0].rationale[0]).toContain('mocking own hook');
    });

    it('classifies own component mock as MOCK_INTERNAL_VIOLATION', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: './MyComponent',
        }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 5, {
          target: './MyComponent',
          resolvedPath: 'src/components/MyComponent.tsx',
          exportNames: ['MyComponent'],
          fileExtension: '.tsx',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_INTERNAL_VIOLATION');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].rationale[0]).toContain('mocking own component');
    });

    it('classifies own utility mock as MOCK_INTERNAL_VIOLATION with medium confidence', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: './utils/format',
        }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 5, {
          target: './utils/format',
          resolvedPath: 'src/utils/format.ts',
          exportNames: ['formatDate', 'formatNumber'],
          fileExtension: '.ts',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_INTERNAL_VIOLATION');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].confidence).toBe('medium');
      expect(mockAssessments[0].rationale[0]).toContain('mocking own utility');
    });

    it('classifies spy on boundary global (window) as MOCK_BOUNDARY_COMPLIANT', () => {
      const observations: TestObservation[] = [
        makeObservation('SPY_DECLARATION', 'test.spec.ts', 5, {
          spyTarget: 'window',
          spyMethod: 'scrollTo',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_BOUNDARY_COMPLIANT');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].rationale[0]).toContain('boundary global');
    });

    it('classifies spy on internal object as MOCK_INTERNAL_VIOLATION', () => {
      const observations: TestObservation[] = [
        makeObservation('SPY_DECLARATION', 'test.spec.ts', 5, {
          spyTarget: 'myService',
          spyMethod: 'fetch',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_INTERNAL_VIOLATION');
      expect(mockAssessments).toHaveLength(1);
    });

    it('classifies mock with boundary path pattern (fetchApi) as MOCK_BOUNDARY_COMPLIANT', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, {
          target: '@/shared/lib/fetchApi',
          resolvedPath: 'src/shared/lib/fetchApi.ts',
        }),
      ];

      const result = interpretTestQuality(observations);

      const mockAssessments = result.assessments.filter(a => a.kind === 'MOCK_BOUNDARY_COMPLIANT');
      expect(mockAssessments).toHaveLength(1);
      expect(mockAssessments[0].rationale[0]).toContain('boundary pattern');
    });
  });

  describe('Assertion classification', () => {
    it('classifies testing-library assertion (screen.getByText) as ASSERTION_USER_VISIBLE', () => {
      const observations: TestObservation[] = [
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 10, {
          matcherName: 'toBeInTheDocument',
          expectArgText: 'screen.getByText("Hello")',
          isScreenQuery: true,
        }),
      ];

      const result = interpretTestQuality(observations);

      const assertionAssessments = result.assessments.filter(a => a.kind === 'ASSERTION_USER_VISIBLE');
      expect(assertionAssessments).toHaveLength(1);
      expect(assertionAssessments[0].confidence).toBe('high');
    });

    it('classifies user-visible matcher (toBeVisible) as ASSERTION_USER_VISIBLE', () => {
      const observations: TestObservation[] = [
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 10, {
          matcherName: 'toBeVisible',
          expectArgText: 'element',
        }),
      ];

      const result = interpretTestQuality(observations);

      const assertionAssessments = result.assessments.filter(a => a.kind === 'ASSERTION_USER_VISIBLE');
      expect(assertionAssessments).toHaveLength(1);
    });

    it('classifies toMatchSnapshot as ASSERTION_SNAPSHOT', () => {
      const observations: TestObservation[] = [
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 10, {
          matcherName: 'toMatchSnapshot',
          expectArgText: 'component',
        }),
      ];

      const result = interpretTestQuality(observations);

      const assertionAssessments = result.assessments.filter(a => a.kind === 'ASSERTION_SNAPSHOT');
      expect(assertionAssessments).toHaveLength(1);
      expect(assertionAssessments[0].confidence).toBe('high');
    });

    it('classifies result.current assertion (hook return) as ASSERTION_USER_VISIBLE', () => {
      const observations: TestObservation[] = [
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 10, {
          matcherName: 'toBe',
          expectArgText: 'result.current.value',
          isResultCurrent: true,
        }),
      ];

      const result = interpretTestQuality(observations);

      const assertionAssessments = result.assessments.filter(a => a.kind === 'ASSERTION_USER_VISIBLE');
      expect(assertionAssessments).toHaveLength(1);
      expect(assertionAssessments[0].rationale[0]).toContain('hook return value');
    });

    it('classifies callback-fired assertion on prop as ASSERTION_USER_VISIBLE', () => {
      const observations: TestObservation[] = [
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 10, {
          matcherName: 'toHaveBeenCalled',
          expectArgText: 'props.onClick',
        }),
      ];

      const result = interpretTestQuality(observations);

      const assertionAssessments = result.assessments.filter(a => a.kind === 'ASSERTION_USER_VISIBLE');
      expect(assertionAssessments).toHaveLength(1);
      expect(assertionAssessments[0].rationale[0]).toContain('callback-fired');
    });

    it('classifies toHaveBeenCalled on non-prop as ASSERTION_IMPLEMENTATION', () => {
      const observations: TestObservation[] = [
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 10, {
          matcherName: 'toHaveBeenCalled',
          expectArgText: 'mockFetch',
        }),
      ];

      const result = interpretTestQuality(observations);

      const assertionAssessments = result.assessments.filter(a => a.kind === 'ASSERTION_IMPLEMENTATION');
      expect(assertionAssessments).toHaveLength(1);
      expect(assertionAssessments[0].confidence).toBe('medium');
    });
  });

  describe('Strategy detection', () => {
    it('detects playwright strategy from PLAYWRIGHT_IMPORT', () => {
      const observations: TestObservation[] = [
        makeObservation('PLAYWRIGHT_IMPORT', 'test.spec.ts', 1, {
          importSource: '@playwright/test',
        }),
      ];

      const result = interpretTestQuality(observations);

      const strategyAssessments = result.assessments.filter(a => a.kind === 'DETECTED_STRATEGY');
      expect(strategyAssessments).toHaveLength(1);
      expect(strategyAssessments[0].subject.symbol).toBe('playwright');
      expect(strategyAssessments[0].confidence).toBe('high');
    });

    it('detects integration-providers strategy from render + provider', () => {
      const observations: TestObservation[] = [
        makeObservation('RENDER_CALL', 'test.spec.ts', 10, {
          isRenderHook: false,
        }),
        makeObservation('PROVIDER_WRAPPER', 'test.spec.ts', 15, {
          providerName: 'QueryClientProvider',
        }),
      ];

      const result = interpretTestQuality(observations);

      const strategyAssessments = result.assessments.filter(a => a.kind === 'DETECTED_STRATEGY');
      expect(strategyAssessments).toHaveLength(1);
      expect(strategyAssessments[0].subject.symbol).toBe('integration-providers');
    });

    it('detects unit-render strategy from render without provider', () => {
      const observations: TestObservation[] = [
        makeObservation('RENDER_CALL', 'test.spec.ts', 10, {
          isRenderHook: false,
        }),
      ];

      const result = interpretTestQuality(observations);

      const strategyAssessments = result.assessments.filter(a => a.kind === 'DETECTED_STRATEGY');
      expect(strategyAssessments).toHaveLength(1);
      expect(strategyAssessments[0].subject.symbol).toBe('unit-render');
    });

    it('detects unit-pure strategy when no render or playwright', () => {
      const observations: TestObservation[] = [
        makeObservation('TEST_BLOCK', 'test.spec.ts', 5, {
          testName: 'should work',
        }),
      ];

      const result = interpretTestQuality(observations);

      const strategyAssessments = result.assessments.filter(a => a.kind === 'DETECTED_STRATEGY');
      expect(strategyAssessments).toHaveLength(1);
      expect(strategyAssessments[0].subject.symbol).toBe('unit-pure');
    });
  });

  describe('Cleanup assessment', () => {
    it('reports CLEANUP_COMPLETE when no local afterEach (global cleanup assumed)', () => {
      const observations: TestObservation[] = [makeObservation('TEST_BLOCK', 'test.spec.ts', 5, { testName: 'test' })];

      const result = interpretTestQuality(observations);

      const cleanupAssessments = result.assessments.filter(a => a.kind === 'CLEANUP_COMPLETE');
      expect(cleanupAssessments).toHaveLength(1);
      expect(cleanupAssessments[0].rationale[0]).toContain('global cleanup');
    });

    it('reports CLEANUP_COMPLETE with local restoreAllMocks', () => {
      const observations: TestObservation[] = [
        makeObservation('AFTER_EACH_BLOCK', 'test.spec.ts', 5, {}),
        makeObservation('CLEANUP_CALL', 'test.spec.ts', 6, {
          cleanupType: 'restoreAllMocks',
        }),
      ];

      const result = interpretTestQuality(observations);

      const cleanupAssessments = result.assessments.filter(a => a.kind === 'CLEANUP_COMPLETE');
      expect(cleanupAssessments).toHaveLength(1);
    });

    it('reports CLEANUP_INCOMPLETE when afterEach has no cleanup patterns', () => {
      const observations: TestObservation[] = [makeObservation('AFTER_EACH_BLOCK', 'test.spec.ts', 5, {})];

      const result = interpretTestQuality(observations);

      const cleanupAssessments = result.assessments.filter(a => a.kind === 'CLEANUP_INCOMPLETE');
      expect(cleanupAssessments).toHaveLength(1);
      expect(cleanupAssessments[0].isCandidate).toBe(true);
    });
  });

  describe('Data sourcing assessment', () => {
    it('reports DATA_SOURCING_COMPLIANT when fixture import present', () => {
      const observations: TestObservation[] = [
        makeObservation('FIXTURE_IMPORT', 'test.spec.ts', 1, {
          fixtureSource: '@/fixtures',
        }),
      ];

      const result = interpretTestQuality(observations);

      const dataAssessments = result.assessments.filter(a => a.kind === 'DATA_SOURCING_COMPLIANT');
      expect(dataAssessments).toHaveLength(1);
    });

    it('reports DATA_SOURCING_VIOLATION when shared mutable import present', () => {
      const observations: TestObservation[] = [
        makeObservation('SHARED_MUTABLE_IMPORT', 'test.spec.ts', 1, {
          importSource: '__tests__/constants',
        }),
      ];

      const result = interpretTestQuality(observations);

      const dataAssessments = result.assessments.filter(a => a.kind === 'DATA_SOURCING_VIOLATION');
      expect(dataAssessments).toHaveLength(1);
      expect(dataAssessments[0].isCandidate).toBe(true);
    });
  });

  describe('Delete candidate assessment', () => {
    it('reports DELETE_CANDIDATE when 3+ internal mock violations', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, { target: './hook1' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 5, {
          target: './hook1',
          exportNames: ['useHook1'],
          fileExtension: '.ts',
        }),
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 6, { target: './hook2' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 6, {
          target: './hook2',
          exportNames: ['useHook2'],
          fileExtension: '.ts',
        }),
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 7, { target: './hook3' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 7, {
          target: './hook3',
          exportNames: ['useHook3'],
          fileExtension: '.ts',
        }),
      ];

      const result = interpretTestQuality(observations);

      const deleteAssessments = result.assessments.filter(a => a.kind === 'DELETE_CANDIDATE');
      expect(deleteAssessments).toHaveLength(1);
      expect(deleteAssessments[0].isCandidate).toBe(true);
      expect(deleteAssessments[0].requiresManualReview).toBe(true);
      expect(deleteAssessments[0].rationale[0]).toContain('3 internal mock violations');
    });

    it('does not report DELETE_CANDIDATE when below threshold', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, { target: './hook1' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 5, {
          target: './hook1',
          exportNames: ['useHook1'],
          fileExtension: '.ts',
        }),
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 6, { target: './hook2' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 6, {
          target: './hook2',
          exportNames: ['useHook2'],
          fileExtension: '.ts',
        }),
      ];

      const result = interpretTestQuality(observations);

      const deleteAssessments = result.assessments.filter(a => a.kind === 'DELETE_CANDIDATE');
      expect(deleteAssessments).toHaveLength(0);
    });
  });

  describe('Orphaned test detection', () => {
    it('reports ORPHANED_TEST when subject does not exist', () => {
      const observations: TestObservation[] = [makeObservation('TEST_BLOCK', 'test.spec.ts', 5, { testName: 'test' })];

      const result = interpretTestQuality(observations, astConfig, '', false);

      const orphanAssessments = result.assessments.filter(a => a.kind === 'ORPHANED_TEST');
      expect(orphanAssessments).toHaveLength(1);
      expect(orphanAssessments[0].rationale[0]).toContain('subject file does not exist');
    });

    it('does not report ORPHANED_TEST when subject exists', () => {
      const observations: TestObservation[] = [makeObservation('TEST_BLOCK', 'test.spec.ts', 5, { testName: 'test' })];

      const result = interpretTestQuality(observations, astConfig, '', true);

      const orphanAssessments = result.assessments.filter(a => a.kind === 'ORPHANED_TEST');
      expect(orphanAssessments).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('returns correct structure for empty observations', () => {
      const result = interpretTestQuality([]);
      expect(result.assessments).toHaveLength(0);
    });

    it('handles multiple observation types in one file', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, { target: 'next/router' }),
        makeObservation('RENDER_CALL', 'test.spec.ts', 10, { isRenderHook: false }),
        makeObservation('ASSERTION_CALL', 'test.spec.ts', 15, {
          matcherName: 'toBeVisible',
          expectArgText: 'element',
        }),
      ];

      const result = interpretTestQuality(observations);

      // Should have: mock assessment, strategy assessment, assertion assessment, cleanup assessment
      expect(result.assessments.length).toBeGreaterThan(3);

      const kinds = result.assessments.map(a => a.kind);
      expect(kinds).toContain('MOCK_BOUNDARY_COMPLIANT');
      expect(kinds).toContain('DETECTED_STRATEGY');
      expect(kinds).toContain('ASSERTION_USER_VISIBLE');
      expect(kinds).toContain('CLEANUP_COMPLETE');
    });
  });

  describe('Assessment structure', () => {
    it('each assessment has all required fields', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, { target: 'next/router' }),
      ];

      const result = interpretTestQuality(observations);

      for (const assessment of result.assessments) {
        expect(assessment).toHaveProperty('kind');
        expect(assessment).toHaveProperty('subject');
        expect(assessment).toHaveProperty('confidence');
        expect(assessment).toHaveProperty('rationale');
        expect(assessment).toHaveProperty('basedOn');
        expect(assessment).toHaveProperty('isCandidate');
        expect(assessment).toHaveProperty('requiresManualReview');

        expect(assessment.subject).toHaveProperty('file');
        expect(Array.isArray(assessment.rationale)).toBe(true);
        expect(Array.isArray(assessment.basedOn)).toBe(true);
      }
    });

    it('output is JSON-serializable', () => {
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, { target: 'next/router' }),
      ];

      const result = interpretTestQuality(observations);
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json) as AssessmentResult<TestQualityAssessment>;
      expect(parsed.assessments.length).toBeGreaterThan(0);
    });
  });

  describe('Custom config', () => {
    it('uses provided config for delete threshold', () => {
      const customConfig = {
        ...astConfig,
        testing: {
          ...astConfig.testing,
          deleteThresholdInternalMocks: 5, // Higher threshold
        },
      };

      // Create 3 internal mocks (would trigger with default config of 3)
      const observations: TestObservation[] = [
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 5, { target: './hook1' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 5, {
          target: './hook1',
          exportNames: ['useHook1'],
          fileExtension: '.ts',
        }),
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 6, { target: './hook2' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 6, {
          target: './hook2',
          exportNames: ['useHook2'],
          fileExtension: '.ts',
        }),
        makeObservation('MOCK_DECLARATION', 'test.spec.ts', 7, { target: './hook3' }),
        makeObservation('MOCK_TARGET_RESOLVED', 'test.spec.ts', 7, {
          target: './hook3',
          exportNames: ['useHook3'],
          fileExtension: '.ts',
        }),
      ];

      const result = interpretTestQuality(observations, customConfig);

      // Should NOT have DELETE_CANDIDATE because threshold is 5
      const deleteAssessments = result.assessments.filter(a => a.kind === 'DELETE_CANDIDATE');
      expect(deleteAssessments).toHaveLength(0);
    });
  });

  describe('Integration with real file', () => {
    it('produces assessments for a real test file', () => {
      // Use the AST tools own test file as a real test case
      const testFilePath = path.join(__dirname, 'ast-interpret-hooks.spec.ts');

      let analysis;
      try {
        analysis = analyzeTestFile(testFilePath);
      } catch {
        // Skip if file not found (running in isolation)
        return;
      }

      const result = interpretTestQuality(analysis.observations, astConfig, '', analysis.subjectExists);

      // Should produce assessments
      expect(result.assessments.length).toBeGreaterThan(0);

      // Should have at least strategy and cleanup assessments
      const strategyAssessments = result.assessments.filter(a => a.kind === 'DETECTED_STRATEGY');
      expect(strategyAssessments).toHaveLength(1);

      const cleanupAssessments = result.assessments.filter(
        a => a.kind === 'CLEANUP_COMPLETE' || a.kind === 'CLEANUP_INCOMPLETE',
      );
      expect(cleanupAssessments).toHaveLength(1);
    });
  });
});
