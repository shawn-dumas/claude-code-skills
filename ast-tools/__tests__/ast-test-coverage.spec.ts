import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  analyzeTestCoverageDirectory,
  analyzeTestCoverageForFile,
  extractTestCoverageObservations,
} from '../ast-test-coverage';
import type { TestCoverageResult } from '../ast-test-coverage';
import type { ComplexityAnalysis } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixtureDir(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// ---------------------------------------------------------------------------
// Synthetic fixture tests
// ---------------------------------------------------------------------------

describe('ast-test-coverage: synthetic fixtures', () => {
  describe('test-coverage-tested', () => {
    it('detects TESTED coverage for file with dedicated spec', () => {
      const dir = fixtureDir('test-coverage-tested');
      const results = analyzeTestCoverageDirectory(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      const calculatorResult = results.find(r => r.filePath.endsWith('calculator.ts'));
      expect(calculatorResult).toBeDefined();
      expect(calculatorResult!.coverage).toBe('TESTED');
      expect(calculatorResult!.specFile).not.toBeNull();
      expect(manifest.expectedObservations[0].coverage).toBe('TESTED');
    });
  });

  describe('test-coverage-indirect', () => {
    it('detects INDIRECTLY_TESTED coverage for file imported by spec', () => {
      const dir = fixtureDir('test-coverage-indirect');
      const results = analyzeTestCoverageDirectory(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      const formatterResult = results.find(r => r.filePath.endsWith('formatter.ts'));
      expect(formatterResult).toBeDefined();
      expect(formatterResult!.coverage).toBe('INDIRECTLY_TESTED');
      expect(formatterResult!.specFile).toBeNull();
      expect(formatterResult!.indirectSpecs.length).toBeGreaterThan(0);
      expect(manifest.expectedObservations[0].coverage).toBe('INDIRECTLY_TESTED');
    });
  });

  describe('test-coverage-untested', () => {
    it('detects UNTESTED coverage for file with no spec', () => {
      const dir = fixtureDir('test-coverage-untested');
      const results = analyzeTestCoverageDirectory(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      const orphanResult = results.find(r => r.filePath.endsWith('orphan.ts'));
      expect(orphanResult).toBeDefined();
      expect(orphanResult!.coverage).toBe('UNTESTED');
      expect(orphanResult!.specFile).toBeNull();
      expect(orphanResult!.indirectSpecs).toHaveLength(0);
      expect(manifest.expectedObservations[0].coverage).toBe('UNTESTED');
    });
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture tests
// ---------------------------------------------------------------------------

describe('ast-test-coverage: real-world fixtures', () => {
  describe('test-coverage-real-tested', () => {
    it('detects TESTED for calculatePeriodEnds fixture', () => {
      const dir = fixtureDir('test-coverage-real-tested');
      const results = analyzeTestCoverageDirectory(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      const result = results.find(r => r.filePath.endsWith('calculatePeriodEnds.ts'));
      expect(result).toBeDefined();
      expect(result!.coverage).toBe('TESTED');
      expect(manifest.expectedObservations[0].coverage).toBe('TESTED');
    });
  });

  describe('test-coverage-real-indirect', () => {
    it('detects INDIRECTLY_TESTED for mapUserRoleName fixture', () => {
      const dir = fixtureDir('test-coverage-real-indirect');
      const results = analyzeTestCoverageDirectory(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      const result = results.find(r => r.filePath.endsWith('mapUserRoleName.ts'));
      expect(result).toBeDefined();
      expect(result!.coverage).toBe('INDIRECTLY_TESTED');
      expect(manifest.expectedObservations[0].coverage).toBe('INDIRECTLY_TESTED');
    });
  });

  describe('test-coverage-real-untested', () => {
    it('detects UNTESTED for formatTeams fixture', () => {
      const dir = fixtureDir('test-coverage-real-untested');
      const results = analyzeTestCoverageDirectory(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

      const result = results.find(r => r.filePath.endsWith('formatTeams.ts'));
      expect(result).toBeDefined();
      expect(result!.coverage).toBe('UNTESTED');
      expect(manifest.expectedObservations[0].coverage).toBe('UNTESTED');
    });
  });
});

// ---------------------------------------------------------------------------
// Risk score computation
// ---------------------------------------------------------------------------

describe('risk score computation', () => {
  it('computes risk score from formula: (maxCC / 5) + (lineCount / 100) + (consumerCount / 10)', () => {
    // Use a fixture that produces known values
    const dir = fixtureDir('test-coverage-untested');
    const results = analyzeTestCoverageDirectory(dir);
    const orphanResult = results.find(r => r.filePath.endsWith('orphan.ts'));
    expect(orphanResult).toBeDefined();

    const expected = orphanResult!.maxCC / 5 + orphanResult!.lineCount / 100 + orphanResult!.consumerCount / 10;
    expect(orphanResult!.riskScore).toBeCloseTo(Math.round(expected * 100) / 100, 2);
  });

  it('maxCC is at least 1', () => {
    const dir = fixtureDir('test-coverage-tested');
    const results = analyzeTestCoverageDirectory(dir);
    for (const r of results) {
      expect(r.maxCC).toBeGreaterThanOrEqual(1);
    }
  });

  it('lineCount is positive for non-empty files', () => {
    const dir = fixtureDir('test-coverage-tested');
    const results = analyzeTestCoverageDirectory(dir);
    for (const r of results) {
      expect(r.lineCount).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Priority assignment
// ---------------------------------------------------------------------------

describe('priority assignment', () => {
  it('assigns P2 for HIGH risk + UNTESTED', () => {
    // Create a mock result with HIGH risk + UNTESTED
    const mockResult: TestCoverageResult = {
      filePath: 'test.ts',
      specFile: null,
      indirectSpecs: [],
      coverage: 'UNTESTED',
      riskScore: 5.0,
      risk: 'HIGH',
      suggestedPriority: 'P2',
      maxCC: 20,
      lineCount: 200,
      consumerCount: 10,
    };
    expect(mockResult.suggestedPriority).toBe('P2');
  });

  it('assigns P3 for MEDIUM risk + UNTESTED', () => {
    const mockResult: TestCoverageResult = {
      filePath: 'test.ts',
      specFile: null,
      indirectSpecs: [],
      coverage: 'UNTESTED',
      riskScore: 2.0,
      risk: 'MEDIUM',
      suggestedPriority: 'P3',
      maxCC: 5,
      lineCount: 100,
      consumerCount: 5,
    };
    expect(mockResult.suggestedPriority).toBe('P3');
  });

  it('assigns P3 for HIGH risk + INDIRECTLY_TESTED', () => {
    const mockResult: TestCoverageResult = {
      filePath: 'test.ts',
      specFile: null,
      indirectSpecs: ['other.spec.ts'],
      coverage: 'INDIRECTLY_TESTED',
      riskScore: 5.0,
      risk: 'HIGH',
      suggestedPriority: 'P3',
      maxCC: 20,
      lineCount: 200,
      consumerCount: 10,
    };
    expect(mockResult.suggestedPriority).toBe('P3');
  });

  it('assigns P4 for LOW risk + UNTESTED', () => {
    const mockResult: TestCoverageResult = {
      filePath: 'test.ts',
      specFile: null,
      indirectSpecs: [],
      coverage: 'UNTESTED',
      riskScore: 0.5,
      risk: 'LOW',
      suggestedPriority: 'P4',
      maxCC: 1,
      lineCount: 10,
      consumerCount: 0,
    };
    expect(mockResult.suggestedPriority).toBe('P4');
  });

  it('assigns P4 for MEDIUM risk + INDIRECTLY_TESTED', () => {
    const mockResult: TestCoverageResult = {
      filePath: 'test.ts',
      specFile: null,
      indirectSpecs: ['other.spec.ts'],
      coverage: 'INDIRECTLY_TESTED',
      riskScore: 2.0,
      risk: 'MEDIUM',
      suggestedPriority: 'P4',
      maxCC: 5,
      lineCount: 100,
      consumerCount: 5,
    };
    expect(mockResult.suggestedPriority).toBe('P4');
  });

  it('assigns P4 for TESTED files regardless of risk', () => {
    const dir = fixtureDir('test-coverage-tested');
    const results = analyzeTestCoverageDirectory(dir);
    const testedResult = results.find(r => r.coverage === 'TESTED');
    expect(testedResult).toBeDefined();
    expect(testedResult!.suggestedPriority).toBe('P4');
  });
});

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

describe('extractTestCoverageObservations', () => {
  it('produces TEST_COVERAGE observation with all required fields', () => {
    const dir = fixtureDir('test-coverage-tested');
    const results = analyzeTestCoverageDirectory(dir);
    const calculatorResult = results.find(r => r.filePath.endsWith('calculator.ts'));
    expect(calculatorResult).toBeDefined();

    const obsResult = extractTestCoverageObservations(calculatorResult!);
    expect(obsResult.filePath).toBe(calculatorResult!.filePath);
    expect(obsResult.observations).toHaveLength(1);

    const obs = obsResult.observations[0];
    expect(obs.kind).toBe('TEST_COVERAGE');
    expect(obs.file).toBe(calculatorResult!.filePath);
    expect(obs.line).toBe(1);
    expect(obs.evidence.coverage).toBe('TESTED');
    expect(obs.evidence.specFile).not.toBeNull();
    expect(obs.evidence.riskScore).toBeGreaterThanOrEqual(0);
    expect(typeof obs.evidence.risk).toBe('string');
    expect(typeof obs.evidence.suggestedPriority).toBe('string');
    expect(obs.evidence.maxCC).toBeGreaterThanOrEqual(1);
    expect(obs.evidence.lineCount).toBeGreaterThan(0);
    expect(typeof obs.evidence.consumerCount).toBe('number');
  });

  it('observation for UNTESTED file has null specFile and empty indirectSpecs', () => {
    const dir = fixtureDir('test-coverage-untested');
    const results = analyzeTestCoverageDirectory(dir);
    const orphanResult = results.find(r => r.filePath.endsWith('orphan.ts'));
    expect(orphanResult).toBeDefined();

    const obsResult = extractTestCoverageObservations(orphanResult!);
    const obs = obsResult.observations[0];
    expect(obs.evidence.specFile).toBeNull();
    expect(obs.evidence.indirectSpecs).toHaveLength(0);
    expect(obs.evidence.coverage).toBe('UNTESTED');
  });
});

// ---------------------------------------------------------------------------
// analyzeTestCoverageForFile standalone
// ---------------------------------------------------------------------------

describe('analyzeTestCoverageForFile', () => {
  it('works with pre-computed complexity map and edges', () => {
    const dir = fixtureDir('test-coverage-tested');
    const calculatorPath = path.join(dir, 'calculator.ts');
    const complexityMap = new Map<string, ComplexityAnalysis>();

    const result = analyzeTestCoverageForFile(calculatorPath, complexityMap, []);
    expect(result.coverage).toBe('TESTED');
    expect(result.specFile).not.toBeNull();
  });
});
