import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';

import { cached, getCached, setCache, getCacheStats, resetCacheStats, getToolSourceHash } from '../ast-cache';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('ast-cache', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  describe('cached()', () => {
    it('caches result and returns it on subsequent calls', () => {
      // Use a unique tool name with a timestamp to avoid stale entries
      const toolName = `test-cached-${Date.now()}`;
      const filePath = path.join(FIXTURES_DIR, 'simple-component.tsx');

      // First call: cache miss, computes and writes
      const result = cached(toolName, filePath, () => ({ value: 42 }));
      expect(result).toEqual({ value: 42 });

      // Second call: cache hit, returns cached value (not the new compute)
      const result2 = cached(toolName, filePath, () => ({ value: 999 }));
      expect(result2).toEqual({ value: 42 });

      const stats = getCacheStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
    });

    it('bypasses cache when noCache is true', () => {
      const toolName = 'test-no-cache';
      const filePath = path.join(FIXTURES_DIR, 'simple-component.tsx');

      cached(toolName, filePath, () => ({ value: 1 }), { noCache: true });
      const result = cached(toolName, filePath, () => ({ value: 2 }), { noCache: true });
      expect(result).toEqual({ value: 2 });
    });
  });

  describe('stale cache resilience', () => {
    it('getCached returns stale entry with missing fields intact', () => {
      // Simulate what happens when a tool's output shape changes: the cache
      // has an entry written by the old tool version that lacks a field the
      // new version expects (e.g., `components`).
      //
      // Use a unique tool name to avoid interfering with real cache entries.
      const toolName = 'test-stale-jsx';
      const filePath = path.join(FIXTURES_DIR, 'simple-component.tsx');

      // Inject a stale entry that lacks `components`
      setCache(toolName, filePath, { filePath: 'stale.tsx', observations: [] });

      const stale = getCached<{ filePath: string; components?: unknown[] }>(toolName, filePath);
      expect(stale).not.toBeNull();
      expect(stale!.components).toBeUndefined();
    });

    it('getCached returns stale entry with missing sideEffects intact', () => {
      const toolName = 'test-stale-side-effects';
      const filePath = path.join(FIXTURES_DIR, 'side-effects-samples.ts');

      setCache(toolName, filePath, { filePath: 'stale.ts', observations: [] });

      const stale = getCached<{ filePath: string; sideEffects?: unknown[] }>(toolName, filePath);
      expect(stale).not.toBeNull();
      expect(stale!.sideEffects).toBeUndefined();
    });
  });

  describe('getToolSourceHash', () => {
    it('returns a non-empty string for a known tool', () => {
      const hash = getToolSourceHash('jsx-analysis');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('returns a different hash for different tools', () => {
      const jsxHash = getToolSourceHash('jsx-analysis');
      const sideEffectsHash = getToolSourceHash('side-effects');
      expect(jsxHash).not.toBe(sideEffectsHash);
    });

    it('returns consistent hash for the same tool', () => {
      const hash1 = getToolSourceHash('jsx-analysis');
      const hash2 = getToolSourceHash('jsx-analysis');
      expect(hash1).toBe(hash2);
    });

    it('returns empty string for unknown tool (no source file)', () => {
      const hash = getToolSourceHash('nonexistent-tool');
      expect(hash).toBe('');
    });

    it('returns a 64-char SHA-256 hex string for registered tools', () => {
      const hash = getToolSourceHash('complexity');
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
