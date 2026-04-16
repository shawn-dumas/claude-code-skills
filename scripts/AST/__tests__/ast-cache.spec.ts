import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

import {
  cached,
  cachedDirectory,
  clearCache,
  ensureCacheValid,
  formatBytes,
  getCached,
  getCacheStats,
  resetCacheStats,
  getToolSourceHash,
  getFileHash,
  getCacheInfo,
  getCachedDirectory,
  setCacheDir,
  resetCacheDir,
  setCacheDirectory,
  setCache,
} from '../ast-cache';
import { PROJECT_ROOT } from '../project';

const CACHE_DIR = path.join(PROJECT_ROOT, '.ast-cache');

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

    it('strips -obs suffix and resolves to the same source file', () => {
      // The -obs suffix is used by tool-registry to namespace observation
      // cache entries separately from per-tool full-analysis cache entries.
      // Both must resolve to the same tool source hash so that tool code
      // changes invalidate both cache namespaces.
      const baseHash = getToolSourceHash('storage-access');
      const obsHash = getToolSourceHash('storage-access-obs');
      expect(baseHash).toBeTruthy();
      expect(obsHash).toBe(baseHash);
    });

    it('strips -obs suffix for all colliding tool names', () => {
      const collidingTools = [
        'storage-access',
        'jsx-analysis',
        'null-display',
        'number-format',
        'react-inventory',
        'side-effects',
        'behavioral',
      ];
      for (const tool of collidingTools) {
        const baseHash = getToolSourceHash(tool);
        const obsHash = getToolSourceHash(tool + '-obs');
        expect(obsHash, `${tool}-obs should match ${tool}`).toBe(baseHash);
      }
    });
  });

  describe('corrupt cache file resilience', () => {
    it('getCached returns null for a corrupt (non-JSON) cache file', () => {
      // Write a valid entry first to establish the tool directory, then
      // overwrite the file with invalid JSON to simulate cache corruption.
      // This covers the catch block in getCached (line 234 in ast-cache.ts).
      const toolName = 'test-corrupt-file';
      const filePath = path.join(FIXTURES_DIR, 'simple-component.tsx');

      // Write a valid entry so the cache file path is known.
      setCache(toolName, filePath, { value: 1 });

      // Compute the cache file path using the same logic as getCached.
      // For a nonexistent tool, toolHash is empty, so cacheKey = fileHash.
      const fileHash = getFileHash(filePath);
      const cacheFile = path.join(CACHE_DIR, toolName, `${fileHash}.json`);

      // Overwrite with invalid JSON to trigger the parse-error catch branch.
      fs.writeFileSync(cacheFile, '{invalid json}');

      resetCacheStats();
      const result = getCached<{ value: number }>(toolName, filePath);
      expect(result).toBeNull();

      const stats = getCacheStats();
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });

    it('getCachedDirectory returns null for a corrupt directory cache file', () => {
      // Similar to getCached, but exercises the getCachedDirectory corrupt-file
      // path (lines 415-416 in ast-cache.ts).
      const toolName = 'test-corrupt-dir-cache';
      const dirHash = 'test-dir-hash-corrupt';

      // Write a valid directory entry first so the tool directory exists.
      setCacheDirectory(toolName, dirHash, { value: 'ok' });

      // Overwrite the directory cache file with invalid JSON.
      const cacheFile = path.join(CACHE_DIR, toolName, `dir-${dirHash}.json`);
      fs.writeFileSync(cacheFile, '{invalid json}');

      resetCacheStats();
      const result = getCachedDirectory<{ value: string }>(toolName, dirHash);
      expect(result).toBeNull();

      const stats = getCacheStats();
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getCacheInfo', () => {
    it('returns exists:true when cache directory exists', () => {
      // Ensure the cache is primed (write a known entry) then verify
      // getCacheInfo returns a valid non-empty result.
      setCache('test-cache-info', path.join(FIXTURES_DIR, 'simple-component.tsx'), { probe: 1 });

      const info = getCacheInfo();
      expect(info.exists).toBe(true);
      expect(info.totalFiles).toBeGreaterThan(0);
      expect(info.toolDirs.length).toBeGreaterThan(0);
    });
  });

  describe('ensureCacheValid() with isolated cache dir', () => {
    let tmpCacheDir: string;

    beforeEach(() => {
      tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-cache-test-'));
      setCacheDir(tmpCacheDir);
    });

    afterEach(() => {
      resetCacheDir();
      fs.rmSync(tmpCacheDir, { recursive: true, force: true });
    });

    it('creates cache dir and returns false when dir does not exist', () => {
      // Remove the dir that mkdtemp created so ensureCacheValid creates it
      fs.rmSync(tmpCacheDir, { recursive: true });

      const valid = ensureCacheValid();
      expect(valid).toBe(false);
      expect(fs.existsSync(tmpCacheDir)).toBe(true);
      expect(fs.existsSync(path.join(tmpCacheDir, 'meta.json'))).toBe(true);
    });

    it('clears and returns false when meta.json is missing', () => {
      // Dir exists (from mkdtemp) but no meta.json
      const valid = ensureCacheValid();
      expect(valid).toBe(false);
      expect(fs.existsSync(path.join(tmpCacheDir, 'meta.json'))).toBe(true);
    });

    it('clears and returns false when config hash is stale', () => {
      // Write a meta.json with a wrong config hash
      fs.writeFileSync(path.join(tmpCacheDir, 'meta.json'), JSON.stringify({ configHash: 'stale-hash', createdAt: 0 }));

      const valid = ensureCacheValid();
      expect(valid).toBe(false);

      // Meta should have been rewritten with the real hash
      const meta = JSON.parse(fs.readFileSync(path.join(tmpCacheDir, 'meta.json'), 'utf-8'));
      expect(meta.configHash).not.toBe('stale-hash');
    });

    it('returns true when config hash matches', () => {
      // First call creates meta with correct hash
      ensureCacheValid();

      // Reset validated flag so it re-checks
      setCacheDir(tmpCacheDir);

      const valid = ensureCacheValid();
      expect(valid).toBe(true);
    });
  });

  describe('clearCache() with isolated cache dir', () => {
    let tmpCacheDir: string;

    beforeEach(() => {
      tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-cache-clear-'));
      setCacheDir(tmpCacheDir);
    });

    afterEach(() => {
      resetCacheDir();
      if (fs.existsSync(tmpCacheDir)) {
        fs.rmSync(tmpCacheDir, { recursive: true, force: true });
      }
    });

    it('removes the cache directory', () => {
      // Write a file so the dir is non-empty
      fs.writeFileSync(path.join(tmpCacheDir, 'dummy.json'), '{}');
      expect(fs.existsSync(tmpCacheDir)).toBe(true);

      clearCache();
      expect(fs.existsSync(tmpCacheDir)).toBe(false);
    });

    it('is a no-op when the directory does not exist', () => {
      fs.rmSync(tmpCacheDir, { recursive: true });
      expect(() => clearCache()).not.toThrow();
    });

    it('resets cacheValidated so ensureCacheValid re-checks', () => {
      // Validate once
      ensureCacheValid();

      // Clear
      clearCache();

      // Next ensureCacheValid should return false (fresh cache)
      const valid = ensureCacheValid();
      expect(valid).toBe(false);
      expect(fs.existsSync(tmpCacheDir)).toBe(true);
    });
  });

  describe('formatBytes() (lines 362-366)', () => {
    it('returns bytes label for values under 1 KB', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('returns KB label for values between 1 KB and 1 MB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(2048)).toBe('2.0 KB');
      expect(formatBytes(1024 * 1023)).toBe('1023.0 KB');
    });

    it('returns MB label for values >= 1 MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
    });
  });

  describe('cachedDirectory() with noCache:true (lines 460-467)', () => {
    it('computes fresh result and writes to cache even when noCache is true', () => {
      const toolName = `test-dir-nocache-${Date.now()}`;
      const dirPath = FIXTURES_DIR;
      const files = [path.join(FIXTURES_DIR, 'simple-component.tsx')];

      resetCacheStats();
      const result = cachedDirectory(toolName, dirPath, files, () => ({ computed: true }), {
        noCache: true,
      });
      expect(result).toEqual({ computed: true });

      // Stats should record a miss (not a hit) for the noCache path.
      const stats = getCacheStats();
      expect(stats.misses).toBeGreaterThanOrEqual(1);

      // Despite noCache, the result is written so a subsequent normal call
      // can hit the cache.
      resetCacheStats();
      const cached2 = cachedDirectory(toolName, dirPath, files, () => ({ computed: false }));
      expect(cached2).toEqual({ computed: true });
      const stats2 = getCacheStats();
      expect(stats2.hits).toBeGreaterThanOrEqual(1);
    });
  });
});
