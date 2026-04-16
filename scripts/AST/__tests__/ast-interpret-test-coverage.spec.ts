import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { interpretTestCoverage, groupByDirectory, computeDirectoryStats, main } from '../ast-interpret-test-coverage';
import { analyzeTestCoverageDirectory, extractTestCoverageObservations } from '../ast-test-coverage';
import type { TestCoverageObservation } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixtureDir(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// ---------------------------------------------------------------------------
// Helper: build a TEST_COVERAGE observation
// ---------------------------------------------------------------------------

function makeObs(
  file: string,
  coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED',
  risk: 'HIGH' | 'MEDIUM' | 'LOW',
  suggestedPriority: 'P2' | 'P3' | 'P4',
  riskScore = 3.0,
): TestCoverageObservation {
  return {
    kind: 'TEST_COVERAGE',
    file,
    line: 1,
    evidence: {
      specFile: coverage === 'TESTED' ? `${file.replace('.ts', '.spec.ts')}` : null,
      indirectSpecs: coverage === 'INDIRECTLY_TESTED' ? ['some.spec.ts'] : [],
      coverage,
      riskScore,
      risk,
      suggestedPriority,
      maxCC: 10,
      lineCount: 200,
      consumerCount: 5,
    },
  };
}

// ---------------------------------------------------------------------------
// Core emission rules
// ---------------------------------------------------------------------------

describe('ast-interpret-test-coverage', () => {
  describe('emission rules', () => {
    it('HIGH risk + UNTESTED -> emits TEST_GAP with P2', () => {
      const observations = [makeObs('src/containers/FooContainer.ts', 'UNTESTED', 'HIGH', 'P2', 4.0)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('TEST_GAP');
      expect(result.assessments[0].coverage).toBe('UNTESTED');
      expect(result.assessments[0].risk).toBe('HIGH');
      expect(result.assessments[0].suggestedPriority).toBe('P2');
      expect(result.assessments[0].confidence).toBe('high');
    });

    it('MEDIUM risk + UNTESTED -> emits TEST_GAP with P3', () => {
      const observations = [makeObs('src/utils/helper.ts', 'UNTESTED', 'MEDIUM', 'P3', 2.0)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('TEST_GAP');
      expect(result.assessments[0].coverage).toBe('UNTESTED');
      expect(result.assessments[0].risk).toBe('MEDIUM');
      expect(result.assessments[0].suggestedPriority).toBe('P3');
    });

    it('LOW risk + UNTESTED -> does NOT emit TEST_GAP', () => {
      const observations = [makeObs('src/utils/tiny.ts', 'UNTESTED', 'LOW', 'P4', 0.5)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(0);
    });

    it('HIGH risk + INDIRECTLY_TESTED -> emits TEST_GAP with P3', () => {
      const observations = [makeObs('src/containers/BarContainer.ts', 'INDIRECTLY_TESTED', 'HIGH', 'P3', 4.0)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('TEST_GAP');
      expect(result.assessments[0].coverage).toBe('INDIRECTLY_TESTED');
      expect(result.assessments[0].risk).toBe('HIGH');
      expect(result.assessments[0].suggestedPriority).toBe('P3');
      expect(result.assessments[0].confidence).toBe('medium');
    });

    it('MEDIUM risk + INDIRECTLY_TESTED -> emits TEST_GAP with P4', () => {
      const observations = [makeObs('src/utils/mapper.ts', 'INDIRECTLY_TESTED', 'MEDIUM', 'P4', 2.0)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('TEST_GAP');
      expect(result.assessments[0].coverage).toBe('INDIRECTLY_TESTED');
      expect(result.assessments[0].risk).toBe('MEDIUM');
      expect(result.assessments[0].suggestedPriority).toBe('P4');
    });

    it('LOW risk + INDIRECTLY_TESTED -> does NOT emit TEST_GAP', () => {
      const observations = [makeObs('src/utils/tiny.ts', 'INDIRECTLY_TESTED', 'LOW', 'P4', 0.5)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(0);
    });

    it('TESTED (any risk) -> does NOT emit TEST_GAP', () => {
      const observations = [
        makeObs('src/containers/TestedHigh.ts', 'TESTED', 'HIGH', 'P4', 5.0),
        makeObs('src/utils/TestedMedium.ts', 'TESTED', 'MEDIUM', 'P4', 2.0),
        makeObs('src/utils/TestedLow.ts', 'TESTED', 'LOW', 'P4', 0.5),
      ];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Directory stats
  // ---------------------------------------------------------------------------

  describe('directory stats', () => {
    it('correctly computes and attaches directory stats', () => {
      const observations = [
        makeObs('src/containers/TestedA.ts', 'TESTED', 'LOW', 'P4', 0.5),
        makeObs('src/containers/TestedB.ts', 'TESTED', 'LOW', 'P4', 0.5),
        makeObs('src/containers/Indirect.ts', 'INDIRECTLY_TESTED', 'HIGH', 'P3', 4.0),
        makeObs('src/containers/UntestedHigh.ts', 'UNTESTED', 'HIGH', 'P2', 5.0),
      ];

      const result = interpretTestCoverage(observations);

      // Should emit 2 gaps: Indirect (HIGH+INDIRECT) and UntestedHigh (HIGH+UNTESTED)
      expect(result.assessments).toHaveLength(2);

      for (const assessment of result.assessments) {
        expect(assessment.directoryStats).toBeDefined();
        expect(assessment.directoryStats!.directory).toBe('src/containers');
        expect(assessment.directoryStats!.totalFiles).toBe(4);
        expect(assessment.directoryStats!.tested).toBe(2);
        expect(assessment.directoryStats!.indirectlyTested).toBe(1);
        expect(assessment.directoryStats!.untested).toBe(1);
        expect(assessment.directoryStats!.coveragePercent).toBe(75);
      }
    });

    it('handles multiple directories independently', () => {
      const observations = [
        makeObs('src/alpha/file1.ts', 'UNTESTED', 'HIGH', 'P2', 4.0),
        makeObs('src/alpha/file2.ts', 'TESTED', 'LOW', 'P4', 0.5),
        makeObs('src/beta/file3.ts', 'UNTESTED', 'MEDIUM', 'P3', 2.0),
      ];

      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(2);

      const alphaGap = result.assessments.find(a => a.subject.file === 'src/alpha/file1.ts');
      expect(alphaGap).toBeDefined();
      expect(alphaGap!.directoryStats!.directory).toBe('src/alpha');
      expect(alphaGap!.directoryStats!.totalFiles).toBe(2);

      const betaGap = result.assessments.find(a => a.subject.file === 'src/beta/file3.ts');
      expect(betaGap).toBeDefined();
      expect(betaGap!.directoryStats!.directory).toBe('src/beta');
      expect(betaGap!.directoryStats!.totalFiles).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty input
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('empty input produces no assessments', () => {
      const result = interpretTestCoverage([]);
      expect(result.assessments).toHaveLength(0);
    });

    it('all-tested input produces no assessments', () => {
      const observations = [
        makeObs('src/a.ts', 'TESTED', 'HIGH', 'P4', 5.0),
        makeObs('src/b.ts', 'TESTED', 'MEDIUM', 'P4', 2.0),
        makeObs('src/c.ts', 'TESTED', 'LOW', 'P4', 0.5),
      ];
      const result = interpretTestCoverage(observations);
      expect(result.assessments).toHaveLength(0);
    });

    it('all-low-risk-untested input produces no assessments', () => {
      const observations = [
        makeObs('src/a.ts', 'UNTESTED', 'LOW', 'P4', 0.5),
        makeObs('src/b.ts', 'UNTESTED', 'LOW', 'P4', 0.3),
      ];
      const result = interpretTestCoverage(observations);
      expect(result.assessments).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Assessment shape
  // ---------------------------------------------------------------------------

  describe('assessment shape', () => {
    it('assessments have basedOn references to source observations', () => {
      const observations = [makeObs('src/foo.ts', 'UNTESTED', 'HIGH', 'P2', 4.0)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].basedOn).toHaveLength(1);
      expect(result.assessments[0].basedOn[0].kind).toBe('TEST_COVERAGE');
      expect(result.assessments[0].basedOn[0].file).toBe('src/foo.ts');
    });

    it('assessments have rationale including risk description', () => {
      const observations = [makeObs('src/foo.ts', 'UNTESTED', 'HIGH', 'P2', 4.5)];
      const result = interpretTestCoverage(observations);

      expect(result.assessments[0].rationale.length).toBeGreaterThan(0);
      expect(result.assessments[0].rationale.some(r => r.includes('HIGH'))).toBe(true);
      expect(result.assessments[0].rationale.some(r => r.includes('4.5'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // groupByDirectory
  // ---------------------------------------------------------------------------

  describe('groupByDirectory', () => {
    it('groups observations into directories', () => {
      const observations = [
        makeObs('src/a/file1.ts', 'TESTED', 'LOW', 'P4'),
        makeObs('src/a/file2.ts', 'UNTESTED', 'HIGH', 'P2'),
        makeObs('src/b/file3.ts', 'UNTESTED', 'MEDIUM', 'P3'),
      ];

      const groups = groupByDirectory(observations);
      expect(groups).toHaveLength(2);

      const dirA = groups.find(g => g.directory === 'src/a');
      expect(dirA).toBeDefined();
      expect(dirA!.observations).toHaveLength(2);

      const dirB = groups.find(g => g.directory === 'src/b');
      expect(dirB).toBeDefined();
      expect(dirB!.observations).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // computeDirectoryStats
  // ---------------------------------------------------------------------------

  describe('computeDirectoryStats', () => {
    it('computes correct percentages', () => {
      const group = {
        directory: 'src/test',
        observations: [
          makeObs('src/test/a.ts', 'TESTED', 'LOW', 'P4'),
          makeObs('src/test/b.ts', 'TESTED', 'LOW', 'P4'),
          makeObs('src/test/c.ts', 'INDIRECTLY_TESTED', 'MEDIUM', 'P4'),
          makeObs('src/test/d.ts', 'UNTESTED', 'HIGH', 'P2'),
        ],
      };

      const stats = computeDirectoryStats(group);
      expect(stats.totalFiles).toBe(4);
      expect(stats.tested).toBe(2);
      expect(stats.indirectlyTested).toBe(1);
      expect(stats.untested).toBe(1);
      expect(stats.coveragePercent).toBe(75);
    });

    it('handles empty group', () => {
      const group = { directory: 'src/empty', observations: [] as TestCoverageObservation[] };
      const stats = computeDirectoryStats(group);
      expect(stats.totalFiles).toBe(0);
      expect(stats.coveragePercent).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Fixture-backed integration tests
  // ---------------------------------------------------------------------------

  describe('fixture: test-coverage-mixed-high-risk', () => {
    it('emits TEST_GAP assessments for untested high-risk files', () => {
      const dir = fixtureDir('test-coverage-mixed-high-risk');
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      // Run ast-test-coverage to get observations
      const coverageResults = analyzeTestCoverageDirectory(dir);
      const allObs: TestCoverageObservation[] = [];
      for (const r of coverageResults) {
        allObs.push(extractTestCoverageObservations(r).observations[0]);
      }

      // Run interpreter
      const result = interpretTestCoverage(allObs);

      // Verify against manifest
      expect(result.assessments.length).toBe(manifest.expectedAssessments);

      for (const expectedFile of manifest.expectedGapFiles) {
        const gap = result.assessments.find(a => a.subject.file.endsWith(expectedFile));
        expect(gap).toBeDefined();
        expect(gap!.kind).toBe('TEST_GAP');
      }
    });
  });

  describe('fixture: test-coverage-mixed-low-risk', () => {
    it('emits no TEST_GAP assessments for untested low-risk files', () => {
      const dir = fixtureDir('test-coverage-mixed-low-risk');
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      // Run ast-test-coverage to get observations
      const coverageResults = analyzeTestCoverageDirectory(dir);
      const allObs: TestCoverageObservation[] = [];
      for (const r of coverageResults) {
        allObs.push(extractTestCoverageObservations(r).observations[0]);
      }

      // Run interpreter
      const result = interpretTestCoverage(allObs);

      // Verify against manifest
      expect(result.assessments.length).toBe(manifest.expectedAssessments);
    });
  });
});

// ---------------------------------------------------------------------------
// main() CLI tests
// ---------------------------------------------------------------------------

describe('main()', () => {
  const originalArgv = process.argv;
  let stdoutChunks: string[];

  class ExitError extends Error {
    code: number;
    constructor(code: number) {
      super(`process.exit(${code})`);
      this.code = code;
    }
  }

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('--help prints usage and exits 0', async () => {
    process.argv = ['node', 'ast-interpret-test-coverage.ts', '--help'];

    await expect(main()).rejects.toThrow('process.exit(0)');

    const out = stdoutChunks.join('');
    expect(out).toContain('Usage:');
    expect(out).toContain('--pretty');
  });

  it('errors when stdin is a TTY', async () => {
    process.argv = ['node', 'ast-interpret-test-coverage.ts'];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // stdin.isTTY is true in test environment by default
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    await expect(main()).rejects.toThrow('process.exit(1)');

    const errOut = (stderrSpy.mock.calls[0]?.[0] as string) ?? '';
    expect(errOut).toContain('No input');
  });

  function mockStdin(data: string): void {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const orig = process.stdin.on.bind(process.stdin);
    vi.spyOn(process.stdin, 'on').mockImplementation(((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from(data)), 0);
        return process.stdin;
      }
      if (event === 'end') {
        setTimeout(() => cb(), 1);
        return process.stdin;
      }
      return orig(event, cb);
    }) as typeof process.stdin.on);
  }

  it('parses array of observations from stdin and outputs JSON', async () => {
    const observations = [makeObs('src/foo.ts', 'UNTESTED', 'HIGH', 'P2', 4.0)];
    const input = JSON.stringify([{ filePath: 'src/foo.ts', observations }]);

    mockStdin(input);
    process.argv = ['node', 'ast-interpret-test-coverage.ts', '--json'];

    await main();

    const out = stdoutChunks.join('');
    expect(out).toContain('TEST_GAP');
    expect(out).toContain('UNTESTED');
  });

  it('parses single object with observations from stdin', async () => {
    const observations = [makeObs('src/bar.ts', 'UNTESTED', 'MEDIUM', 'P3', 2.0)];
    const input = JSON.stringify({ filePath: 'src/bar.ts', observations });

    mockStdin(input);
    process.argv = ['node', 'ast-interpret-test-coverage.ts'];

    await main();

    const out = stdoutChunks.join('');
    expect(out).toContain('TEST_GAP');
  });

  it('parses raw array of observations from stdin', async () => {
    const observations = [makeObs('src/baz.ts', 'UNTESTED', 'HIGH', 'P2', 5.0)];
    const input = JSON.stringify(observations);

    mockStdin(input);
    process.argv = ['node', 'ast-interpret-test-coverage.ts'];

    await main();

    const out = stdoutChunks.join('');
    expect(out).toContain('TEST_GAP');
  });

  it('--pretty outputs formatted directory summary', async () => {
    const observations = [
      makeObs('src/containers/FooContainer.ts', 'UNTESTED', 'HIGH', 'P2', 4.0),
      makeObs('src/containers/Bar.ts', 'TESTED', 'LOW', 'P4', 0.5),
    ];
    const input = JSON.stringify([{ filePath: 'src/containers', observations }]);

    mockStdin(input);
    process.argv = ['node', 'ast-interpret-test-coverage.ts', '--pretty'];

    await main();

    const out = stdoutChunks.join('');
    expect(out).toContain('Test Coverage Gap Assessments');
    expect(out).toContain('src/containers');
    expect(out).toContain('P2');
    expect(out).toContain('Total gaps:');
  });

  it('--pretty with no gaps outputs "No test gaps found"', async () => {
    const observations = [makeObs('src/ok.ts', 'TESTED', 'LOW', 'P4', 0.5)];
    const input = JSON.stringify([{ filePath: 'src/ok.ts', observations }]);

    mockStdin(input);
    process.argv = ['node', 'ast-interpret-test-coverage.ts', '--pretty'];

    await main();

    const out = stdoutChunks.join('');
    expect(out).toContain('No test gaps found');
  });

  it('--count outputs assessment kind counts', async () => {
    const observations = [
      makeObs('src/a.ts', 'UNTESTED', 'HIGH', 'P2', 4.0),
      makeObs('src/b.ts', 'UNTESTED', 'MEDIUM', 'P3', 2.0),
    ];
    const input = JSON.stringify(observations);

    mockStdin(input);
    process.argv = ['node', 'ast-interpret-test-coverage.ts', '--count'];

    await main();

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    expect(parsed.TEST_GAP).toBe(2);
  });

  it('errors on empty stdin', async () => {
    mockStdin('');
    process.argv = ['node', 'ast-interpret-test-coverage.ts'];
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(main()).rejects.toThrow('process.exit(1)');
  });

  it('errors on invalid JSON', async () => {
    mockStdin('not json');
    process.argv = ['node', 'ast-interpret-test-coverage.ts'];
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(main()).rejects.toThrow('process.exit(1)');
  });
});
