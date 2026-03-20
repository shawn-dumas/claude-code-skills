import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { interpretTestCoverage, groupByDirectory, computeDirectoryStats } from '../ast-interpret-test-coverage';
import { analyzeTestCoverageDirectory, extractTestCoverageObservations } from '../ast-test-coverage';
import type { TestCoverageObservation, TestGapAssessment } from '../types';

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
