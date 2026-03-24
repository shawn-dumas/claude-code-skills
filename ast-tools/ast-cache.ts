/**
 * AST Tool Cache
 *
 * Caches observation tool output keyed by file content hash.
 * Eliminates ts-morph parsing overhead for unchanged files.
 *
 * Cache structure:
 *   .ast-cache/
 *     meta.json                    - { configHash }
 *     ast-react-inventory/
 *       <content-sha256>.json      - cached observations
 *     ast-complexity/
 *       <content-sha256>.json
 *     ...
 *
 * Invalidation:
 *   - Config changes -> delete entire cache
 *   - File content changes -> cache miss (new hash)
 *   - --no-cache flag -> bypass cache
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PROJECT_ROOT } from './project';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(PROJECT_ROOT, '.ast-cache');
const META_FILE = path.join(CACHE_DIR, 'meta.json');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'scripts/AST/ast-config.ts');

interface CacheMeta {
  configHash: string;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
}

// Runtime stats for reporting
const stats: CacheStats = { hits: 0, misses: 0 };

// Memoized cache validity: once validated per process, skip repeat I/O
let cacheValidated = false;

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

/**
 * Compute SHA256 hash of a string.
 */
function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compute hash of file content.
 */
export function hashFileContent(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return sha256(content);
}

/**
 * Compute hash of ast-config.ts to detect config changes.
 */
function getConfigHash(): string {
  if (!fs.existsSync(CONFIG_FILE)) {
    return 'no-config';
  }
  const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return sha256(content);
}

// ---------------------------------------------------------------------------
// Cache directory management
// ---------------------------------------------------------------------------

/**
 * Ensure cache directory exists and config is current.
 * Returns true if cache is valid, false if it was cleared.
 */
export function ensureCacheValid(): boolean {
  if (cacheValidated) return true;

  const currentConfigHash = getConfigHash();

  // Create cache dir if missing
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    writeMeta(currentConfigHash);
    cacheValidated = true;
    return false;
  }

  // Check meta file
  if (!fs.existsSync(META_FILE)) {
    clearCache();
    writeMeta(currentConfigHash);
    cacheValidated = true;
    return false;
  }

  // Check config hash
  const meta = readMeta();
  if (meta.configHash !== currentConfigHash) {
    clearCache();
    writeMeta(currentConfigHash);
    cacheValidated = true;
    return false;
  }

  cacheValidated = true;
  return true;
}

/**
 * Read cache metadata.
 */
function readMeta(): CacheMeta {
  const content = fs.readFileSync(META_FILE, 'utf-8');
  return JSON.parse(content) as CacheMeta;
}

/**
 * Write cache metadata.
 */
function writeMeta(configHash: string): void {
  const meta: CacheMeta = {
    configHash,
    createdAt: Date.now(),
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

/**
 * Clear entire cache directory.
 */
export function clearCache(): void {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
  cacheValidated = false;
}

// ---------------------------------------------------------------------------
// Cache read/write
// ---------------------------------------------------------------------------

/**
 * Get cached result for a tool + file combination.
 * Returns null if not cached.
 */
export function getCached<T>(toolName: string, filePath: string): T | null {
  ensureCacheValid();

  const contentHash = getFileHash(filePath);
  const cacheFile = path.join(CACHE_DIR, toolName, `${contentHash}.json`);

  if (!fs.existsSync(cacheFile)) {
    stats.misses++;
    return null;
  }

  try {
    const content = fs.readFileSync(cacheFile, 'utf-8');
    stats.hits++;
    return JSON.parse(content) as T;
  } catch {
    stats.misses++;
    return null;
  }
}

/**
 * Store result in cache.
 */
export function setCache<T>(toolName: string, filePath: string, result: T): void {
  ensureCacheValid();

  const contentHash = getFileHash(filePath);
  const toolDir = path.join(CACHE_DIR, toolName);
  const cacheFile = path.join(toolDir, `${contentHash}.json`);

  fs.mkdirSync(toolDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
}

/**
 * Get or compute cached result.
 * This is the main entry point for cached tool execution.
 */
export function cached<T>(
  toolName: string,
  filePath: string,
  compute: () => T,
  options: { noCache?: boolean } = {},
): T {
  if (options.noCache) {
    stats.misses++;
    return compute();
  }

  const existing = getCached<T>(toolName, filePath);
  if (existing !== null) {
    return existing;
  }

  const result = compute();
  setCache(toolName, filePath, result);
  return result;
}

// ---------------------------------------------------------------------------
// Stats and reporting
// ---------------------------------------------------------------------------

/**
 * Get cache statistics for current session.
 */
export function getCacheStats(): CacheStats {
  return { ...stats };
}

/**
 * Reset cache statistics.
 */
export function resetCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
}

/**
 * Get cache info for display.
 */
export function getCacheInfo(): {
  exists: boolean;
  configHash: string | null;
  toolDirs: string[];
  totalFiles: number;
  sizeBytes: number;
} {
  if (!fs.existsSync(CACHE_DIR)) {
    return {
      exists: false,
      configHash: null,
      toolDirs: [],
      totalFiles: 0,
      sizeBytes: 0,
    };
  }

  const meta = fs.existsSync(META_FILE) ? readMeta() : null;
  const entries = fs.readdirSync(CACHE_DIR, { withFileTypes: true });
  const toolDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  let totalFiles = 0;
  let sizeBytes = 0;

  for (const toolDir of toolDirs) {
    const toolPath = path.join(CACHE_DIR, toolDir);
    const files = fs.readdirSync(toolPath);
    totalFiles += files.length;
    for (const file of files) {
      const filePath = path.join(toolPath, file);
      const stat = fs.statSync(filePath);
      sizeBytes += stat.size;
    }
  }

  return {
    exists: true,
    configHash: meta?.configHash ?? null,
    toolDirs,
    totalFiles,
    sizeBytes,
  };
}

// ---------------------------------------------------------------------------
// CLI support
// ---------------------------------------------------------------------------

/**
 * Parse --no-cache flag from argv.
 *
 * Prefer `args.flags.has('no-cache')` from the unified parseArgs flags.
 * Kept for backward compatibility with interpreter CLIs.
 */
export function hasNoCacheFlag(argv: string[]): boolean {
  return argv.includes('--no-cache');
}

/**
 * Format bytes as human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Directory-level caching (for interpreters)
// ---------------------------------------------------------------------------

// In-memory hash cache to avoid re-reading files during a single run
const fileHashCache = new Map<string, string>();

/**
 * Get content hash for a file, with in-memory memoization.
 */
export function getFileHash(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);

  if (fileHashCache.has(absolute)) {
    return fileHashCache.get(absolute)!;
  }

  const hash = hashFileContent(absolute);
  fileHashCache.set(absolute, hash);
  return hash;
}

/**
 * Compute a deterministic hash for an entire directory.
 * Hash of sorted file hashes - changes if any file content changes.
 */
export function hashDirectory(dirPath: string, files: string[]): string {
  const fileHashes = files.map(f => getFileHash(f)).sort();
  return sha256(fileHashes.join(':'));
}

/**
 * Get cached result for a directory-level tool (interpreters).
 */
export function getCachedDirectory<T>(toolName: string, dirHash: string): T | null {
  ensureCacheValid();

  const cacheFile = path.join(CACHE_DIR, toolName, `dir-${dirHash}.json`);

  if (!fs.existsSync(cacheFile)) {
    stats.misses++;
    return null;
  }

  try {
    const content = fs.readFileSync(cacheFile, 'utf-8');
    stats.hits++;
    return JSON.parse(content) as T;
  } catch {
    stats.misses++;
    return null;
  }
}

/**
 * Store directory-level result in cache.
 */
export function setCacheDirectory<T>(toolName: string, dirHash: string, result: T): void {
  ensureCacheValid();

  const toolDir = path.join(CACHE_DIR, toolName);
  const cacheFile = path.join(toolDir, `dir-${dirHash}.json`);

  fs.mkdirSync(toolDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
}

/**
 * Get or compute cached result for directory-level tools.
 * Used by interpreters which process entire directories at once.
 */
export function cachedDirectory<T>(
  toolName: string,
  dirPath: string,
  files: string[],
  compute: () => T,
  options: { noCache?: boolean } = {},
): T {
  if (options.noCache) {
    stats.misses++;
    const result = compute();
    // Still write to cache even with noCache (refresh behavior)
    const dirHash = hashDirectory(dirPath, files);
    setCacheDirectory(toolName, dirHash, result);
    return result;
  }

  const dirHash = hashDirectory(dirPath, files);
  const existing = getCachedDirectory<T>(toolName, dirHash);
  if (existing !== null) {
    return existing;
  }

  const result = compute();
  setCacheDirectory(toolName, dirHash, result);
  return result;
}
