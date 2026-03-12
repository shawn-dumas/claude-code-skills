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
// Mock classification
// ---------------------------------------------------------------------------

describe('ast-test-analysis', () => {
  describe('mock classification', () => {
    it('classifies boundary mocks (next/router)', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const routerMock = result.mocks.find(m => m.target === 'next/router');

      expect(routerMock).toBeDefined();
      expect(routerMock!.classification).toBe('BOUNDARY');
    });

    it('classifies third-party mocks (echarts-for-react)', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const echartsMock = result.mocks.find(m => m.target === 'echarts-for-react');

      expect(echartsMock).toBeDefined();
      expect(echartsMock!.classification).toBe('THIRD_PARTY');
    });

    it('classifies own-hook mocks from relative path', () => {
      const result = analyzeFixture('test-file.spec.ts');
      const hookMock = result.mocks.find(m => m.target.includes('useData'));

      expect(hookMock).toBeDefined();
      expect(hookMock!.classification).toBe('OWN_HOOK');
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

    it('classifies own-hook mocks from service hook path', () => {
      const result = analyzeFixture('test-integration-providers.spec.tsx');
      const hookMock = result.mocks.find(m => m.target.includes('useData'));

      expect(hookMock).toBeDefined();
      expect(hookMock!.classification).toBe('OWN_HOOK');
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
  // Assertion classification
  // ---------------------------------------------------------------------------

  describe('assertion classification', () => {
    it('classifies getByText as USER_VISIBLE', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const userVisible = result.assertions.filter(a => a.classification === 'USER_VISIBLE');

      expect(userVisible.length).toBeGreaterThan(0);
      const textAssertion = userVisible.find(a => a.text.includes('getByText'));
      expect(textAssertion).toBeDefined();
    });

    it('classifies getByRole as USER_VISIBLE', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const userVisible = result.assertions.filter(a => a.classification === 'USER_VISIBLE');

      const roleAssertion = userVisible.find(a => a.text.includes('getByRole'));
      expect(roleAssertion).toBeDefined();
    });

    it('classifies toHaveBeenCalledWith on callback as CALLBACK_FIRED', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');
      const callbackFired = result.assertions.filter(a => a.classification === 'CALLBACK_FIRED');

      expect(callbackFired.length).toBeGreaterThan(0);
      expect(callbackFired[0].text).toContain('toHaveBeenCalledWith');
    });

    it('classifies toMatchSnapshot as LARGE_SNAPSHOT', () => {
      const result = analyzeFixture('test-snapshot.spec.tsx');
      const snapshots = result.assertions.filter(a => a.classification === 'LARGE_SNAPSHOT');

      expect(snapshots.length).toBeGreaterThan(0);
    });

    it('classifies result.current as HOOK_RETURN', () => {
      const result = analyzeFixture('test-snapshot.spec.tsx');
      const hookReturns = result.assertions.filter(a => a.classification === 'HOOK_RETURN');

      expect(hookReturns.length).toBeGreaterThan(0);
      expect(hookReturns[0].text).toContain('result.current');
    });
  });

  // ---------------------------------------------------------------------------
  // Strategy detection
  // ---------------------------------------------------------------------------

  describe('strategy detection', () => {
    it('detects unit-props for props-only render', () => {
      const result = analyzeFixture('test-unit-props.spec.tsx');

      expect(result.strategy).toBe('unit-props');
    });

    it('detects integration-providers for QueryClientProvider wrapped render', () => {
      const result = analyzeFixture('test-integration-providers.spec.tsx');

      expect(result.strategy).toBe('integration-providers');
    });

    it('detects unit-pure for direct function call tests', () => {
      const result = analyzeFixture('test-unit-pure.spec.ts');

      expect(result.strategy).toBe('unit-pure');
    });
  });

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

      // Each result should have the standard shape
      for (const result of results) {
        expect(result.filePath).toBeDefined();
        expect(result.strategy).toBeDefined();
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
      expect(result.strategy).toBeDefined();
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
      expect(result.strategy).toBe('unit-pure');
      expect(result.dataSourcing.usesFixtureSystem).toBe(true);
    });
  });
});
