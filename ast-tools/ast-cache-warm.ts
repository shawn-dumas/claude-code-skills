/**
 * AST Cache Warm-up Tool
 *
 * Pre-populates the AST cache for a directory or the entire codebase.
 * Run this after git pull or before audits to eliminate cold-start latency.
 *
 * Uses the same tool registry adapters and `cached()` wrapper as
 * `runAllObservers` / `runObservers` so the warm-up cache entries are
 * structurally identical to what the audit pipeline produces.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-cache-warm.ts              # warm entire src/
 *   npx tsx scripts/AST/ast-cache-warm.ts src/ui/      # warm specific directory
 *   npx tsx scripts/AST/ast-cache-warm.ts --status     # show cache status
 *   npx tsx scripts/AST/ast-cache-warm.ts --clear      # clear cache
 */

import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT, getSourceFile } from './project';
import {
  ensureCacheValid,
  clearCache,
  getCacheInfo,
  getCacheStats,
  resetCacheStats,
  formatBytes,
  cached,
} from './ast-cache';
import { TOOL_REGISTRY } from './tool-registry';
import type { AnyObservation } from './types';

// ---------------------------------------------------------------------------
// Tool subset for warm-up (extension filtering)
// ---------------------------------------------------------------------------

interface WarmTarget {
  name: string;
  extensions: string[];
}

/**
 * Subset of registry tools to warm, with file-extension filters.
 * Tools not listed here are skipped during warm-up (e.g., test-analysis
 * which only applies to test files and is not worth pre-warming).
 */
const WARM_TARGETS: WarmTarget[] = [
  { name: 'react-inventory', extensions: ['.tsx'] },
  { name: 'complexity', extensions: ['.ts', '.tsx'] },
  { name: 'type-safety', extensions: ['.ts', '.tsx'] },
  { name: 'side-effects', extensions: ['.ts', '.tsx'] },
  { name: 'storage-access', extensions: ['.ts', '.tsx'] },
  { name: 'jsx-analysis', extensions: ['.tsx'] },
];

// ---------------------------------------------------------------------------
// File discovery (includes test files for comprehensive caching)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.ast-cache', '.git']);

function isTypeScriptFile(name: string): boolean {
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false;
  if (name.endsWith('.d.ts')) return false;
  return true;
}

function findFilesRecursive(dirPath: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findFilesRecursive(fullPath, results);
    } else if (entry.isFile() && isTypeScriptFile(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

function findFiles(targetDir: string): string[] {
  return findFilesRecursive(targetDir).sort();
}

// ---------------------------------------------------------------------------
// Warm-up logic
// ---------------------------------------------------------------------------

interface WarmResult {
  tool: string;
  files: number;
  cached: number;
  computed: number;
  errors: number;
  timeMs: number;
}

function warmTool(target: WarmTarget, files: string[]): WarmResult {
  const start = Date.now();
  let hitCount = 0;
  let computedCount = 0;
  let errors = 0;

  const entry = TOOL_REGISTRY.get(target.name);
  if (!entry) {
    throw new Error(`Warm target '${target.name}' not found in TOOL_REGISTRY`);
  }

  // Filter files by extension
  const relevantFiles = files.filter(f => target.extensions.some((ext: string) => f.endsWith(ext)));

  for (const filePath of relevantFiles) {
    try {
      const sf = getSourceFile(filePath);
      // Use cached() with the same adapter as the registry, so the
      // cached shape (AnyObservation[]) matches what runAllObservers
      // will read back. Detect hit/miss via the global stats counter.
      const before = getCacheStats().hits;
      cached<AnyObservation[]>(entry.name, filePath, () => entry.analyze(sf, filePath));
      const after = getCacheStats().hits;

      if (after > before) {
        hitCount++;
      } else {
        computedCount++;
      }
    } catch (_e) {
      errors++;
      // Silently skip files that can't be parsed
    }
  }

  return {
    tool: target.name,
    files: relevantFiles.length,
    cached: hitCount,
    computed: computedCount,
    errors,
    timeMs: Date.now() - start,
  };
}

function warmAll(targetDir: string): WarmResult[] {
  ensureCacheValid();
  resetCacheStats();

  // Find all relevant files once
  const files = findFiles(targetDir);

  console.log(`Found ${files.length} files in ${path.relative(PROJECT_ROOT, targetDir) || '.'}`);
  console.log('');

  const results: WarmResult[] = [];

  for (const target of WARM_TARGETS) {
    process.stdout.write(`  ${target.name.padEnd(25)} `);
    const result = warmTool(target, files);
    results.push(result);

    const parts: string[] = [];
    if (result.computed > 0) parts.push(`${result.computed} computed`);
    if (result.cached > 0) {
      const allHit = result.computed === 0 && result.errors === 0;
      parts.push(`${result.cached} cached${allHit ? ' (all hit)' : ''}`);
    }
    if (result.errors > 0) parts.push(`${result.errors} errors`);
    const status = parts.length > 0 ? parts.join(', ') : 'no matching files';

    console.log(`${status} (${result.timeMs}ms)`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function showStatus(): void {
  const info = getCacheInfo();

  if (!info.exists) {
    console.log('Cache: not initialized');
    console.log('Run `npx tsx scripts/AST/ast-cache-warm.ts` to warm the cache.');
    return;
  }

  console.log('Cache Status:');
  console.log(`  Location:    .ast-cache/`);
  console.log(`  Config hash: ${info.configHash?.slice(0, 12)}...`);
  console.log(`  Tools:       ${info.toolDirs.join(', ')}`);
  console.log(`  Files:       ${info.totalFiles}`);
  console.log(`  Size:        ${formatBytes(info.sizeBytes)}`);
}

function showHelp(): void {
  console.log(`AST Cache Warm-up Tool

Usage:
  npx tsx scripts/AST/ast-cache-warm.ts [options] [directory]

Options:
  --status    Show cache status
  --clear     Clear the cache
  --help      Show this help

Examples:
  npx tsx scripts/AST/ast-cache-warm.ts              # warm entire src/
  npx tsx scripts/AST/ast-cache-warm.ts src/ui/      # warm specific directory
  npx tsx scripts/AST/ast-cache-warm.ts --status     # show cache info
  npx tsx scripts/AST/ast-cache-warm.ts --clear      # delete cache
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--status')) {
    showStatus();
    return;
  }

  if (args.includes('--clear')) {
    clearCache();
    console.log('Cache cleared.');
    return;
  }

  // Determine target directory
  const targetArg = args.find(a => !a.startsWith('-'));
  const targetDir = targetArg ? path.resolve(PROJECT_ROOT, targetArg) : path.join(PROJECT_ROOT, 'src');

  if (!fs.existsSync(targetDir)) {
    console.error(`Error: Directory not found: ${targetDir}`);
    process.exit(1);
  }

  console.log('Warming AST cache...');
  console.log('');

  const start = Date.now();
  const results = warmAll(targetDir);
  const totalTime = Date.now() - start;

  console.log('');

  const totalComputed = results.reduce((sum, r) => sum + r.computed, 0);
  const totalCached = results.reduce((sum, r) => sum + r.cached, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

  console.log(`Done in ${totalTime}ms`);
  console.log(`  Computed: ${totalComputed} files`);
  console.log(`  Cached:   ${totalCached} files (cache hits)`);
  if (totalErrors > 0) {
    console.log(`  Errors:   ${totalErrors} files (skipped)`);
  }

  // Show cache size
  const info = getCacheInfo();
  console.log(`  Size:      ${formatBytes(info.sizeBytes)}`);
}

// Run CLI
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-cache-warm.ts') || process.argv[1].endsWith('ast-cache-warm'));

if (isDirectRun) {
  main();
}
