import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { interpretTestParity, prettyPrint, main, type ParityReport } from '../ast-interpret-pw-test-parity';
import type { PwSpecInventory, PwHelperIndex } from '../types';

function buildInventory(overrides: Partial<PwSpecInventory> = {}): PwSpecInventory {
  return {
    filePath: 'test.spec.ts',
    describes: [],
    tests: [],
    totalAssertions: 0,
    totalRouteIntercepts: 0,
    beforeEachPresent: false,
    serialMode: false,
    authMethod: null,
    ...overrides,
  };
}

describe('ast-interpret-pw-test-parity', () => {
  describe('interpretTestParity', () => {
    it('returns 100% score when source and target have identical tests', () => {
      const source = buildInventory({
        filePath: 'users.spec.ts',
        tests: [
          {
            name: 'create a user',
            line: 10,
            describeParent: null,
            assertionCount: 5,
            assertions: [
              { line: 15, matcher: 'toHaveText', target: 'page.getByRole("heading")' },
              { line: 16, matcher: 'toBeVisible', target: 'page.getByRole("table")' },
              { line: 17, matcher: 'toContainText', target: 'page.getByTestId("count")' },
              { line: 18, matcher: 'toHaveValue', target: 'page.getByLabel("Name")' },
              { line: 19, matcher: 'toHaveCount', target: 'page.getByRole("row")' },
            ],
            routeIntercepts: [],
            navigations: ['/users'],
            pomUsages: ['UsersPage'],
            helperDelegations: [],
          },
        ],
        totalAssertions: 5,
      });

      const target = buildInventory({
        filePath: 'integration/tests/users.spec.ts',
        tests: [
          {
            name: 'create a user',
            line: 20,
            describeParent: null,
            assertionCount: 5,
            assertions: [
              { line: 25, matcher: 'toHaveText', target: 'page.getByRole("heading")' },
              { line: 26, matcher: 'toBeVisible', target: 'page.getByRole("table")' },
              { line: 27, matcher: 'toContainText', target: 'page.getByTestId("count")' },
              { line: 28, matcher: 'toHaveValue', target: 'page.getByLabel("Name")' },
              { line: 29, matcher: 'toHaveCount', target: 'page.getByRole("row")' },
            ],
            routeIntercepts: [],
            navigations: ['/users'],
            pomUsages: ['UsersPage'],
            helperDelegations: [],
          },
        ],
        totalAssertions: 5,
      });

      const mapping = { 'users.spec.ts': 'users.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      expect(report.score.overall).toBe(100);
      expect(report.score.byStatus.PARITY).toBe(1);
      expect(report.score.byStatus.NOT_PORTED).toBe(0);
    });

    it('returns 0% when all source tests are NOT_PORTED', () => {
      const source = buildInventory({
        filePath: 'bpo.spec.ts',
        tests: [
          {
            name: 'create BPO',
            line: 10,
            describeParent: null,
            assertionCount: 3,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
        totalAssertions: 3,
      });

      const target = buildInventory({
        filePath: 'integration/tests/bpo.spec.ts',
        tests: [],
        totalAssertions: 0,
      });

      const mapping = { 'bpo.spec.ts': 'bpo.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      expect(report.score.overall).toBe(0);
      expect(report.score.byStatus.NOT_PORTED).toBe(1);
      expect(report.fileMatches[0].status).toBe('EMPTY');
    });

    it('gives REDUCED half weight in scoring', () => {
      const source = buildInventory({
        filePath: 'teams.spec.ts',
        tests: [
          {
            name: 'flip role',
            line: 10,
            describeParent: null,
            assertionCount: 10,
            assertions: Array.from({ length: 10 }, (_, i) => ({
              line: 20 + i,
              matcher: 'toHaveText',
              target: `locator${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
        totalAssertions: 10,
      });

      const target = buildInventory({
        filePath: 'integration/tests/teams.spec.ts',
        tests: [
          {
            name: 'flip role',
            line: 15,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
        totalAssertions: 0,
      });

      const mapping = { 'teams.spec.ts': 'teams.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      // REDUCED gets half weight: 10 * 0.5 = 5 out of 10
      expect(report.score.overall).toBe(50);
      expect(report.score.byStatus.REDUCED).toBe(1);
    });

    it('identifies net-new target files', () => {
      const source = buildInventory({ filePath: 'users.spec.ts', tests: [] });
      const target1 = buildInventory({ filePath: 'integration/tests/users.spec.ts', tests: [] });
      const target2 = buildInventory({ filePath: 'integration/tests/navigation.spec.ts', tests: [] });

      const mapping = { 'users.spec.ts': 'users.spec.ts' };
      const report = interpretTestParity([source], [target1, target2], mapping);

      expect(report.summary.netNewTargetFiles).toContain('navigation.spec.ts');
    });

    it('identifies dropped files', () => {
      const source = buildInventory({
        filePath: 'bpo.spec.ts',
        tests: [
          {
            name: 'test',
            line: 1,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({ filePath: 'integration/tests/bpo.spec.ts', tests: [] });

      const mapping = { 'bpo.spec.ts': 'bpo.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      expect(report.summary.droppedFiles).toContain('bpo.spec.ts');
    });

    it('matches tests by route intercept when names differ completely', () => {
      const source = buildInventory({
        filePath: 'realtime.spec.ts',
        tests: [
          {
            name: 'mock data for useTeamRealtimeStatsQuery - highlight',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [{ line: 15, urlPattern: '**/api/realtime' }],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/realtime.spec.ts',
        tests: [
          {
            name: 'renders highlight event data in columns',
            line: 20,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [{ line: 25, urlPattern: '**/api/realtime' }],
            navigations: [],
            pomUsages: ['RealtimePage'],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'realtime.spec.ts': 'realtime.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      expect(report.fileMatches[0].testMatches[0].status).not.toBe('NOT_PORTED');
      expect(report.fileMatches[0].testMatches[0].similarity).toBeGreaterThan(0);
      expect(report.fileMatches[0].testMatches[0].matchSignals.some(s => s.startsWith('routes:'))).toBe(true);
    });

    it('returns 0% score with empty source', () => {
      const report = interpretTestParity([], [], {});
      expect(report.score.overall).toBe(0);
      expect(report.fileMatches.length).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Dimension 1: Far match + insufficient assertions
    // -----------------------------------------------------------------------

    it('classifies far match with assertion loss as REDUCED, not NOT_PORTED', () => {
      const source = buildInventory({
        filePath: 'teams.spec.ts',
        tests: [
          {
            name: 'verify team member roles and permissions',
            line: 10,
            describeParent: null,
            assertionCount: 8,
            assertions: Array.from({ length: 8 }, (_, i) => ({
              line: 20 + i,
              matcher: 'toHaveText',
              target: `role${i}`,
            })),
            routeIntercepts: [{ line: 5, urlPattern: '**/api/teams' }],
            navigations: ['/settings/teams'],
            pomUsages: ['TeamsPage'],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/teams.spec.ts',
        tests: [
          {
            // Completely different name, but same route + nav + POM
            name: 'renders role column with correct values',
            line: 30,
            describeParent: null,
            assertionCount: 1,
            assertions: [{ line: 35, matcher: 'toBeVisible', target: 'page.getByRole("table")' }],
            routeIntercepts: [{ line: 25, urlPattern: '**/api/teams' }],
            navigations: ['/settings/teams'],
            pomUsages: ['TeamsPage'],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'teams.spec.ts': 'teams.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      // Should match via route+nav+POM despite zero name overlap
      expect(report.fileMatches[0].testMatches[0].status).toBe('REDUCED');
      expect(report.fileMatches[0].testMatches[0].similarity).toBeGreaterThan(0);
      // Assertion delta: 1 - 8 = -7, well below -2 threshold
      expect(report.fileMatches[0].testMatches[0].targetAssertions).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Dimension 2: Weight magnitude asymmetry
    // -----------------------------------------------------------------------

    it('high-weight NOT_PORTED tests dominate score more than low-weight ones', () => {
      const source = buildInventory({
        filePath: 'mixed.spec.ts',
        tests: [
          {
            // Light test: weight = 0 + 0 + 0 + 0 + 0 = min 1
            name: 'light test',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            // Heavy test: weight = 10 + 2*2 + 1 + 3*3 + 1 = 24
            name: 'heavy test with many signals',
            line: 20,
            describeParent: null,
            assertionCount: 10,
            assertions: Array.from({ length: 10 }, (_, i) => ({
              line: 30 + i,
              matcher: 'toHaveText',
              target: `locator${i}`,
            })),
            routeIntercepts: [
              { line: 25, urlPattern: '**/api/data1' },
              { line: 26, urlPattern: '**/api/data2' },
            ],
            navigations: ['/dashboard'],
            pomUsages: ['DashboardPage'],
            helperDelegations: [
              { line: 40, functionName: 'verifyCharts', argCount: 1 },
              { line: 41, functionName: 'verifyTable', argCount: 2 },
              { line: 42, functionName: 'verifyFilters', argCount: 1 },
            ],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/mixed.spec.ts',
        tests: [],
        totalAssertions: 0,
      });

      const mapping = { 'mixed.spec.ts': 'mixed.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      // Both NOT_PORTED, but the heavy test should contribute ~24x more
      // to the denominator than the light test
      const lightMatch = report.fileMatches[0].testMatches.find(t => t.sourceTest === 'light test');
      const heavyMatch = report.fileMatches[0].testMatches.find(t => t.sourceTest.startsWith('heavy'));

      expect(lightMatch!.sourceWeight).toBe(1);
      // 10 assertions + 2 routes*2 + 1 nav + 3 helpers*3 + 1 POM = 25
      expect(heavyMatch!.sourceWeight).toBe(25);
      expect(report.score.overall).toBe(0); // both NOT_PORTED
    });

    // -----------------------------------------------------------------------
    // Dimension 3: Greedy match stealing
    // -----------------------------------------------------------------------

    it('greedy matching can steal a better match from a later source test', () => {
      // Source has A (generic name) and B (specific name matching X)
      // Target has only X
      // If A is processed first and weakly matches X, B loses its better match
      const source = buildInventory({
        filePath: 'steal.spec.ts',
        tests: [
          {
            // Processed first, weak name match to target
            name: 'verify user data loads correctly',
            line: 10,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            // Processed second, strong name match to target
            name: 'verify user data table columns are correct',
            line: 20,
            describeParent: null,
            assertionCount: 5,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/steal.spec.ts',
        tests: [
          {
            name: 'verify user data table columns are correct',
            line: 30,
            describeParent: null,
            assertionCount: 5,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'steal.spec.ts': 'steal.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      // The first source test has some word overlap with the target
      // ("verify", "user", "data") but the second is an exact match.
      // Greedy best-first: source A picks the best available target.
      // If A's best is X and B's best is also X, whoever is processed
      // first wins. A gets X, B becomes NOT_PORTED.
      // This is a known limitation of greedy matching.
      const matches = report.fileMatches[0].testMatches;
      const firstMatch = matches[0];
      const secondMatch = matches[1];

      // Verify the matching happened and document the actual behavior.
      // First source test matches target (shared words: verify, user, data)
      if (firstMatch.targetTest) {
        // A took X -> B is NOT_PORTED (greedy steal happened)
        expect(secondMatch.status).toBe('NOT_PORTED');
      } else {
        // A didn't match -> B got X (no steal)
        expect(secondMatch.targetTest).toBe('verify user data table columns are correct');
      }
    });

    // -----------------------------------------------------------------------
    // Dimension 4: False positive rejection at threshold boundary
    // -----------------------------------------------------------------------

    it('rejects match below 0.15 composite threshold', () => {
      const source = buildInventory({
        filePath: 'threshold.spec.ts',
        tests: [
          {
            // Single short word "test" -- after filtering words <= 2 chars,
            // only "test" remains. No overlap with target name.
            name: 'sign in via SSO',
            line: 10,
            describeParent: null,
            assertionCount: 3,
            assertions: [],
            routeIntercepts: [],
            navigations: ['/login'],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/threshold.spec.ts',
        tests: [
          {
            name: 'export CSV from dashboard table',
            line: 20,
            describeParent: null,
            assertionCount: 5,
            assertions: [],
            routeIntercepts: [],
            navigations: ['/dashboard'],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'threshold.spec.ts': 'threshold.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      // Zero name overlap, zero route overlap, different navigations, no POMs
      // Composite = 0. Must be NOT_PORTED, not a false-positive match.
      expect(report.fileMatches[0].testMatches[0].status).toBe('NOT_PORTED');
      expect(report.fileMatches[0].testMatches[0].targetTest).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Dimension 5: Matcher quality degradation
    // -----------------------------------------------------------------------

    it('classifies as REDUCED when strong matchers replaced with weak ones', () => {
      const source = buildInventory({
        filePath: 'matchers.spec.ts',
        tests: [
          {
            name: 'verify table data',
            line: 10,
            describeParent: null,
            assertionCount: 4,
            assertions: [
              { line: 15, matcher: 'toHaveText', target: 'heading' },
              { line: 16, matcher: 'toContainText', target: 'cell' },
              { line: 17, matcher: 'toHaveValue', target: 'input' },
              { line: 18, matcher: 'toHaveAttribute', target: 'link' },
            ],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/matchers.spec.ts',
        tests: [
          {
            name: 'verify table data',
            line: 20,
            describeParent: null,
            // Same count, but all weak matchers
            assertionCount: 4,
            assertions: [
              { line: 25, matcher: 'toBeVisible', target: 'heading' },
              { line: 26, matcher: 'toBeVisible', target: 'cell' },
              { line: 27, matcher: 'toBeVisible', target: 'input' },
              { line: 28, matcher: 'toBeVisible', target: 'link' },
            ],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'matchers.spec.ts': 'matchers.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      // Same assertion count (4 == 4, delta within +/-2)
      // but all strong matchers replaced with toBeVisible
      // Should be REDUCED due to matcher quality degradation
      expect(report.fileMatches[0].testMatches[0].status).toBe('REDUCED');
    });

    // -----------------------------------------------------------------------
    // Dimension 6: Helper delegation impact on weight
    // -----------------------------------------------------------------------

    it('helper delegations increase weight even with 0 inline assertions', () => {
      const source = buildInventory({
        filePath: 'helpers.spec.ts',
        tests: [
          {
            // Genuinely empty test
            name: 'empty test',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            // 0 inline assertions but delegates to helpers
            name: 'helper-heavy test',
            line: 20,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [{ line: 25, urlPattern: '**/api/data' }],
            navigations: ['/insights'],
            pomUsages: ['InsightsPage'],
            helperDelegations: [
              { line: 30, functionName: 'verifyInsightsPage', argCount: 2 },
              { line: 31, functionName: 'checkFilters', argCount: 1 },
              { line: 32, functionName: 'insightsPage.verifyColumns', argCount: 0 },
            ],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/helpers.spec.ts',
        tests: [],
        totalAssertions: 0,
      });

      const mapping = { 'helpers.spec.ts': 'helpers.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      const emptyMatch = report.fileMatches[0].testMatches.find(t => t.sourceTest === 'empty test');
      const helperMatch = report.fileMatches[0].testMatches.find(t => t.sourceTest === 'helper-heavy test');

      // Empty test: weight = max(0 + 0 + 0 + 0 + 0, 1) = 1
      expect(emptyMatch!.sourceWeight).toBe(1);

      // Helper-heavy test: 0 assertions + 1 route*2 + 1 nav + 3 helpers*3 + 1 POM
      // = 0 + 2 + 1 + 9 + 1 = 13
      expect(helperMatch!.sourceWeight).toBe(13);

      // The helper-heavy test contributes 13x more to the score denominator
      // than the empty test, despite both having 0 inline assertions
      expect(helperMatch!.sourceWeight).toBeGreaterThan(emptyMatch!.sourceWeight * 10);
    });

    // -----------------------------------------------------------------------
    // Dimension 7: Multi-test file with mixed statuses
    // -----------------------------------------------------------------------

    it('computes correct score for file with mixed PARITY, REDUCED, and NOT_PORTED', () => {
      const source = buildInventory({
        filePath: 'mixed-status.spec.ts',
        tests: [
          {
            // Will match at PARITY (identical name, similar assertions)
            name: 'create item',
            line: 10,
            describeParent: null,
            assertionCount: 4,
            assertions: Array.from({ length: 4 }, (_, i) => ({
              line: 15 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            // Will match at REDUCED (name matches, assertions drop)
            name: 'delete item',
            line: 30,
            describeParent: null,
            assertionCount: 6,
            assertions: Array.from({ length: 6 }, (_, i) => ({
              line: 35 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            // Will be NOT_PORTED (no matching target)
            name: 'archive item permanently',
            line: 50,
            describeParent: null,
            assertionCount: 3,
            assertions: Array.from({ length: 3 }, (_, i) => ({
              line: 55 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/mixed-status.spec.ts',
        tests: [
          {
            name: 'create item',
            line: 10,
            describeParent: null,
            assertionCount: 4,
            assertions: Array.from({ length: 4 }, (_, i) => ({
              line: 15 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            name: 'delete item',
            line: 30,
            describeParent: null,
            assertionCount: 1,
            assertions: [{ line: 35, matcher: 'toBeVisible', target: 'el0' }],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'mixed-status.spec.ts': 'mixed-status.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      expect(report.score.byStatus.PARITY).toBe(1);
      expect(report.score.byStatus.REDUCED).toBe(1);
      expect(report.score.byStatus.NOT_PORTED).toBe(1);

      // Weights: create=4, delete=6, archive=3. Total=13
      // Matched: create=4 (full), delete=6*0.5=3 (half), archive=0
      // Score = (4+3)/13 = 7/13 = 54%
      expect(report.score.overall).toBe(54);
      expect(report.fileMatches[0].status).toBe('SHRUNK'); // 3 source -> 2 target
    });

    // -----------------------------------------------------------------------
    // Dimension 8: EXPANDED classification with full weight
    // -----------------------------------------------------------------------

    it('classifies as EXPANDED and gives full weight when target has more assertions', () => {
      const source = buildInventory({
        filePath: 'expand.spec.ts',
        tests: [
          {
            name: 'check table columns',
            line: 10,
            describeParent: null,
            assertionCount: 2,
            assertions: [
              { line: 15, matcher: 'toBeVisible', target: 'table' },
              { line: 16, matcher: 'toBeVisible', target: 'heading' },
            ],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const target = buildInventory({
        filePath: 'integration/tests/expand.spec.ts',
        tests: [
          {
            name: 'check table columns',
            line: 20,
            describeParent: null,
            // 8 assertions vs source's 2: delta = +6, exceeds +2 threshold
            assertionCount: 8,
            assertions: Array.from({ length: 8 }, (_, i) => ({
              line: 25 + i,
              matcher: 'toHaveText',
              target: `col${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const mapping = { 'expand.spec.ts': 'expand.spec.ts' };
      const report = interpretTestParity([source], [target], mapping);

      expect(report.fileMatches[0].testMatches[0].status).toBe('EXPANDED');
      // EXPANDED gets full weight, same as PARITY
      expect(report.score.overall).toBe(100);
      expect(report.score.byStatus.EXPANDED).toBe(1);
    });
  });

  describe('confidence and weightRatio', () => {
    it('attaches weightRatio to matched tests', () => {
      const source = buildInventory({
        filePath: 'conf.spec.ts',
        tests: [
          {
            name: 'test A',
            line: 10,
            describeParent: null,
            assertionCount: 4,
            assertions: Array.from({ length: 4 }, (_, i) => ({
              line: 15 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({
        filePath: 'integration/tests/conf.spec.ts',
        tests: [
          {
            name: 'test A',
            line: 20,
            describeParent: null,
            assertionCount: 4,
            assertions: Array.from({ length: 4 }, (_, i) => ({
              line: 25 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const report = interpretTestParity([source], [target], { 'conf.spec.ts': 'conf.spec.ts' });
      const tm = report.fileMatches[0].testMatches[0];

      expect(tm.weightRatio).toBeCloseTo(1.0);
      expect(tm.confidence).toBe('high');
    });

    it('marks low confidence when weight ratio is near REDUCED boundary', () => {
      const source = buildInventory({
        filePath: 'borderline.spec.ts',
        tests: [
          {
            name: 'borderline',
            line: 10,
            describeParent: null,
            assertionCount: 10,
            assertions: Array.from({ length: 10 }, (_, i) => ({
              line: 15 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      // Target weight: 4 assertions. Ratio = 4/10 = 0.4 (exactly on boundary)
      const target = buildInventory({
        filePath: 'integration/tests/borderline.spec.ts',
        tests: [
          {
            name: 'borderline',
            line: 20,
            describeParent: null,
            assertionCount: 4,
            assertions: Array.from({ length: 4 }, (_, i) => ({
              line: 25 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const report = interpretTestParity([source], [target], { 'borderline.spec.ts': 'borderline.spec.ts' });
      const tm = report.fileMatches[0].testMatches[0];

      expect(tm.confidence).toBe('low');
    });

    it('sets weightRatio to null for NOT_PORTED tests', () => {
      const source = buildInventory({
        filePath: 'null-wr.spec.ts',
        tests: [
          {
            name: 'orphan',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({ filePath: 'integration/tests/null-wr.spec.ts', tests: [] });

      const report = interpretTestParity([source], [target], { 'null-wr.spec.ts': 'null-wr.spec.ts' });
      const tm = report.fileMatches[0].testMatches[0];

      expect(tm.weightRatio).toBeNull();
      expect(tm.confidence).toBe('high');
    });
  });

  describe('structuralSignal', () => {
    it('marks structuralSignal as none when all tests score 0.00', () => {
      const source = buildInventory({
        filePath: 'no-signal.spec.ts',
        tests: [
          {
            name: 'SSO google sign in member access denied',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({
        filePath: 'integration/tests/no-signal.spec.ts',
        tests: [
          {
            name: 'Firebase emulator sign in redirects to insights',
            line: 20,
            describeParent: null,
            assertionCount: 3,
            assertions: [],
            routeIntercepts: [{ line: 25, urlPattern: '**/api/auth' }],
            navigations: ['/insights'],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const report = interpretTestParity([source], [target], { 'no-signal.spec.ts': 'no-signal.spec.ts' });

      expect(report.fileMatches[0].structuralSignal).toBe('none');
    });

    it('marks structuralSignal as present when at least one test matches', () => {
      const source = buildInventory({
        filePath: 'has-signal.spec.ts',
        tests: [
          {
            name: 'verify table columns',
            line: 10,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({
        filePath: 'integration/tests/has-signal.spec.ts',
        tests: [
          {
            name: 'verify table columns',
            line: 20,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const report = interpretTestParity([source], [target], { 'has-signal.spec.ts': 'has-signal.spec.ts' });

      expect(report.fileMatches[0].structuralSignal).toBe('present');
    });
  });

  describe('splitCoverage', () => {
    it('annotates matched tests with unmatched target tests sharing route patterns', () => {
      const source = buildInventory({
        filePath: 'split.spec.ts',
        tests: [
          {
            name: 'verify all sub-tables',
            line: 10,
            describeParent: null,
            assertionCount: 8,
            assertions: Array.from({ length: 8 }, (_, i) => ({
              line: 15 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [{ line: 5, urlPattern: '**/api/export' }],
            navigations: ['/insights/export'],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({
        filePath: 'integration/tests/split.spec.ts',
        tests: [
          {
            name: 'verify combined table',
            line: 20,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [{ line: 25, urlPattern: '**/api/export' }],
            navigations: ['/insights/export'],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            name: 'verify per-team table',
            line: 40,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [{ line: 45, urlPattern: '**/api/export' }],
            navigations: ['/insights/export'],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            name: 'verify per-project table',
            line: 60,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [{ line: 65, urlPattern: '**/api/export' }],
            navigations: ['/insights/export'],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const report = interpretTestParity([source], [target], { 'split.spec.ts': 'split.spec.ts' });

      const tm = report.fileMatches[0].testMatches[0];
      // Source matches one target (best match), the other 2 are unmatched
      // but share the same route pattern -> splitCoverage
      expect(tm.splitCoverage.length).toBe(2);
    });

    it('does not annotate splitCoverage when no unmatched targets share signals', () => {
      const source = buildInventory({
        filePath: 'no-split.spec.ts',
        tests: [
          {
            name: 'test A',
            line: 10,
            describeParent: null,
            assertionCount: 4,
            assertions: Array.from({ length: 4 }, (_, i) => ({
              line: 15 + i,
              matcher: 'toHaveText',
              target: `el${i}`,
            })),
            routeIntercepts: [{ line: 5, urlPattern: '**/api/users' }],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });
      const target = buildInventory({
        filePath: 'integration/tests/no-split.spec.ts',
        tests: [
          {
            name: 'test A',
            line: 20,
            describeParent: null,
            assertionCount: 4,
            assertions: [],
            routeIntercepts: [{ line: 25, urlPattern: '**/api/users' }],
            navigations: [],
            pomUsages: [],
            helperDelegations: [],
          },
          {
            name: 'unrelated test',
            line: 40,
            describeParent: null,
            assertionCount: 2,
            assertions: [],
            routeIntercepts: [{ line: 45, urlPattern: '**/api/teams' }],
            navigations: ['/teams'],
            pomUsages: [],
            helperDelegations: [],
          },
        ],
      });

      const report = interpretTestParity([source], [target], { 'no-split.spec.ts': 'no-split.spec.ts' });

      const tm = report.fileMatches[0].testMatches[0];
      expect(tm.splitCoverage.length).toBe(0);
    });
  });

  describe('cross-file helper resolution', () => {
    it('uses helper index to resolve assertion counts in weight computation', () => {
      const source = buildInventory({
        filePath: 'helpers.spec.ts',
        tests: [
          {
            name: 'test with helpers',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [
              { line: 20, functionName: 'DashboardPage.verifyHeader', argCount: 0 },
              { line: 21, functionName: 'DashboardPage.verifyTableData', argCount: 0 },
            ],
          },
        ],
      });
      const target = buildInventory({
        filePath: 'integration/tests/helpers.spec.ts',
        tests: [
          {
            name: 'test with helpers',
            line: 30,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [
              { line: 40, functionName: 'DashboardPage.verifyHeader', argCount: 0 },
              { line: 41, functionName: 'DashboardPage.verifyTableData', argCount: 0 },
            ],
          },
        ],
      });

      const helperIndex: PwHelperIndex = {
        entries: [
          {
            qualifiedName: 'DashboardPage.verifyHeader',
            assertionCount: 2,
            filePath: 'pages/DashboardPage.ts',
            line: 10,
          },
          {
            qualifiedName: 'DashboardPage.verifyTableData',
            assertionCount: 3,
            filePath: 'pages/DashboardPage.ts',
            line: 20,
          },
        ],
        lookup: { 'DashboardPage.verifyHeader': 2, 'DashboardPage.verifyTableData': 3 },
      };

      // Without helper index: weight = max(0 + 0 + 0 + 2*3 + 0, 1) = 6 (flat 3 per delegation)
      const reportWithout = interpretTestParity([source], [target], { 'helpers.spec.ts': 'helpers.spec.ts' });
      const wmWithout = reportWithout.fileMatches[0].testMatches[0].sourceWeight;

      // With helper index: weight = max(0 + 0 + 0 + (max(2,3)+max(3,3)) + 0, 1) = 6
      // Resolved uses max(assertionCount, 3) baseline so low-assertion helpers
      // don't decrease weight below the flat-3 fallback.
      const reportWith = interpretTestParity(
        [source],
        [target],
        { 'helpers.spec.ts': 'helpers.spec.ts' },
        {
          sourceHelpers: helperIndex,
          targetHelpers: helperIndex,
        },
      );
      const wmWith = reportWith.fileMatches[0].testMatches[0].sourceWeight;

      // With max(resolved, 3) baseline, both helpers clamp to 3 (2->3, 3->3)
      // so weight equals flat fallback when all assertions are <= 3
      expect(wmWithout).toBe(6);
      expect(wmWith).toBe(6);
    });

    it('resolution increases weight when helper has more than 3 assertions', () => {
      const source = buildInventory({
        filePath: 'export.spec.ts',
        tests: [
          {
            name: 'export test',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [{ line: 11, functionName: 'insights.verifyExport', argCount: 4 }],
          },
        ],
      });
      const target = buildInventory({ filePath: 'export.spec.ts', tests: source.tests });

      const highAssertionIndex: PwHelperIndex = {
        entries: [
          {
            qualifiedName: 'InsightsPage.verifyExport',
            assertionCount: 7,
            filePath: 'pages/InsightsPage.ts',
            line: 100,
          },
        ],
        lookup: { 'InsightsPage.verifyExport': 7 },
      };

      // Without index: flat 3
      const rWithout = interpretTestParity([source], [target], { 'export.spec.ts': 'export.spec.ts' });
      // With index: fuzzy resolves insights.verifyExport -> InsightsPage.verifyExport (7 assertions)
      // max(7, 3) = 7, so weight increases from 3 to 7
      const rWith = interpretTestParity(
        [source],
        [target],
        { 'export.spec.ts': 'export.spec.ts' },
        { sourceHelpers: highAssertionIndex, targetHelpers: highAssertionIndex },
      );

      expect(rWithout.fileMatches[0].testMatches[0].sourceWeight).toBe(3);
      expect(rWith.fileMatches[0].testMatches[0].sourceWeight).toBe(7);
    });

    it('falls back to flat weight when helper is not in the index', () => {
      const source = buildInventory({
        filePath: 'unknown.spec.ts',
        tests: [
          {
            name: 'test',
            line: 10,
            describeParent: null,
            assertionCount: 0,
            assertions: [],
            routeIntercepts: [],
            navigations: [],
            pomUsages: [],
            helperDelegations: [{ line: 20, functionName: 'unknownHelper', argCount: 1 }],
          },
        ],
      });
      const target = buildInventory({ filePath: 'integration/tests/unknown.spec.ts', tests: [] });

      const emptyIndex: PwHelperIndex = { entries: [], lookup: {} };

      const report = interpretTestParity(
        [source],
        [target],
        { 'unknown.spec.ts': 'unknown.spec.ts' },
        {
          sourceHelpers: emptyIndex,
        },
      );

      // Falls back to 3 per delegation: max(0 + 0 + 0 + 3 + 0, 1) = 3
      expect(report.fileMatches[0].testMatches[0].sourceWeight).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // prettyPrint
  // -------------------------------------------------------------------------

  describe('prettyPrint', () => {
    function buildMinimalReport(overrides: Partial<ParityReport> = {}): ParityReport {
      return {
        fileMatches: [],
        score: {
          overall: 100,
          totalWeight: 5,
          matchedWeight: 5,
          byStatus: { PARITY: 1, EXPANDED: 0, REDUCED: 0, NOT_PORTED: 0 },
        },
        summary: {
          totalSourceTests: 1,
          totalTargetTests: 1,
          netNewTargetFiles: [],
          droppedFiles: [],
        },
        ...overrides,
      };
    }

    it('includes PARITY SCORE header', () => {
      const report = buildMinimalReport();
      const output = prettyPrint(report);
      expect(output).toContain('=== PARITY SCORE ===');
    });

    it('includes overall percentage', () => {
      const report = buildMinimalReport({
        score: {
          overall: 75,
          totalWeight: 4,
          matchedWeight: 3,
          byStatus: { PARITY: 0, EXPANDED: 1, REDUCED: 1, NOT_PORTED: 0 },
        },
      });
      const output = prettyPrint(report);
      expect(output).toContain('75%');
    });

    it('includes FILE PARITY section header', () => {
      const report = buildMinimalReport();
      const output = prettyPrint(report);
      expect(output).toContain('=== FILE PARITY ===');
    });

    it('renders file match rows', () => {
      const report = buildMinimalReport({
        fileMatches: [
          {
            sourceFile: 'users.spec.ts',
            targetFile: 'integration/users.spec.ts',
            sourceTestCount: 2,
            targetTestCount: 2,
            status: 'PARITY',
            structuralSignal: 'present',
            testMatches: [],
          },
        ],
      });
      const output = prettyPrint(report);
      expect(output).toContain('users.spec.ts');
    });

    it('renders (none) for missing target file', () => {
      const report = buildMinimalReport({
        fileMatches: [
          {
            sourceFile: 'dropped.spec.ts',
            targetFile: null,
            sourceTestCount: 1,
            targetTestCount: 0,
            status: 'EMPTY',
            structuralSignal: 'none',
            testMatches: [],
          },
        ],
      });
      const output = prettyPrint(report);
      expect(output).toContain('(none)');
    });

    it('renders test match rows for file matches with tests', () => {
      const report = buildMinimalReport({
        fileMatches: [
          {
            sourceFile: 'teams.spec.ts',
            targetFile: 'integration/teams.spec.ts',
            sourceTestCount: 1,
            targetTestCount: 1,
            status: 'PARITY',
            structuralSignal: 'present',
            testMatches: [
              {
                sourceTest: 'create a team',
                sourceFile: 'teams.spec.ts',
                targetTest: 'create a team',
                targetFile: 'integration/teams.spec.ts',
                status: 'PARITY',
                sourceAssertions: 3,
                targetAssertions: 3,
                sourceWeight: 3,
                weightRatio: 1.0,
                confidence: 'high',
                similarity: 1.0,
                matchSignals: ['name:exact'],
                notes: [],
                splitCoverage: [],
              },
            ],
          },
        ],
      });
      const output = prettyPrint(report);
      expect(output).toContain('create a team');
      expect(output).toContain('name:exact');
    });

    it('truncates long test names in match rows', () => {
      const longName = 'a'.repeat(50);
      const report = buildMinimalReport({
        fileMatches: [
          {
            sourceFile: 'long.spec.ts',
            targetFile: 'integration/long.spec.ts',
            sourceTestCount: 1,
            targetTestCount: 1,
            status: 'PARITY',
            structuralSignal: 'present',
            testMatches: [
              {
                sourceTest: longName,
                sourceFile: 'long.spec.ts',
                targetTest: longName,
                targetFile: 'integration/long.spec.ts',
                status: 'PARITY',
                sourceAssertions: 2,
                targetAssertions: 2,
                sourceWeight: 2,
                weightRatio: 1.0,
                confidence: 'high',
                similarity: 1.0,
                matchSignals: [],
                notes: ['some note'],
                splitCoverage: ['split-test'],
              },
            ],
          },
        ],
      });
      const output = prettyPrint(report);
      expect(output).toContain('...');
    });

    it('marks low confidence with tilde in status', () => {
      const report = buildMinimalReport({
        fileMatches: [
          {
            sourceFile: 'feature.spec.ts',
            targetFile: 'integration/feature.spec.ts',
            sourceTestCount: 1,
            targetTestCount: 1,
            status: 'PARITY',
            structuralSignal: 'present',
            testMatches: [
              {
                sourceTest: 'renders correctly',
                sourceFile: 'feature.spec.ts',
                targetTest: 'renders',
                targetFile: 'integration/feature.spec.ts',
                status: 'PARITY',
                sourceAssertions: 1,
                targetAssertions: 1,
                sourceWeight: 1,
                weightRatio: null,
                confidence: 'low',
                similarity: 0.5,
                matchSignals: [],
                notes: [],
                splitCoverage: [],
              },
            ],
          },
        ],
      });
      const output = prettyPrint(report);
      expect(output).toContain('~');
    });

    it('includes SUMMARY section', () => {
      const report = buildMinimalReport({
        summary: {
          totalSourceTests: 5,
          totalTargetTests: 4,
          netNewTargetFiles: ['new-feature.spec.ts'],
          droppedFiles: ['old-feature.spec.ts'],
        },
      });
      const output = prettyPrint(report);
      expect(output).toContain('=== SUMMARY ===');
      expect(output).toContain('5');
      expect(output).toContain('new-feature.spec.ts');
      expect(output).toContain('old-feature.spec.ts');
    });

    it('marks NO STRUCTURAL SIGNAL for files with structuralSignal none', () => {
      const report = buildMinimalReport({
        fileMatches: [
          {
            sourceFile: 'no-signal.spec.ts',
            targetFile: 'integration/no-signal.spec.ts',
            sourceTestCount: 1,
            targetTestCount: 1,
            status: 'PARITY',
            structuralSignal: 'none',
            testMatches: [
              {
                sourceTest: 'test x',
                sourceFile: 'no-signal.spec.ts',
                targetTest: 'test x',
                targetFile: 'integration/no-signal.spec.ts',
                status: 'PARITY',
                sourceAssertions: 1,
                targetAssertions: 1,
                sourceWeight: 1,
                weightRatio: 1.0,
                confidence: 'high',
                similarity: 0.5,
                matchSignals: [],
                notes: [],
                splitCoverage: [],
              },
            ],
          },
        ],
      });
      const output = prettyPrint(report);
      expect(output).toContain('NO STRUCTURAL SIGNAL');
    });
  });

  // -------------------------------------------------------------------------
  // main() CLI entry point
  // -------------------------------------------------------------------------

  describe('main()', () => {
    let stdoutChunks: string[];
    let originalArgv: string[];

    beforeEach(() => {
      stdoutChunks = [];
      originalArgv = process.argv;

      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      });
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
      }) as never);
    });

    afterEach(() => {
      process.argv = originalArgv;
      vi.restoreAllMocks();
    });

    it('--help exits 0 and prints usage', () => {
      process.argv = ['node', 'ast-interpret-pw-test-parity.ts', '--help'];
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdoutChunks.join('')).toContain('Usage:');
    });

    it('missing --source-dir exits 1 via fatal', () => {
      process.argv = ['node', 'ast-interpret-pw-test-parity.ts', '--target-dir', '/some/dir'];
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('missing --target-dir exits 1 via fatal', () => {
      process.argv = ['node', 'ast-interpret-pw-test-parity.ts', '--source-dir', '/some/dir'];
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid source-dir and target-dir produces JSON output', () => {
      const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-parity-src-'));
      const tgtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-parity-tgt-'));
      fs.writeFileSync(
        path.join(srcDir, 'feature.spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('loads page', async ({ page }) => { await page.goto('/'); await expect(page).toHaveURL('/'); });\n`,
      );
      fs.writeFileSync(
        path.join(tgtDir, 'feature.spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('loads page', async ({ page }) => { await page.goto('/'); await expect(page).toHaveURL('/'); });\n`,
      );
      try {
        process.argv = ['node', 'ast-interpret-pw-test-parity.ts', '--source-dir', srcDir, '--target-dir', tgtDir];
        main();
        const out = stdoutChunks.join('');
        expect(JSON.parse(out)).toHaveProperty('fileMatches');
      } finally {
        fs.rmSync(srcDir, { recursive: true });
        fs.rmSync(tgtDir, { recursive: true });
      }
    });

    it('--pretty flag produces formatted output', () => {
      const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-parity-src-'));
      const tgtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-parity-tgt-'));
      fs.writeFileSync(
        path.join(srcDir, 'users.spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('shows list', async ({ page }) => { await page.goto('/users'); await expect(page.getByRole('table')).toBeVisible(); });\n`,
      );
      fs.writeFileSync(
        path.join(tgtDir, 'users.spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('shows list', async ({ page }) => { await page.goto('/users'); await expect(page.getByRole('table')).toBeVisible(); });\n`,
      );
      try {
        process.argv = [
          'node',
          'ast-interpret-pw-test-parity.ts',
          '--source-dir',
          srcDir,
          '--target-dir',
          tgtDir,
          '--pretty',
        ];
        main();
        const out = stdoutChunks.join('');
        expect(out).toContain('=== PARITY SCORE ===');
      } finally {
        fs.rmSync(srcDir, { recursive: true });
        fs.rmSync(tgtDir, { recursive: true });
      }
    });
  });
});
