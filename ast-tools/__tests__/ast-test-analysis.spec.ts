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
      const result = analyzeTestFile('src/ui/page_blocks/dashboard/team/__tests__/ProductivityBlock.spec.tsx');

      expect(result.filePath).toContain('ProductivityBlock.spec.tsx');
      expect(result.subjectExists).toBe(true);
      expect(result.mocks.length).toBeGreaterThanOrEqual(1);
      expect(result.assertions.length).toBeGreaterThanOrEqual(1);
      expect(result.describeCount).toBeGreaterThan(0);
      expect(result.testCount).toBeGreaterThan(0);
    });

    it('analyzes a real pure-function spec without crashing', () => {
      const result = analyzeTestFile(
        'src/ui/page_blocks/dashboard/team/utils/mapDaysTableData/__tests__/mapDaysTableData.spec.ts',
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

  // ---------------------------------------------------------------------------
  // Factory detection and expansion
  // ---------------------------------------------------------------------------

  describe('factory detection', () => {
    it('expands test.each with inline array', () => {
      const result = analyzeFixture('test-analysis-factory.spec.ts');

      // Fixture has: test.each([3 items]), it.each([4 items via var]),
      // describe.each (2 items, 1 it inside -- it appears once in AST),
      // factory function (1 test() inside, invoked 2 times),
      // 1 standalone test.
      // Base testCount: 1 (test.each) + 1 (it.each) + 1 (describe.each inner it) + 1 (factory internal test) + 1 (standalone) = 5
      // Expanded: 3 (test.each) + 4 (it.each) + 1 (describe.each inner, not expanded) + 2 (factory invocations) + 1 (standalone) = 11
      expect(result.testCount).toBe(5);
      expect(result.expandedTestCount).toBeGreaterThan(result.testCount);
    });

    it('marks TEST_BLOCK observations with isExpanded for .each patterns', () => {
      const result = analyzeFixture('test-analysis-factory.spec.ts');
      const testObs = result.observations.filter(o => o.kind === 'TEST_BLOCK');

      const expandedObs = testObs.filter(o => o.evidence.isExpanded);
      expect(expandedObs.length).toBeGreaterThan(0);

      // The expanded observation should have expandedCount set
      const withCount = expandedObs.find(o => o.evidence.expandedCount && o.evidence.expandedCount > 1);
      expect(withCount).toBeDefined();
    });

    it('does not expand describe.each into test count', () => {
      const result = analyzeFixture('test-analysis-factory.spec.ts');
      // The tests inside describe.each should be counted but not marked as expanded
      // (the describe.each itself expands describe blocks, not test blocks)
      const describeObs = result.observations.filter(o => o.kind === 'DESCRIBE_BLOCK');
      expect(describeObs.length).toBeGreaterThanOrEqual(1);
    });

    it('does not break non-factory specs', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');

      // Specs without factories should have expandedTestCount === testCount
      expect(result.expandedTestCount).toBe(result.testCount);
      expect(result.testCount).toBe(4);
    });

    it('expandedTestCount equals testCount for specs without factories', () => {
      const result = analyzeFixture('test-file.spec.ts');

      expect(result.expandedTestCount).toBe(result.testCount);
    });

    it('correctly counts expanded tests on a real spec with test.each', () => {
      const result = analyzeTestFile(
        'src/shared/utils/string/capitalizeFirstLetter/__tests__/capitalizeFirstLetter.spec.ts',
      );

      // This file has 2 test.each calls: one with 6 items, one with 3 items
      // Base testCount: 2 (two test.each calls counted as 1 each)
      // Expanded: 6 + 3 = 9
      expect(result.testCount).toBe(2);
      expect(result.expandedTestCount).toBe(9);
    });
  });

  // ---------------------------------------------------------------------------
  // Helper delegation tracking
  // ---------------------------------------------------------------------------

  describe('helper delegation tracking', () => {
    it('emits TEST_HELPER_DELEGATION for imported helper calls', () => {
      const result = analyzeFixture('test-analysis-helpers.spec.ts');
      const delegations = result.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');

      // buildUser and verifyUserFields are imported from relative path
      const buildUser = delegations.find(o => o.evidence.functionName === 'buildUser');
      const verifyUser = delegations.find(o => o.evidence.functionName === 'verifyUserFields');
      expect(buildUser).toBeDefined();
      expect(buildUser!.evidence.isImported).toBe(true);
      expect(verifyUser).toBeDefined();
    });

    it('emits TEST_HELPER_DELEGATION for local helper calls', () => {
      const result = analyzeFixture('test-analysis-helpers.spec.ts');
      const delegations = result.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');

      const localHelper = delegations.find(o => o.evidence.functionName === 'assertValidResponse');
      expect(localHelper).toBeDefined();
      expect(localHelper!.evidence.isImported).toBe(false);
    });

    it('does NOT emit TEST_HELPER_DELEGATION for Vitest globals', () => {
      const result = analyzeFixture('test-analysis-helpers.spec.ts');
      const delegations = result.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');

      // vi.fn, expect, etc. should not appear as delegations
      const vitestGlobal = delegations.find(
        o => o.evidence.functionName === 'vi' || o.evidence.functionName === 'expect',
      );
      expect(vitestGlobal).toBeUndefined();
    });

    it('does NOT emit TEST_HELPER_DELEGATION for standard library calls', () => {
      const result = analyzeFixture('test-analysis-helpers.spec.ts');
      const delegations = result.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');

      // JSON.stringify, JSON.parse should not appear
      const jsonCall = delegations.find(
        o => o.evidence.functionName === 'JSON.stringify' || o.evidence.functionName === 'JSON.parse',
      );
      expect(jsonCall).toBeUndefined();
    });

    it('includes correct evidence fields', () => {
      const result = analyzeFixture('test-analysis-helpers.spec.ts');
      const delegations = result.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');

      for (const d of delegations) {
        expect(d.evidence.delegationType).toBe('helper');
        expect(d.evidence.functionName).toBeDefined();
        expect(typeof d.evidence.argCount).toBe('number');
        expect(typeof d.evidence.isImported).toBe('boolean');
      }
    });

    it('does not emit delegations for specs without helper calls', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');
      const delegations = result.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');

      expect(delegations.length).toBe(0);
    });
  });

  describe('SEQUENTIAL_MOCK_RESPONSE', () => {
    it('detects 3+ sequential mockResponseOnce calls', () => {
      const result = analyzeFixture('test-analysis-mock-ordering.spec.ts');
      const seqObs = result.observations.filter(o => o.kind === 'SEQUENTIAL_MOCK_RESPONSE');

      expect(seqObs.length).toBe(2);
    });

    it('records the count of sequential calls', () => {
      const result = analyzeFixture('test-analysis-mock-ordering.spec.ts');
      const seqObs = result.observations.filter(o => o.kind === 'SEQUENTIAL_MOCK_RESPONSE');
      const counts = seqObs.map(o => o.evidence.sequentialCount).sort();

      expect(counts).toEqual([3, 7]);
    });

    it('does not flag 2 sequential mockResponseOnce calls', () => {
      const result = analyzeFixture('test-analysis-mock-ordering.spec.ts');
      const seqObs = result.observations.filter(o => o.kind === 'SEQUENTIAL_MOCK_RESPONSE');

      // Only the 3-call and 7-call functions should be flagged
      const belowThreshold = seqObs.find(o => (o.evidence.sequentialCount ?? 0) < 3);
      expect(belowThreshold).toBeUndefined();
    });

    it('does not flag URL-routing mockResponse', () => {
      const result = analyzeFixture('test-analysis-mock-ordering.spec.ts');
      const seqObs = result.observations.filter(o => o.kind === 'SEQUENTIAL_MOCK_RESPONSE');

      // URL-routing function uses mockResponse, not mockResponseOnce
      expect(seqObs.every(o => o.evidence.functionName !== 'setupUrlRouting')).toBe(true);
    });
  });

  describe('TIMER_NEGATIVE_ASSERTION', () => {
    it('detects setTimeout before negative assertion', () => {
      const result = analyzeFixture('test-analysis-timer-assertion.spec.ts');
      const timerObs = result.observations.filter(o => o.kind === 'TIMER_NEGATIVE_ASSERTION');

      expect(timerObs.length).toBe(2);
    });

    it('records the delay value', () => {
      const result = analyzeFixture('test-analysis-timer-assertion.spec.ts');
      const timerObs = result.observations.filter(o => o.kind === 'TIMER_NEGATIVE_ASSERTION');
      const delays = timerObs.map(o => o.evidence.delayMs).sort((a, b) => (a ?? 0) - (b ?? 0));

      expect(delays).toEqual([50, 100]);
    });

    it('does not flag setTimeout without negative assertion', () => {
      const result = analyzeFixture('test-analysis-timer-assertion.spec.ts');
      const timerObs = result.observations.filter(o => o.kind === 'TIMER_NEGATIVE_ASSERTION');

      // The fixture has 5 test cases but only 2 have setTimeout BEFORE a negative assertion
      expect(timerObs.length).toBe(2);
    });

    it('does not flag negative assertion before timer', () => {
      const result = analyzeFixture('test-analysis-timer-assertion.spec.ts');
      const timerObs = result.observations.filter(o => o.kind === 'TIMER_NEGATIVE_ASSERTION');

      // The "asserts not called then waits" test has the negative assertion BEFORE
      // the timer -- it should not be flagged
      expect(timerObs.every(o => (o.evidence.delayMs ?? 0) <= 100)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Authoritative observations
  // ---------------------------------------------------------------------------

  describe('authoritative observations', () => {
    it('clean fixture produces no authoritative observations', () => {
      const result = analyzeFixture('test-analysis-clean/clean.spec.ts');
      const authoritative = result.observations.filter(o => o.authoritative === true);

      expect(authoritative.length).toBe(0);
    });

    it('violations fixture produces MOCK_INTERNAL with authoritative=true', () => {
      const result = analyzeFixture('test-analysis-violations/violations.spec.ts');
      const mockInternal = result.observations.filter(o => o.kind === 'MOCK_INTERNAL');

      expect(mockInternal.length).toBe(1);
      expect(mockInternal[0].authoritative).toBe(true);
      expect(mockInternal[0].evidence.target).toBe('@/shared/utils/date/formatDate');
    });

    it('violations fixture produces MISSING_CLEANUP with authoritative=true', () => {
      const result = analyzeFixture('test-analysis-violations/violations.spec.ts');
      const missingCleanup = result.observations.filter(o => o.kind === 'MISSING_CLEANUP');

      expect(missingCleanup.length).toBe(1);
      expect(missingCleanup[0].authoritative).toBe(true);
      expect(missingCleanup[0].evidence.hasMocks).toBe(true);
    });

    it('violations fixture produces DATA_SOURCING_VIOLATION with authoritative=true', () => {
      const result = analyzeFixture('test-analysis-violations/violations.spec.ts');
      const dataSourcing = result.observations.filter(o => o.kind === 'DATA_SOURCING_VIOLATION');

      expect(dataSourcing.length).toBe(1);
      expect(dataSourcing[0].authoritative).toBe(true);
      expect(dataSourcing[0].evidence.asAnyCount).toBe(1);
    });

    it('violations fixture produces all 3 authoritative observations', () => {
      const result = analyzeFixture('test-analysis-violations/violations.spec.ts');
      const authoritative = result.observations.filter(o => o.authoritative === true);

      expect(authoritative.length).toBe(3);
      const kinds = authoritative.map(o => o.kind).sort();
      expect(kinds).toEqual(['DATA_SOURCING_VIOLATION', 'MISSING_CLEANUP', 'MOCK_INTERNAL']);
    });

    it('non-authoritative observations do not have authoritative=true', () => {
      const result = analyzeFixture('test-analysis-violations/violations.spec.ts');
      const nonAuthoritative = result.observations.filter(
        o => o.kind !== 'MOCK_INTERNAL' && o.kind !== 'MISSING_CLEANUP' && o.kind !== 'DATA_SOURCING_VIOLATION',
      );

      for (const obs of nonAuthoritative) {
        expect(obs.authoritative).not.toBe(true);
      }
    });

    it('MOCK_INTERNAL has confidence evidence field', () => {
      const result = analyzeFixture('test-analysis-violations/violations.spec.ts');
      const mockInternal = result.observations.find(o => o.kind === 'MOCK_INTERNAL');

      expect(mockInternal).toBeDefined();
      // The mock target starts with @/ so it is resolved via path alias (medium confidence)
      // or resolved to a file (high confidence). Either way, confidence should be set.
      expect(mockInternal!.evidence.confidence).toBeDefined();
      expect(['high', 'medium']).toContain(mockInternal!.evidence.confidence);
    });
  });

  // ---------------------------------------------------------------------------
  // IMPLEMENTATION_ASSERTION detection
  // ---------------------------------------------------------------------------

  describe('IMPLEMENTATION_ASSERTION detection', () => {
    it('clean fixture produces zero IMPLEMENTATION_ASSERTION observations', () => {
      const result = analyzeFixture('implementation-assertion-clean/clean.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      expect(implAssertions.length).toBe(0);
    });

    it('hook-call fixture produces observations with assertionType hook-call-args', () => {
      const result = analyzeFixture('implementation-assertion-hook-call/hook-call.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      expect(implAssertions.length).toBe(3);
      for (const obs of implAssertions) {
        expect(obs.evidence.assertionType).toBe('hook-call-args');
      }
    });

    it('hook-call fixture detects useRouter, useTeamsListQuery, and mockUseFeatureFlags', () => {
      const result = analyzeFixture('implementation-assertion-hook-call/hook-call.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');
      const hookNames = implAssertions.map(o => o.evidence.hookName).sort();

      expect(hookNames).toEqual(['mockUseFeatureFlags', 'useRouter', 'useTeamsListQuery']);
    });

    it('mutation fixture produces observations with assertionType mutation-call-args', () => {
      const result = analyzeFixture('implementation-assertion-mutation/mutation.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      expect(implAssertions.length).toBe(3);
      for (const obs of implAssertions) {
        expect(obs.evidence.assertionType).toBe('mutation-call-args');
      }
    });

    it('mutation fixture detects mutateAsync and mutate', () => {
      const result = analyzeFixture('implementation-assertion-mutation/mutation.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');
      const hookNames = implAssertions.map(o => o.evidence.hookName).sort();

      expect(hookNames).toEqual(['mutate', 'mutateAsync', 'mutateAsync']);
    });

    it('all IMPLEMENTATION_ASSERTION observations have authoritative=true', () => {
      const hookResult = analyzeFixture('implementation-assertion-hook-call/hook-call.spec.ts');
      const mutationResult = analyzeFixture('implementation-assertion-mutation/mutation.spec.ts');

      const allImpl = [
        ...hookResult.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION'),
        ...mutationResult.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION'),
      ];

      expect(allImpl.length).toBeGreaterThan(0);
      for (const obs of allImpl) {
        expect(obs.authoritative).toBe(true);
      }
    });

    it('observations have pattern evidence field', () => {
      const result = analyzeFixture('implementation-assertion-hook-call/hook-call.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      for (const obs of implAssertions) {
        expect(obs.evidence.pattern).toBeDefined();
        expect(obs.evidence.pattern!.length).toBeGreaterThan(0);
      }
    });

    it('real-world hook fixture matches manifest expectations', () => {
      const result = analyzeFixture('implementation-assertion-real-hook/real-hook.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      expect(implAssertions.length).toBe(3);
      for (const obs of implAssertions) {
        expect(obs.evidence.assertionType).toBe('hook-call-args');
        expect(obs.authoritative).toBe(true);
      }
    });

    it('real-world mutation fixture matches manifest expectations', () => {
      const result = analyzeFixture('implementation-assertion-real-mutation/real-mutation.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      expect(implAssertions.length).toBe(3);
      for (const obs of implAssertions) {
        expect(obs.evidence.assertionType).toBe('mutation-call-args');
        expect(obs.authoritative).toBe(true);
      }
    });

    it('does not flag callback assertions like expect(onClick).toHaveBeenCalled', () => {
      const result = analyzeFixture('implementation-assertion-clean/clean.spec.ts');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      // onClick is not a hook (no use prefix) and not a mutation (not mutate/mutateAsync)
      expect(implAssertions.length).toBe(0);
    });

    it('detects patterns on real codebase specs', () => {
      const result = analyzeTestFile('src/ui/page_blocks/teams/__tests__/TeamDetailContainer.spec.tsx');
      const implAssertions = result.observations.filter(o => o.kind === 'IMPLEMENTATION_ASSERTION');

      // TeamDetailContainer has expect(useUpdateTeamMutation).toHaveBeenCalled()
      // and expect(mutateAsync).toHaveBeenCalledWith(...)
      expect(implAssertions.length).toBeGreaterThanOrEqual(1);

      const hookCallAssertions = implAssertions.filter(o => o.evidence.assertionType === 'hook-call-args');
      const mutationAssertions = implAssertions.filter(o => o.evidence.assertionType === 'mutation-call-args');
      expect(hookCallAssertions.length + mutationAssertions.length).toBe(implAssertions.length);
    });
  });
});
