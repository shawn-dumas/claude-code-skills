import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  analyzeConcernMatrix,
  analyzeConcernMatrixDirectory,
  extractConcernMatrixObservations,
} from '../ast-concern-matrix';
import type { ConcernMatrixAnalysis } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): ConcernMatrixAnalysis {
  return analyzeConcernMatrix(fixturePath(name));
}

describe('ast-concern-matrix', () => {
  describe('FullCoverageContainer (handles loading + error + empty)', () => {
    it('emits CONTAINER_HANDLES_LOADING', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'CONTAINER_HANDLES_LOADING' && o.evidence.componentName === 'FullCoverageContainer',
      );
      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.loadingSignals.length).toBeGreaterThan(0);
    });

    it('emits CONTAINER_HANDLES_ERROR', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'CONTAINER_HANDLES_ERROR' && o.evidence.componentName === 'FullCoverageContainer',
      );
      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.errorSignals.length).toBeGreaterThan(0);
    });

    it('emits CONTAINER_HANDLES_EMPTY', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'CONTAINER_HANDLES_EMPTY' && o.evidence.componentName === 'FullCoverageContainer',
      );
      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.emptySignals.length).toBeGreaterThan(0);
    });

    it('summary shows all 3 concerns handled', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      // Summary is built from the first container with data-fetching hooks
      expect(result.summary.componentName).toBe('FullCoverageContainer');
      expect(result.summary.handlesLoading).toBe(true);
      expect(result.summary.handlesError).toBe(true);
      expect(result.summary.handlesEmpty).toBe(true);
      // Permission not applicable for fixture path (not in pages/ or settings/)
      expect(result.summary.score).toBe('3/3');
    });
  });

  describe('PartialCoverageContainer (handles loading only)', () => {
    it('emits CONTAINER_HANDLES_LOADING', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'CONTAINER_HANDLES_LOADING' && o.evidence.componentName === 'PartialCoverageContainer',
      );
      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.loadingSignals).toContain('useDashboardData.isPending');
    });

    it('emits CONTAINER_MISSING_ERROR', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'CONTAINER_MISSING_ERROR' && o.evidence.componentName === 'PartialCoverageContainer',
      );
      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.errorSignals).toHaveLength(0);
    });

    it('emits CONTAINER_MISSING_EMPTY', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'CONTAINER_MISSING_EMPTY' && o.evidence.componentName === 'PartialCoverageContainer',
      );
      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.emptySignals).toHaveLength(0);
    });
  });

  describe('PresentationalCard (no query hooks)', () => {
    it('produces no observations for presentational components', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.filter(o => o.evidence.componentName === 'PresentationalCard');
      expect(obs).toHaveLength(0);
    });
  });

  describe('CompleteConcernContainer (all concerns handled, dedicated fixture)', () => {
    it('emits no CONTAINER_MISSING_* observations', () => {
      const result = analyzeFixture('concern-matrix-complete.tsx');
      const missing = result.observations.filter(o => o.kind.startsWith('CONTAINER_MISSING_'));
      expect(missing).toHaveLength(0);
    });

    it('emits CONTAINER_HANDLES_LOADING, CONTAINER_HANDLES_ERROR, CONTAINER_HANDLES_EMPTY', () => {
      const result = analyzeFixture('concern-matrix-complete.tsx');
      const kinds = result.observations.map(o => o.kind);
      expect(kinds).toContain('CONTAINER_HANDLES_LOADING');
      expect(kinds).toContain('CONTAINER_HANDLES_ERROR');
      expect(kinds).toContain('CONTAINER_HANDLES_EMPTY');
    });

    it('summary score is 3/3', () => {
      const result = analyzeFixture('concern-matrix-complete.tsx');
      expect(result.summary.score).toBe('3/3');
    });
  });

  describe('PartialConcernContainer (missing error + empty, dedicated fixture)', () => {
    it('emits CONTAINER_MISSING_ERROR and CONTAINER_MISSING_EMPTY', () => {
      const result = analyzeFixture('concern-matrix-partial.tsx');
      const kinds = result.observations.map(o => o.kind);
      expect(kinds).toContain('CONTAINER_MISSING_ERROR');
      expect(kinds).toContain('CONTAINER_MISSING_EMPTY');
    });

    it('emits CONTAINER_HANDLES_LOADING', () => {
      const result = analyzeFixture('concern-matrix-partial.tsx');
      const kinds = result.observations.map(o => o.kind);
      expect(kinds).toContain('CONTAINER_HANDLES_LOADING');
    });

    it('summary score is 1/3', () => {
      const result = analyzeFixture('concern-matrix-partial.tsx');
      expect(result.summary.score).toBe('1/3');
    });
  });

  describe('evidence structure', () => {
    it('includes query and mutation hook counts', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      const obs = result.observations.find(o => o.evidence.componentName === 'FullCoverageContainer');
      expect(obs).toBeDefined();
      expect(obs!.evidence.queryHookCount).toBeGreaterThanOrEqual(0);
      expect(obs!.evidence.mutationHookCount).toBeGreaterThanOrEqual(0);
    });

    it('every observation has file and line', () => {
      const result = analyzeFixture('concern-matrix-samples.tsx');
      for (const obs of result.observations) {
        expect(obs.file).toBeDefined();
        expect(obs.line).toBeGreaterThan(0);
      }
    });
  });
});

describe('analyzeConcernMatrixDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeConcernMatrixDirectory(FIXTURES_DIR);
    // At minimum our fixture file should produce results
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
      expect(r.observations.length).toBeGreaterThan(0);
    }
  });
});

describe('extractConcernMatrixObservations', () => {
  it('returns observations with filePath', () => {
    const analysis = analyzeFixture('concern-matrix-samples.tsx');
    const result = extractConcernMatrixObservations(analysis);

    expect(result.filePath).toBe(analysis.filePath);
    expect(result.observations).toBe(analysis.observations);
    expect(result.observations.length).toBeGreaterThan(0);
  });

  it('every observation has a valid kind', () => {
    const analysis = analyzeFixture('concern-matrix-samples.tsx');
    const result = extractConcernMatrixObservations(analysis);

    const validKinds = new Set([
      'CONTAINER_HANDLES_LOADING',
      'CONTAINER_HANDLES_ERROR',
      'CONTAINER_HANDLES_EMPTY',
      'CONTAINER_HANDLES_PERMISSION',
      'CONTAINER_MISSING_LOADING',
      'CONTAINER_MISSING_ERROR',
      'CONTAINER_MISSING_EMPTY',
      'CONTAINER_MISSING_PERMISSION',
    ]);

    for (const obs of result.observations) {
      expect(validKinds.has(obs.kind)).toBe(true);
    }
  });
});
