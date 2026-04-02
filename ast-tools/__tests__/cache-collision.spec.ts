/**
 * Red-to-green test for cache key collision between tool-registry
 * observation cache and per-tool full-analysis cache.
 *
 * Bug: runAllObservers cached AnyObservation[] under the same key that
 * analyzeStorageAccessDirectory cached StorageAccessAnalysis. Whichever
 * ran first poisoned the cache for the other.
 *
 * Fix: tool-registry appends "-obs" to cache keys. toolSourceFile strips
 * the suffix so tool-source invalidation still works.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { runObservers } from '../tool-registry';
import { analyzeStorageAccess, analyzeStorageAccessDirectory } from '../ast-storage-access';
import { analyzeJsxComplexity } from '../ast-jsx-analysis';
import { analyzeReactFile } from '../ast-react-inventory';
import { analyzeSideEffects } from '../ast-side-effects';
import { getSourceFile } from '../project';
import { resetCacheStats } from '../ast-cache';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('cache collision prevention', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  describe('storage-access', () => {
    it('analyzeStorageAccess returns full analysis after registry cache populated', () => {
      const filePath = path.join(FIXTURES_DIR, 'storage-access-samples.ts');
      const sf = getSourceFile(filePath);

      // Populate registry observation cache (AnyObservation[])
      const obs = runObservers(sf, filePath, ['storage-access']);
      expect(obs.length).toBeGreaterThan(0);

      // Now run per-tool analysis -- must return StorageAccessAnalysis, not AnyObservation[]
      const analysis = analyzeStorageAccess(filePath);
      expect(analysis.accesses).toBeDefined();
      expect(Array.isArray(analysis.accesses)).toBe(true);
      expect(analysis.summary).toBeDefined();
      expect(typeof analysis.violationCount).toBe('number');
      expect(typeof analysis.compliantCount).toBe('number');
    });

    it('analyzeStorageAccessDirectory returns full analysis after registry cache populated', () => {
      const fixturePath = path.join(FIXTURES_DIR, 'storage-access-samples.ts');
      const sf = getSourceFile(fixturePath);

      // Populate registry cache
      runObservers(sf, fixturePath, ['storage-access']);

      // Directory analysis must not crash accessing .accesses on a cached AnyObservation[]
      const results = analyzeStorageAccessDirectory(FIXTURES_DIR);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.accesses).toBeDefined();
        expect(Array.isArray(r.accesses)).toBe(true);
      }
    });

    it('runObservers returns observations after per-tool cache populated', () => {
      const filePath = path.join(FIXTURES_DIR, 'storage-access-samples.ts');

      // Populate per-tool full-analysis cache
      const analysis = analyzeStorageAccess(filePath);
      expect(analysis.accesses.length).toBeGreaterThan(0);

      // Registry must still return AnyObservation[], not the full analysis object
      const sf = getSourceFile(filePath);
      const obs = runObservers(sf, filePath, ['storage-access']);
      expect(obs.length).toBeGreaterThan(0);
      // Observations must have the standard observation shape
      for (const o of obs) {
        expect(o).toHaveProperty('kind');
        expect(o).toHaveProperty('file');
        expect(o).toHaveProperty('line');
      }
    });
  });

  describe('jsx-analysis', () => {
    it('analyzeJsxComplexity returns full analysis after registry cache populated', () => {
      const filePath = path.join(FIXTURES_DIR, 'component-with-jsx-complexity.tsx');
      const sf = getSourceFile(filePath);

      runObservers(sf, filePath, ['jsx-analysis']);

      const analysis = analyzeJsxComplexity(filePath);
      expect(analysis.filePath).toBeDefined();
      expect(analysis.components).toBeDefined();
      expect(Array.isArray(analysis.components)).toBe(true);
    });
  });

  describe('react-inventory', () => {
    it('analyzeReactFile returns full analysis after registry cache populated', () => {
      const filePath = path.join(FIXTURES_DIR, 'simple-component.tsx');
      const sf = getSourceFile(filePath);

      runObservers(sf, filePath, ['react-inventory']);

      const analysis = analyzeReactFile(filePath);
      expect(analysis.filePath).toBeDefined();
      expect(analysis.hookDefinitions).toBeDefined();
      expect(analysis.components).toBeDefined();
    });
  });

  describe('side-effects', () => {
    it('analyzeSideEffects returns full analysis after registry cache populated', () => {
      const filePath = path.join(FIXTURES_DIR, 'side-effects-samples.ts');
      const sf = getSourceFile(filePath);

      runObservers(sf, filePath, ['side-effects']);

      const analysis = analyzeSideEffects(filePath);
      expect(analysis.filePath).toBeDefined();
      expect(analysis.sideEffects).toBeDefined();
      expect(Array.isArray(analysis.sideEffects)).toBe(true);
    });
  });
});
