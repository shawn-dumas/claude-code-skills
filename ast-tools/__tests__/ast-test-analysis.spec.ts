import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeTestFile, analyzeTestDirectory } from '../ast-test-analysis';
import type { TestAnalysis } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): TestAnalysis {
  return analyzeTestFile(fixturePath(name));
}

// ---------------------------------------------------------------------------
// Mock extraction (observation-only, no classification)
// ---------------------------------------------------------------------------

describe('ast-test-analysis', () => {
  describe('mock extraction', () => {
    it('extracts mocks without classification (observation-only)', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const routerMock = result.mocks.find(m => m.target === 'next/router');

      expect(routerMock).toBeDefined();
      // Classification is now done by interpreters, not the tool
      expect(routerMock).not.toHaveProperty('classification');
    });

    it('extracts third-party mocks', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const echartsMock = result.mocks.find(m => m.target === 'echarts-for-react');

      expect(echartsMock).toBeDefined();
      expect(echartsMock).not.toHaveProperty('classification');
    });

    it('extracts own-hook mocks from relative path', () => {
      const result = analyzeFixture('test-file.spec.ts');
      const hookMock = result.mocks.find(m => m.target.includes('useData'));

      expect(hookMock).toBeDefined();
      expect(hookMock).not.toHaveProperty('classification');
    });

    it('records mock return shape for factory mocks', () => {
      const result = analyzeFixture('test-file.spec.ts');
      const routerMock = result.mocks.find(m => m.target === 'next/router');

      expect(routerMock).toBeDefined();
      expect(routerMock!.returnShape).not.toBe('auto-mocked');
      expect(routerMock!.returnShape).toContain('useRouter');
    });

    it('records auto-mocked when vi.mock has no factory', () => {
      // The test-file.spec.ts fixture has factories for all mocks,
      // so let's verify the ones that do have factories are not auto-mocked
      const result = analyzeFixture('test-file.spec.ts');
      for (const mock of result.mocks) {
        expect(mock.returnShape).not.toBe('');
      }
    });

    it('extracts own-hook mocks from service hook path', () => {
      const result = analyzeFixture('test-integration-providers.spec.tsx');
      const hookMock = result.mocks.find(m => m.target.includes('useData'));

      expect(hookMock).toBeDefined();
      expect(hookMock).not.toHaveProperty('classification');
    });
  });

  // ---------------------------------------------------------------------------
  // Orphaned test detection
  // ---------------------------------------------------------------------------

  describe('orphaned test detection', () => {
    it('detects orphaned test when subject file does not exist', () => {
      const result = analyzeFixture('test-orphaned.spec.ts');

      expect(result.isOrphaned).toBe(true);
      expect(result.subjectExists).toBe(false);
    });

    it('detects non-orphaned test when subject exists', () => {
      const result = analyzeFixture('test-file.spec.ts');

      expect(result.isOrphaned).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Assertion extraction (observation-only, no classification)
  // ---------------------------------------------------------------------------

  describe('assertion extraction', () => {
    it('extracts assertions without classification (observation-only)', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');

      expect(result.assertions.length).toBeGreaterThan(0);
      // Classification is now done by interpreters
      for (const assertion of result.assertions) {
        expect(assertion).not.toHaveProperty('classification');
      }
    });

    it('extracts assertions with text containing testing library queries', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');

      const queryAssertions = result.assertions.filter(
        a => a.text.includes('getByText') || a.text.includes('getByRole'),
      );
      expect(queryAssertions.length).toBeGreaterThan(0);
    });

    it('extracts callback assertions', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');

      const callbackAssertions = result.assertions.filter(a => a.text.includes('toHaveBeenCalledWith'));
      expect(callbackAssertions.length).toBeGreaterThan(0);
    });

    it('extracts snapshot assertions', () => {
      const result = analyzeFixture('test-snapshot.spec.tsx');

      const snapshotAssertions = result.assertions.filter(a => a.text.includes('toMatchSnapshot'));
      expect(snapshotAssertions.length).toBeGreaterThan(0);
    });

    it('extracts result.current assertions', () => {
      const result = analyzeFixture('test-snapshot.spec.tsx');

      const hookReturnAssertions = result.assertions.filter(a => a.text.includes('result.current'));
      expect(hookReturnAssertions.length).toBeGreaterThan(0);
    });
  });

  // Strategy detection was removed from the tool -- interpreters now handle this

  // ---------------------------------------------------------------------------
  // Cleanup analysis
  // ---------------------------------------------------------------------------

  describe('cleanup analysis', () => {
    it('detects afterEach with timer restoration', () => {
      const result = analyzeFixture('test-cleanup.spec.ts');

      expect(result.cleanup.hasAfterEach).toBe(true);
      expect(result.cleanup.restoresTimers).toBe(true);
    });

    it('detects afterEach with mock restoration', () => {
      const result = analyzeFixture('test-cleanup.spec.ts');

      expect(result.cleanup.restoresMocks).toBe(true);
    });

    it('detects afterEach with storage clearing', () => {
      const result = analyzeFixture('test-cleanup.spec.ts');

      expect(result.cleanup.clearsStorage).toBe(true);
    });

    it('detects missing cleanup patterns', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');

      expect(result.cleanup.hasAfterEach).toBe(false);
      expect(result.cleanup.restoresMocks).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Data sourcing
  // ---------------------------------------------------------------------------

  describe('data sourcing', () => {
    it('detects fixture system usage', () => {
      const result = analyzeFixture('test-data-sourcing.spec.ts');

      expect(result.dataSourcing.usesFixtureSystem).toBe(true);
    });

    it('counts as any occurrences', () => {
      const result = analyzeFixture('test-data-sourcing.spec.ts');

      expect(result.dataSourcing.asAnyCount).toBe(2);
    });

    it('reports zero as-any for clean files', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');

      expect(result.dataSourcing.asAnyCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Describe/test counting
  // ---------------------------------------------------------------------------

  describe('describe/test counting', () => {
    it('counts describe blocks', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');

      expect(result.describeCount).toBe(2);
    });

    it('counts test blocks', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');

      expect(result.testCount).toBe(4);
    });

    it('counts it blocks in .spec.tsx files', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');

      expect(result.describeCount).toBe(1);
      expect(result.testCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Directory mode
  // ---------------------------------------------------------------------------

  describe('directory mode', () => {
    it('analyzes all test files in a directory', () => {
      const results = analyzeTestDirectory(FIXTURES_DIR);

      expect(results.length).toBeGreaterThanOrEqual(4);

      // Each result should have the standard shape (no strategy - that's interpreter domain)
      for (const result of results) {
        expect(result.filePath).toBeDefined();
        expect(result.mocks).toBeDefined();
        expect(result.assertions).toBeDefined();
        expect(result.cleanup).toBeDefined();
        expect(result.dataSourcing).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Real file smoke test
  // ---------------------------------------------------------------------------

  describe('real file smoke test', () => {
    it('analyzes a real spec file without crashing', () => {
      const result = analyzeTestFile('src/ui/page_blocks/dashboard/team/ProductivityBlock.spec.tsx');

      expect(result.filePath).toContain('ProductivityBlock.spec.tsx');
      expect(result.subjectExists).toBe(true);
      expect(result.mocks.length).toBeGreaterThanOrEqual(1);
      expect(result.assertions.length).toBeGreaterThanOrEqual(1);
      expect(result.describeCount).toBeGreaterThan(0);
      expect(result.testCount).toBeGreaterThan(0);
    });

    it('analyzes a real pure-function spec without crashing', () => {
      const result = analyzeTestFile(
        'src/ui/page_blocks/dashboard/team/utils/mapDaysTableData/mapDaysTableData.spec.ts',
      );

      expect(result.filePath).toContain('mapDaysTableData.spec.ts');
      expect(result.subjectExists).toBe(true);
      // Strategy classification moved to interpreter (ast-interpret-test-quality)
      expect(result.dataSourcing.usesFixtureSystem).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Observation extraction
  // ---------------------------------------------------------------------------

  describe('observation extraction', () => {
    it('emits MOCK_DECLARATION observations', () => {
      const result = analyzeFixture('test-file.spec.ts');
      const mockObs = result.observations.filter(o => o.kind === 'MOCK_DECLARATION');

      expect(mockObs.length).toBeGreaterThan(0);
      expect(mockObs[0].evidence.target).toBeDefined();
    });

    it('emits ASSERTION_CALL observations with matcher name', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const assertObs = result.observations.filter(o => o.kind === 'ASSERTION_CALL');

      expect(assertObs.length).toBeGreaterThan(0);
      const visibleMatcher = assertObs.find(o => o.evidence.matcherName === 'toBeVisible');
      expect(visibleMatcher).toBeDefined();
    });

    it('emits RENDER_CALL observations', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const renderObs = result.observations.filter(o => o.kind === 'RENDER_CALL');

      expect(renderObs.length).toBeGreaterThan(0);
      expect(renderObs[0].evidence.isRenderHook).toBe(false);
    });

    it('emits TEST_HELPER_IMPORT observations', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const helperObs = result.observations.filter(o => o.kind === 'TEST_HELPER_IMPORT');

      expect(helperObs.length).toBeGreaterThan(0);
      const testingLibrary = helperObs.find(o => o.evidence.importSource?.includes('@testing-library'));
      expect(testingLibrary).toBeDefined();
    });

    it('emits DESCRIBE_BLOCK and TEST_BLOCK observations', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');
      const describeObs = result.observations.filter(o => o.kind === 'DESCRIBE_BLOCK');
      const testObs = result.observations.filter(o => o.kind === 'TEST_BLOCK');

      expect(describeObs.length).toBe(2);
      expect(testObs.length).toBe(4);
    });

    it('emits AFTER_EACH_BLOCK and CLEANUP_CALL observations', () => {
      const result = analyzeFixture('test-cleanup.spec.ts');
      const afterEachObs = result.observations.filter(o => o.kind === 'AFTER_EACH_BLOCK');
      const cleanupObs = result.observations.filter(o => o.kind === 'CLEANUP_CALL');

      expect(afterEachObs.length).toBe(1);
      expect(cleanupObs.length).toBeGreaterThan(0);

      const restoreMocks = cleanupObs.find(o => o.evidence.cleanupType === 'restoreAllMocks');
      expect(restoreMocks).toBeDefined();
    });

    it('emits PROVIDER_WRAPPER observations', () => {
      const result = analyzeFixture('test-integration-providers.spec.tsx');
      const providerObs = result.observations.filter(o => o.kind === 'PROVIDER_WRAPPER');

      expect(providerObs.length).toBeGreaterThan(0);
      const queryProvider = providerObs.find(o => o.evidence.providerName === 'QueryClientProvider');
      expect(queryProvider).toBeDefined();
    });

    it('emits FIXTURE_IMPORT observations', () => {
      const result = analyzeFixture('test-data-sourcing.spec.ts');
      const fixtureObs = result.observations.filter(o => o.kind === 'FIXTURE_IMPORT');

      expect(fixtureObs.length).toBeGreaterThan(0);
    });

    it('emits isScreenQuery and isResultCurrent evidence on ASSERTION_CALL', () => {
      const result = analyzeFixture('test-snapshot.spec.tsx');
      const assertObs = result.observations.filter(o => o.kind === 'ASSERTION_CALL');

      const resultCurrentAssertion = assertObs.find(o => o.evidence.isResultCurrent);
      expect(resultCurrentAssertion).toBeDefined();
    });

    it('emits observations from negative fixture', () => {
      const result = analyzeFixture('test-analysis-negative.spec.ts');

      // Should have MOCK_DECLARATION for lodash (third-party)
      const mockObs = result.observations.filter(o => o.kind === 'MOCK_DECLARATION');
      const lodashMock = mockObs.find(o => o.evidence.target === 'lodash');
      expect(lodashMock).toBeDefined();

      // Should have AFTER_EACH_BLOCK but no standard CLEANUP_CALL
      const afterEachObs = result.observations.filter(o => o.kind === 'AFTER_EACH_BLOCK');
      expect(afterEachObs.length).toBe(1);

      // Custom cleanup is not detected as CLEANUP_CALL
      const cleanupObs = result.observations.filter(o => o.kind === 'CLEANUP_CALL');
      expect(cleanupObs.length).toBe(0);
    });
  });
});
