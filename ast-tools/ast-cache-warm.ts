/**
 * AST Cache Warm-up Tool
 *
 * Pre-populates the AST cache for a directory or the entire codebase.
 * Run this after git pull or before audits to eliminate cold-start latency.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-cache-warm.ts              # warm entire src/
 *   npx tsx scripts/AST/ast-cache-warm.ts src/ui/      # warm specific directory
 *   npx tsx scripts/AST/ast-cache-warm.ts --status     # show cache status
 *   npx tsx scripts/AST/ast-cache-warm.ts --clear      # clear cache
 */

import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT } from './project';
import {
  ensureCacheValid,
  clearCache,
  getCacheInfo,
  resetCacheStats,
  formatBytes,
  getCached,
  setCache,
} from './ast-cache';

// Import analysis functions from each tool
import { analyzeReactFile } from './ast-react-inventory';
import { analyzeComplexity } from './ast-complexity';
import { analyzeTypeSafety } from './ast-type-safety';
import { analyzeSideEffects } from './ast-side-effects';
import { analyzeStorageAccess } from './ast-storage-access';
import { analyzeJsxComplexity } from './ast-jsx-analysis';

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface Tool {
  name: string;
  extensions: string[];
  analyze: (filePath: string) => unknown;
}

const TOOLS: Tool[] = [
  {
    name: 'ast-react-inventory',
    extensions: ['.tsx'],
    analyze: analyzeReactFile,
  },
  {
    name: 'ast-complexity',
    extensions: ['.ts', '.tsx'],
    analyze: analyzeComplexity,
  },
  {
    name: 'ast-type-safety',
    extensions: ['.ts', '.tsx'],
    analyze: analyzeTypeSafety,
  },
  {
    name: 'ast-side-effects',
    extensions: ['.ts', '.tsx'],
    analyze: analyzeSideEffects,
  },
  {
    name: 'ast-storage-access',
    extensions: ['.ts', '.tsx'],
    analyze: analyzeStorageAccess,
  },
  {
    name: 'ast-jsx-analysis',
    extensions: ['.tsx'],
    analyze: analyzeJsxComplexity,
  },
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

function warmTool(tool: Tool, files: string[]): WarmResult {
  const start = Date.now();
  let cached = 0;
  let computed = 0;
  let errors = 0;

  // Filter files by extension
  const relevantFiles = files.filter(f => tool.extensions.some((ext: string) => f.endsWith(ext)));

  for (const filePath of relevantFiles) {
    try {
      // Check if already cached
      const existing = getCached<unknown>(tool.name, filePath);
      if (existing !== null) {
        cached++;
        continue;
      }

      // Compute and cache
      const result = tool.analyze(filePath);
      setCache(tool.name, filePath, result);
      computed++;
    } catch (_e) {
      errors++;
      // Silently skip files that can't be parsed
    }
  }

  return {
    tool: tool.name,
    files: relevantFiles.length,
    cached,
    computed,
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

  for (const tool of TOOLS) {
    process.stdout.write(`  ${tool.name.padEnd(25)} `);
    const result = warmTool(tool, files);
    results.push(result);

    const status =
      result.computed > 0
        ? `${result.computed} computed, ${result.cached} cached`
        : `${result.cached} cached (all hit)`;

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
  console.log(`  Size:     ${formatBytes(info.sizeBytes)}`);
}

// Run CLI
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-cache-warm.ts') || process.argv[1].endsWith('ast-cache-warm'));

if (isDirectRun) {
  main();
}
