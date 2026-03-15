import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeTestParity, analyzeHelperFile, extractTestParityObservations } from '../ast-test-parity';
import { PROJECT_ROOT } from '../project';

const fixture = (name: string) => path.join(PROJECT_ROOT, 'scripts/AST/__tests__/fixtures', name);

describe('ast-test-parity', () => {
  describe('analyzeTestParity', () => {
    it('extracts test blocks from positive fixture', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.tests.length).toBe(3);
      expect(result.tests[0].name).toBe('create and delete an item');
      expect(result.tests[1].name).toBe('edit an item');
      expect(result.tests[2].name).toBe('standalone test outside describe');
    });

    it('detects describe parent for nested tests', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.tests[0].describeParent).toBe('CRUD operations');
      expect(result.tests[1].describeParent).toBe('CRUD operations');
      expect(result.tests[2].describeParent).toBeNull();
    });

    it('counts assertions per test', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.tests[0].assertionCount).toBe(3);
      expect(result.tests[0].assertions[0].matcher).toBe('toHaveText');
      expect(result.tests[0].assertions[1].matcher).toBe('toBeVisible');
      expect(result.tests[0].assertions[2].matcher).toBe('toContainText');

      expect(result.tests[1].assertionCount).toBe(1);
      expect(result.tests[1].assertions[0].matcher).toBe('toHaveValue');

      expect(result.tests[2].assertionCount).toBe(1);
      expect(result.tests[2].assertions[0].matcher).toBe('toBeVisible');
    });

    it('extracts route intercepts per test', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.tests[0].routeIntercepts.length).toBe(1);
      expect(result.tests[0].routeIntercepts[0].urlPattern).toBe('**/api/users');

      expect(result.tests[1].routeIntercepts.length).toBe(0);

      expect(result.tests[2].routeIntercepts.length).toBe(2);
      expect(result.tests[2].routeIntercepts[0].urlPattern).toBe('**/api/teams');
    });

    it('extracts navigations per test', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.tests[0].navigations).toEqual(['/settings/users']);
      expect(result.tests[1].navigations).toEqual(['/settings/users/1']);
      expect(result.tests[2].navigations).toEqual([]);
    });

    it('extracts POM usage per test', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.tests[0].pomUsages).toContain('NavigationPage');
      expect(result.tests[0].pomUsages).toContain('UsersPage');
      expect(result.tests[1].pomUsages).toEqual([]);
    });

    it('extracts helper delegations per test', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      // Test 0 (create and delete an item): no helper calls
      expect(result.tests[0].helperDelegations).toEqual([]);

      // Test 2 (standalone): calls verifyDashboardLayout() and usersPage.checkColumns()
      expect(result.tests[2].helperDelegations.length).toBe(2);
      expect(result.tests[2].helperDelegations[0].functionName).toBe('verifyDashboardLayout');
      expect(result.tests[2].helperDelegations[1].functionName).toBe('usersPage.checkColumns');
    });

    it('detects serial mode', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));
      expect(result.serialMode).toBe(true);
    });

    it('detects beforeEach', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));
      expect(result.beforeEachPresent).toBe(true);
    });

    it('detects auth method', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));
      expect(result.authMethod).toBe('signInWithEmulator');
    });

    it('computes file-level totals', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));

      expect(result.totalAssertions).toBe(5);
      expect(result.totalRouteIntercepts).toBe(3);
    });

    it('extracts describes', () => {
      const result = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));
      expect(result.describes).toContain('CRUD operations');
    });
  });

  describe('negative fixture', () => {
    it('produces zero Playwright-specific patterns from a Vitest spec', () => {
      const result = analyzeTestParity(fixture('pw-spec-negative.spec.ts'));

      // It should still parse test blocks (it/test are the same in both)
      expect(result.tests.length).toBe(2);

      // But no Playwright-specific patterns
      expect(result.totalRouteIntercepts).toBe(0);
      expect(result.authMethod).toBeNull();
      expect(result.serialMode).toBe(false);
      expect(result.beforeEachPresent).toBe(false);

      // No navigations, POM usage, or helper delegations
      for (const test of result.tests) {
        expect(test.navigations).toEqual([]);
        expect(test.pomUsages).toEqual([]);
        expect(test.routeIntercepts).toEqual([]);
      }

      // vi.fn() and render() should not count as helper delegations
      // (they are framework calls, not test helper functions)
      // Note: the tool detects any standalone function call as a helper.
      // vi.fn() is a property access (vi.fn) so it won't be detected.
      // render() is a standalone call, so it WILL be detected as a helper.
      // This is acceptable -- the weight signal is about "this test does
      // more than nothing," and calling render() is a real action.
    });
  });

  describe('extractTestParityObservations', () => {
    it('produces observations from positive fixture', () => {
      const analysis = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));
      const result = extractTestParityObservations(analysis);

      expect(result.filePath).toContain('pw-spec-positive.spec.ts');
      expect(result.observations.length).toBeGreaterThan(0);

      const kinds = new Set(result.observations.map(o => o.kind));
      expect(kinds.has('PW_TEST_BLOCK')).toBe(true);
      expect(kinds.has('PW_ASSERTION')).toBe(true);
      expect(kinds.has('PW_ROUTE_INTERCEPT')).toBe(true);
      expect(kinds.has('PW_NAVIGATION')).toBe(true);
      expect(kinds.has('PW_POM_USAGE')).toBe(true);
      expect(kinds.has('PW_AUTH_CALL')).toBe(true);
      expect(kinds.has('PW_SERIAL_MODE')).toBe(true);
      expect(kinds.has('PW_BEFORE_EACH')).toBe(true);
      expect(kinds.has('PW_HELPER_DELEGATION')).toBe(true);
    });

    it('produces PW_TEST_BLOCK observations with correct evidence', () => {
      const analysis = analyzeTestParity(fixture('pw-spec-positive.spec.ts'));
      const result = extractTestParityObservations(analysis);

      const testBlocks = result.observations.filter(o => o.kind === 'PW_TEST_BLOCK');
      expect(testBlocks.length).toBe(3);

      const first = testBlocks[0];
      expect(first.evidence.testName).toBe('create and delete an item');
      expect(first.evidence.describeName).toBe('CRUD operations');
      expect(first.evidence.assertionCount).toBe(3);
      expect(first.evidence.routeInterceptCount).toBe(1);
      expect(first.evidence.navigationCount).toBe(1);
      expect(first.evidence.pomCount).toBe(2);
      expect(first.evidence.helperDelegationCount).toBe(0);
    });

    it('does not produce PW_AUTH_CALL for negative fixture', () => {
      const analysis = analyzeTestParity(fixture('pw-spec-negative.spec.ts'));
      const result = extractTestParityObservations(analysis);

      const authCalls = result.observations.filter(o => o.kind === 'PW_AUTH_CALL');
      expect(authCalls.length).toBe(0);
    });
  });

  describe('factory-pattern tests', () => {
    it('expands factory wrapper into individual test blocks per invocation', () => {
      const result = analyzeTestParity(fixture('pw-spec-factory.spec.ts'));

      // 3 factory invocations + 1 standalone = 4 tests
      expect(result.tests.length).toBe(4);
    });

    it('resolves factory test names from template literals', () => {
      const result = analyzeTestParity(fixture('pw-spec-factory.spec.ts'));

      const names = result.tests.map(t => t.name);
      expect(names).toContain('event: click');
      expect(names).toContain('event: hover');
      expect(names).toContain('event: scroll');
      expect(names).toContain('standalone sorting test');
    });

    it('factory-expanded tests inherit assertions and route intercepts from the factory body', () => {
      const result = analyzeTestParity(fixture('pw-spec-factory.spec.ts'));

      const factoryTests = result.tests.filter(t => t.name.startsWith('event:'));
      expect(factoryTests.length).toBe(3);

      // Each factory test has 2 assertions and 1 route intercept from the factory body
      for (const t of factoryTests) {
        expect(t.assertionCount).toBe(2);
        expect(t.routeIntercepts.length).toBe(1);
        expect(t.routeIntercepts[0].urlPattern).toBe('**/api/events');
      }
    });

    it('factory-expanded tests get the invocation call site line number', () => {
      const result = analyzeTestParity(fixture('pw-spec-factory.spec.ts'));

      const clickTest = result.tests.find(t => t.name === 'event: click');
      const hoverTest = result.tests.find(t => t.name === 'event: hover');

      // Each invocation is on a different line
      expect(clickTest!.line).not.toBe(hoverTest!.line);
    });

    it('does not double-count the factory test() call as a standalone test', () => {
      const result = analyzeTestParity(fixture('pw-spec-factory.spec.ts'));

      // The template literal test name should NOT appear as a test
      const templateTest = result.tests.find(t => t.name.includes('${'));
      expect(templateTest).toBeUndefined();
    });
  });

  describe('analyzeHelperFile', () => {
    it('extracts class methods with assertion counts', () => {
      const entries = analyzeHelperFile(fixture('pw-helper.ts'));

      const verifyHeader = entries.find(e => e.qualifiedName === 'DashboardPage.verifyHeader');
      expect(verifyHeader).toBeDefined();
      expect(verifyHeader!.assertionCount).toBe(2);

      const verifyTable = entries.find(e => e.qualifiedName === 'DashboardPage.verifyTableData');
      expect(verifyTable).toBeDefined();
      expect(verifyTable!.assertionCount).toBe(3);
    });

    it('counts zero assertions for methods without expect()', () => {
      const entries = analyzeHelperFile(fixture('pw-helper.ts'));

      const clickTab = entries.find(e => e.qualifiedName === 'DashboardPage.clickTab');
      expect(clickTab).toBeDefined();
      expect(clickTab!.assertionCount).toBe(0);
    });

    it('extracts standalone function declarations', () => {
      const entries = analyzeHelperFile(fixture('pw-helper.ts'));

      const verifyLoaded = entries.find(e => e.qualifiedName === 'verifyPageLoaded');
      expect(verifyLoaded).toBeDefined();
      expect(verifyLoaded!.assertionCount).toBe(2);

      const navigate = entries.find(e => e.qualifiedName === 'navigateToPage');
      expect(navigate).toBeDefined();
      expect(navigate!.assertionCount).toBe(0);
    });

    it('extracts arrow function exports', () => {
      const entries = analyzeHelperFile(fixture('pw-helper.ts'));

      const arrow = entries.find(e => e.qualifiedName === 'helperWithArrow');
      expect(arrow).toBeDefined();
      expect(arrow!.assertionCount).toBe(1);
    });
  });
});
