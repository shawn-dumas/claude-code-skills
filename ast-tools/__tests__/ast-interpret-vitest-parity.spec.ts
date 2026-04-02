import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { interpretVitestParity, prettyPrint, main } from '../ast-interpret-vitest-parity';
import type { VtSpecInventory, VtParityReport, VtParityScore } from '../types';

function buildInventory(overrides: Partial<VtSpecInventory> = {}): VtSpecInventory {
  return {
    file: 'test.spec.ts',
    describes: [],
    tests: [],
    mocks: [],
    assertions: [],
    renders: [],
    fixtureImports: [],
    lifecycleHooks: [],
    ...overrides,
  };
}

describe('ast-interpret-vitest-parity', () => {
  describe('interpretVitestParity', () => {
    it('exact name match produces PARITY with high confidence', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders team member list', parentDescribe: null, assertionCount: 5, line: 10 }],
        assertions: [
          {
            matcher: 'toBeInTheDocument',
            target: 'screen.getByText("Alice")',
            negated: false,
            parentTest: 'renders team member list',
            line: 11,
          },
          {
            matcher: 'toBeInTheDocument',
            target: 'screen.getByText("Bob")',
            negated: false,
            parentTest: 'renders team member list',
            line: 12,
          },
          {
            matcher: 'toBeVisible',
            target: 'screen.getByRole("table")',
            negated: false,
            parentTest: 'renders team member list',
            line: 13,
          },
          { matcher: 'toHaveLength', target: 'rows', negated: false, parentTest: 'renders team member list', line: 14 },
          {
            matcher: 'toHaveTextContent',
            target: 'heading',
            negated: false,
            parentTest: 'renders team member list',
            line: 15,
          },
        ],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders team member list', parentDescribe: null, assertionCount: 5, line: 20 }],
        assertions: [
          {
            matcher: 'toBeInTheDocument',
            target: 'screen.getByText("Alice")',
            negated: false,
            parentTest: 'renders team member list',
            line: 21,
          },
          {
            matcher: 'toBeInTheDocument',
            target: 'screen.getByText("Bob")',
            negated: false,
            parentTest: 'renders team member list',
            line: 22,
          },
          {
            matcher: 'toBeVisible',
            target: 'screen.getByRole("table")',
            negated: false,
            parentTest: 'renders team member list',
            line: 23,
          },
          { matcher: 'toHaveLength', target: 'rows', negated: false, parentTest: 'renders team member list', line: 24 },
          {
            matcher: 'toHaveTextContent',
            target: 'heading',
            negated: false,
            parentTest: 'renders team member list',
            line: 25,
          },
        ],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.score.score).toBe(100);
      expect(report.score.parity).toBe(1);
      expect(report.matches[0].confidence).toBe('high');
      expect(report.matches[0].similarity).toBe(1.0);
    });

    it('fuzzy name match works for similar but not identical names', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders the team member list correctly', parentDescribe: null, assertionCount: 3, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders team member list with data', parentDescribe: null, assertionCount: 3, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.matches[0].status).toBe('PARITY');
      expect(report.matches[0].similarity).toBeGreaterThan(0.15);
      expect(report.matches[0].targetTest).toBe('renders team member list with data');
    });

    it('classifies REDUCED when target has fewer assertions', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'filters by role', parentDescribe: null, assertionCount: 10, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'filters by role', parentDescribe: null, assertionCount: 3, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.matches[0].status).toBe('REDUCED');
      expect(report.score.reduced).toBe(1);
      // Score: REDUCED contributes targetAssertions/sourceAssertions * weight
      // weight = max(10, 1) = 10
      // contributed = 3/10 * 10 = 3
      // total = 10
      // score = 3/10 * 100 = 30
      expect(report.score.score).toBe(30);
    });

    it('classifies EXPANDED when target has more assertions', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'sorts by name', parentDescribe: null, assertionCount: 2, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'sorts by name', parentDescribe: null, assertionCount: 8, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.matches[0].status).toBe('EXPANDED');
      expect(report.score.expanded).toBe(1);
      // EXPANDED gets full weight
      expect(report.score.score).toBe(100);
    });

    it('classifies NOT_PORTED when source test has no match', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'handles empty team', parentDescribe: null, assertionCount: 2, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.matches[0].status).toBe('NOT_PORTED');
      expect(report.score.notPorted).toBe(1);
      expect(report.score.score).toBe(0);
    });

    it('detects NOVEL target-only tests', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders header', parentDescribe: null, assertionCount: 2, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [
          { name: 'renders header', parentDescribe: null, assertionCount: 2, line: 20 },
          { name: 'renders loading skeleton', parentDescribe: null, assertionCount: 4, line: 30 },
          { name: 'renders error state', parentDescribe: null, assertionCount: 3, line: 40 },
        ],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.score.novel).toBe(2);
      // NOVEL is not in the score calculation
      expect(report.score.score).toBe(100);
    });

    it('computes score correctly for mixed statuses', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [
          { name: 'renders list', parentDescribe: null, assertionCount: 4, line: 10 },
          { name: 'filters data', parentDescribe: null, assertionCount: 6, line: 20 },
          { name: 'exports csv', parentDescribe: null, assertionCount: 5, line: 30 },
        ],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [
          // PARITY: same name, same assertions
          { name: 'renders list', parentDescribe: null, assertionCount: 4, line: 40 },
          // REDUCED: same name, fewer assertions (2/6 = 33%)
          { name: 'filters data', parentDescribe: null, assertionCount: 2, line: 50 },
          // 'exports csv' has no match -> NOT_PORTED
        ],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.score.parity).toBe(1);
      expect(report.score.reduced).toBe(1);
      expect(report.score.notPorted).toBe(1);

      // Weights: renders=4, filters=6, exports=5. Total=15
      // Matched: renders=4 (full), filters=2/6*6=2 (reduced), exports=0
      // Score = (4+2)/15 * 100 = 40
      expect(report.score.score).toBe(40);
    });

    it('greedy matching does not double-assign targets', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [
          { name: 'renders table with user data', parentDescribe: null, assertionCount: 3, line: 10 },
          { name: 'renders table with team data', parentDescribe: null, assertionCount: 3, line: 20 },
        ],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders table with user data', parentDescribe: null, assertionCount: 3, line: 30 }],
      });

      const report = interpretVitestParity([source], [target]);

      // Only one target test available -- first match takes it, second is NOT_PORTED
      const matchedTargets = report.matches.filter(m => m.targetTest !== null);
      expect(matchedTargets.length).toBe(1);

      const notPorted = report.matches.filter(m => m.status === 'NOT_PORTED');
      expect(notPorted.length).toBe(1);
    });

    it('produces sensible output with empty source and target', () => {
      const report = interpretVitestParity([], []);

      expect(report.matches.length).toBe(0);
      expect(report.score.score).toBe(0);
      expect(report.score.total).toBe(0);
      expect(report.score.novel).toBe(0);
      expect(report.sourceFiles).toEqual([]);
      expect(report.targetFiles).toEqual([]);
    });

    it('handles source with no matching target file', () => {
      const source = buildInventory({
        file: 'old-feature.spec.ts',
        tests: [{ name: 'test A', parentDescribe: null, assertionCount: 3, line: 10 }],
      });

      const target = buildInventory({
        file: 'new-feature.spec.ts',
        tests: [{ name: 'test B', parentDescribe: null, assertionCount: 3, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      // Source file has no matching target file, so all source tests are NOT_PORTED
      expect(report.matches[0].status).toBe('NOT_PORTED');
      // The entire target file is novel
      expect(report.score.novel).toBe(1);
    });

    it('matches tests using assertion target overlap when names diverge', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'checks visibility', parentDescribe: null, assertionCount: 3, line: 10 }],
        assertions: [
          {
            matcher: 'toBeVisible',
            target: 'screen.getByRole("heading")',
            negated: false,
            parentTest: 'checks visibility',
            line: 11,
          },
          {
            matcher: 'toBeInTheDocument',
            target: 'screen.getByText("Welcome")',
            negated: false,
            parentTest: 'checks visibility',
            line: 12,
          },
          { matcher: 'toHaveLength', target: 'items', negated: false, parentTest: 'checks visibility', line: 13 },
        ],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'displays correct elements', parentDescribe: null, assertionCount: 3, line: 20 }],
        assertions: [
          {
            matcher: 'toBeVisible',
            target: 'screen.getByRole("heading")',
            negated: false,
            parentTest: 'displays correct elements',
            line: 21,
          },
          {
            matcher: 'toBeInTheDocument',
            target: 'screen.getByText("Welcome")',
            negated: false,
            parentTest: 'displays correct elements',
            line: 22,
          },
          {
            matcher: 'toHaveLength',
            target: 'items',
            negated: false,
            parentTest: 'displays correct elements',
            line: 23,
          },
        ],
      });

      const report = interpretVitestParity([source], [target]);

      // Names diverge completely, but assertion targets overlap 100%
      expect(report.matches[0].targetTest).not.toBeNull();
      expect(report.matches[0].similarity).toBeGreaterThan(0);
    });

    it('matches tests using mock target overlap as fallback signal', () => {
      const source = buildInventory({
        file: 'hook.spec.ts',
        tests: [{ name: 'returns data on success', parentDescribe: null, assertionCount: 2, line: 10 }],
        mocks: [
          { mockTarget: '@/shared/lib/fetchApi', mockType: 'vi.mock', parentDescribe: null, line: 3 },
          { mockTarget: 'next/router', mockType: 'vi.mock', parentDescribe: null, line: 4 },
        ],
      });

      const target = buildInventory({
        file: 'hook.spec.ts',
        tests: [{ name: 'fetches and returns query data', parentDescribe: null, assertionCount: 2, line: 20 }],
        mocks: [
          { mockTarget: '@/shared/lib/fetchApi', mockType: 'vi.mock', parentDescribe: null, line: 13 },
          { mockTarget: 'next/router', mockType: 'vi.mock', parentDescribe: null, line: 14 },
        ],
      });

      const report = interpretVitestParity([source], [target]);

      // Names diverge, but mocks overlap significantly
      expect(report.matches[0].targetTest).not.toBeNull();
      expect(report.matches[0].similarity).toBeGreaterThan(0);
    });

    it('tests with 0 source assertions get weight of 1', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders without crashing', parentDescribe: null, assertionCount: 0, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders without crashing', parentDescribe: null, assertionCount: 0, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      // Weight = max(0, 1) = 1, both PARITY -> score = 100
      expect(report.score.total).toBe(1);
      expect(report.score.score).toBe(100);
    });

    it('handles describe prefix stripping in name matching', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders header', parentDescribe: 'MyComponent', assertionCount: 2, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'renders header', parentDescribe: 'MyComponent', assertionCount: 2, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      expect(report.matches[0].status).toBe('PARITY');
      expect(report.matches[0].similarity).toBe(1.0);
    });

    it('PARITY boundary: exactly 80% assertions produces PARITY', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'test A', parentDescribe: null, assertionCount: 10, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'test A', parentDescribe: null, assertionCount: 8, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      // 8/10 = 0.8, which is >= 0.8 threshold -> PARITY
      expect(report.matches[0].status).toBe('PARITY');
    });

    it('REDUCED boundary: 79% assertions produces REDUCED', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'test B', parentDescribe: null, assertionCount: 100, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'test B', parentDescribe: null, assertionCount: 79, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      // 79/100 = 0.79, which is < 0.8 threshold -> REDUCED
      expect(report.matches[0].status).toBe('REDUCED');
    });

    it('EXPANDED boundary: exactly 121% assertions produces EXPANDED', () => {
      const source = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'test C', parentDescribe: null, assertionCount: 100, line: 10 }],
      });

      const target = buildInventory({
        file: 'component.spec.ts',
        tests: [{ name: 'test C', parentDescribe: null, assertionCount: 121, line: 20 }],
      });

      const report = interpretVitestParity([source], [target]);

      // 121/100 = 1.21, which is > 1.2 threshold -> EXPANDED
      expect(report.matches[0].status).toBe('EXPANDED');
    });

    it('multi-file comparison matches files by path', () => {
      const source1 = buildInventory({
        file: 'src/ui/feature/Component.spec.ts',
        tests: [{ name: 'renders component', parentDescribe: null, assertionCount: 3, line: 10 }],
      });
      const source2 = buildInventory({
        file: 'src/ui/feature/Hook.spec.ts',
        tests: [{ name: 'returns data', parentDescribe: null, assertionCount: 2, line: 10 }],
      });

      const target1 = buildInventory({
        file: 'src/ui/feature/Component.spec.ts',
        tests: [{ name: 'renders component', parentDescribe: null, assertionCount: 3, line: 20 }],
      });
      const target2 = buildInventory({
        file: 'src/ui/feature/Hook.spec.ts',
        tests: [{ name: 'returns data', parentDescribe: null, assertionCount: 2, line: 20 }],
      });

      const report = interpretVitestParity([source1, source2], [target1, target2]);

      expect(report.score.score).toBe(100);
      expect(report.score.parity).toBe(2);
      expect(report.matches.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // prettyPrint
  // -------------------------------------------------------------------------

  describe('prettyPrint', () => {
    function buildScore(overrides: Partial<VtParityScore> = {}): VtParityScore {
      return {
        total: 5,
        matched: 5,
        parity: 1,
        reduced: 0,
        expanded: 0,
        notPorted: 0,
        novel: 0,
        score: 100,
        ...overrides,
      };
    }

    function buildReport(overrides: Partial<VtParityReport> = {}): VtParityReport {
      return {
        matches: [],
        score: buildScore(),
        sourceFiles: ['src/hook.spec.ts'],
        targetFiles: ['target/hook.spec.ts'],
        ...overrides,
      };
    }

    it('includes header', () => {
      const output = prettyPrint(buildReport(), 'src/', 'target/');
      expect(output).toContain('Test Parity Report (Vitest)');
    });

    it('includes source and target labels', () => {
      const output = prettyPrint(buildReport(), 'feature-branch:src/', 'integration/');
      expect(output).toContain('Source: feature-branch:src/');
      expect(output).toContain('Target: integration/');
    });

    it('includes score line', () => {
      const output = prettyPrint(buildReport({ score: buildScore({ score: 80, matched: 4, total: 5 }) }), 'a/', 'b/');
      expect(output).toContain('Score: 80');
    });

    it('renders PARITY matches', () => {
      const report = buildReport({
        matches: [
          {
            sourceTest: 'renders correctly',
            sourceFile: 'hook.spec.ts',
            targetTest: 'renders correctly',
            targetFile: 'target/hook.spec.ts',
            status: 'PARITY',
            sourceAssertions: 3,
            targetAssertions: 3,
            sourceMocks: [],
            targetMocks: [],
            confidence: 'high',
            similarity: 1.0,
          },
        ],
        score: buildScore({ parity: 1 }),
      });
      const output = prettyPrint(report, 'src/', 'target/');
      expect(output).toContain('PARITY (1)');
      expect(output).toContain('renders correctly');
    });

    it('renders EXPANDED matches', () => {
      const report = buildReport({
        matches: [
          {
            sourceTest: 'loads data',
            sourceFile: 'hook.spec.ts',
            targetTest: 'loads data',
            targetFile: 'target/hook.spec.ts',
            status: 'EXPANDED',
            sourceAssertions: 2,
            targetAssertions: 5,
            sourceMocks: [],
            targetMocks: [],
            confidence: 'high',
            similarity: 0.9,
          },
        ],
        score: buildScore({ expanded: 1 }),
      });
      const output = prettyPrint(report, 'src/', 'target/');
      expect(output).toContain('EXPANDED (1)');
    });

    it('renders REDUCED matches', () => {
      const report = buildReport({
        matches: [
          {
            sourceTest: 'filters by role',
            sourceFile: 'hook.spec.ts',
            targetTest: 'filters by role',
            targetFile: 'target/hook.spec.ts',
            status: 'REDUCED',
            sourceAssertions: 10,
            targetAssertions: 3,
            sourceMocks: [],
            targetMocks: [],
            confidence: 'high',
            similarity: 0.8,
          },
        ],
        score: buildScore({ reduced: 1 }),
      });
      const output = prettyPrint(report, 'src/', 'target/');
      expect(output).toContain('REDUCED (1)');
      expect(output).toContain('10 -> 3 assertions');
    });

    it('renders NOT_PORTED matches', () => {
      const report = buildReport({
        matches: [
          {
            sourceTest: 'exports csv data',
            sourceFile: 'hook.spec.ts',
            targetTest: null,
            targetFile: null,
            status: 'NOT_PORTED',
            sourceAssertions: 4,
            targetAssertions: 0,
            sourceMocks: [],
            targetMocks: [],
            confidence: 'high',
            similarity: 0,
          },
        ],
        score: buildScore({ notPorted: 1, score: 0, matched: 0 }),
      });
      const output = prettyPrint(report, 'src/', 'target/');
      expect(output).toContain('NOT_PORTED (1)');
      expect(output).toContain('assertions (lost)');
    });

    it('renders NOVEL count when present', () => {
      const report = buildReport({
        score: buildScore({ novel: 3, score: 100 }),
      });
      const output = prettyPrint(report, 'src/', 'target/');
      expect(output).toContain('NOVEL: 3');
    });

    it('truncates long test names', () => {
      const longName = 'b'.repeat(55);
      const report = buildReport({
        matches: [
          {
            sourceTest: longName,
            sourceFile: 'hook.spec.ts',
            targetTest: longName,
            targetFile: 'target/hook.spec.ts',
            status: 'PARITY',
            sourceAssertions: 1,
            targetAssertions: 1,
            sourceMocks: [],
            targetMocks: [],
            confidence: 'high',
            similarity: 1.0,
          },
        ],
        score: buildScore({ parity: 1 }),
      });
      const output = prettyPrint(report, 'src/', 'target/');
      expect(output).toContain('...');
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
      process.argv = ['node', 'ast-interpret-vitest-parity.ts', '--help'];
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdoutChunks.join('')).toContain('Usage:');
    });

    it('missing --source-dir exits 1 via fatal', () => {
      process.argv = ['node', 'ast-interpret-vitest-parity.ts', '--target-dir', '/some/dir'];
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('missing --target-dir exits 1 via fatal', () => {
      process.argv = ['node', 'ast-interpret-vitest-parity.ts', '--source-dir', '/some/dir'];
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid source-dir and target-dir produces JSON output', () => {
      const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-parity-src-'));
      const tgtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-parity-tgt-'));
      fs.writeFileSync(
        path.join(srcDir, 'feature.spec.ts'),
        `import { it, expect } from 'vitest';\nit('loads data', () => { expect(true).toBe(true); });\n`,
      );
      fs.writeFileSync(
        path.join(tgtDir, 'feature.spec.ts'),
        `import { it, expect } from 'vitest';\nit('loads data', () => { expect(true).toBe(true); });\n`,
      );
      try {
        process.argv = ['node', 'ast-interpret-vitest-parity.ts', '--source-dir', srcDir, '--target-dir', tgtDir];
        main();
        const out = stdoutChunks.join('');
        expect(JSON.parse(out)).toHaveProperty('matches');
      } finally {
        fs.rmSync(srcDir, { recursive: true });
        fs.rmSync(tgtDir, { recursive: true });
      }
    });

    it('--pretty flag produces formatted output', () => {
      const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-parity-src-'));
      const tgtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-parity-tgt-'));
      fs.writeFileSync(
        path.join(srcDir, 'hook.spec.ts'),
        `import { it, expect } from 'vitest';\nit('returns value', () => { expect(1).toBe(1); });\n`,
      );
      fs.writeFileSync(
        path.join(tgtDir, 'hook.spec.ts'),
        `import { it, expect } from 'vitest';\nit('returns value', () => { expect(1).toBe(1); });\n`,
      );
      try {
        process.argv = [
          'node',
          'ast-interpret-vitest-parity.ts',
          '--source-dir',
          srcDir,
          '--target-dir',
          tgtDir,
          '--pretty',
        ];
        main();
        const out = stdoutChunks.join('');
        expect(out).toContain('Test Parity Report');
      } finally {
        fs.rmSync(srcDir, { recursive: true });
        fs.rmSync(tgtDir, { recursive: true });
      }
    });
  });
});
