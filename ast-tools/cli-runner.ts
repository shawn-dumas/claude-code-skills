/**
 * Shared CLI runner for AST observation tools.
 *
 * Extracts the duplicated main() pattern found across 23+ observation tools
 * into a single, fully-tested function. Each tool provides a config object;
 * this module handles argv parsing, path validation, directory traversal,
 * caching, cache stats, and outputFiltered.
 *
 * For interpreter tools and special-case tools (ast-audit, ast-cache-warm,
 * ast-peer-deps, etc.), use their own main() -- this runner targets the
 * standard observation tool pattern only.
 */

import fs from 'fs';
import path from 'path';
import { type CliArgs, parseArgs, outputFiltered, fatal, type ParseArgsOptions } from './cli';
import { cached, getCacheStats } from './ast-cache';
import { PROJECT_ROOT } from './project';
import type { FileFilter } from './shared';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface DirectoryOpts {
  noCache?: boolean;
  filter?: FileFilter;
}

export interface ObservationToolConfig<TAnalysis> {
  /** Cache namespace passed to cached() (e.g., 'ast-complexity'). */
  cacheNamespace: string;
  /** Full help text printed on --help. Includes trailing newline. */
  helpText: string;
  /** Analyze a single file. Receives the original CLI path (may be relative). */
  analyzeFile: (filePath: string) => TAnalysis;
  /** Analyze all files in a directory. */
  analyzeDirectory: (dirPath: string, opts: DirectoryOpts) => TAnalysis[];
  /** Extra parseArgs options (named options, extra boolean flags). */
  parseOptions?: ParseArgsOptions;
  /**
   * Optional pre-handler. Called after arg parsing but before path validation.
   * Use for modes that bypass the standard path loop (e.g., --from-git).
   * Return true to exit early (skip path validation and analysis loop).
   */
  preHandler?: (args: CliArgs) => boolean;
  /**
   * Optional custom handler. Called after analysis, before standard output.
   * Receives the parsed CLI args and all collected results.
   * Return true to suppress standard outputFiltered call.
   */
  customHandler?: (args: CliArgs, results: TAnalysis[]) => boolean;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a standard observation tool CLI.
 *
 * Pattern: parseArgs -> validate paths -> loop { stat -> dir/file } ->
 * cache stats -> customHandler? -> outputFiltered.
 */
export function runObservationToolCli<TAnalysis>(config: ObservationToolConfig<TAnalysis>): void {
  const args = parseArgs(process.argv, config.parseOptions);

  if (args.help) {
    process.stdout.write(config.helpText);
    process.exit(0);
  }

  if (config.preHandler?.(args)) {
    return;
  }

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const noCache = args.flags.has('no-cache');
  const testFiles = args.flags.has('test-files');

  const allResults: TAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...config.analyzeDirectory(targetPath, {
          noCache,
          filter: testFiles ? 'test' : 'production',
        }),
      );
    } else {
      const result = cached(config.cacheNamespace, absolute, () => config.analyzeFile(targetPath), { noCache });
      allResults.push(result);
    }
  }

  const cacheStats = getCacheStats();
  if (cacheStats.hits > 0 || cacheStats.misses > 0) {
    process.stderr.write(`Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses\n`);
  }

  if (config.customHandler?.(args, allResults)) {
    return;
  }

  const result = allResults.length === 1 ? allResults[0] : allResults;
  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}
