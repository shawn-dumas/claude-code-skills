/**
 * Tests for the shared CLI runner (cli-runner.ts).
 *
 * Verifies every branch in runObservationToolCli:
 * - --help flag
 * - No paths (fatal)
 * - Non-existent path (fatal)
 * - Single file analysis
 * - Directory analysis
 * - Multiple paths (file + dir)
 * - --no-cache flag
 * - --test-files flag
 * - --kind filtering
 * - --count mode
 * - Cache stats output
 * - Custom handler (returns true = suppresses output)
 * - Custom handler (returns false = continues to output)
 * - parseOptions passthrough
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Mock ast-cache so cached() just calls the factory and getCacheStats returns
// controllable values. This isolates the runner from real cache state.
const mockGetCacheStats = vi.fn().mockReturnValue({ hits: 0, misses: 0 });
vi.mock('../ast-cache', () => ({
  cached: <T>(_ns: string, _fp: string, factory: () => T) => factory(),
  getCacheStats: () => mockGetCacheStats(),
}));

import { runObservationToolCli, type ObservationToolConfig } from '../cli-runner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_FILE = path.join(FIXTURES_DIR, 'complexity-samples.ts');

/** Build a minimal config for testing. */
function buildConfig(
  overrides: Partial<ObservationToolConfig<{ filePath: string; data: string }>> = {},
): ObservationToolConfig<{ filePath: string; data: string }> {
  return {
    cacheNamespace: 'test-tool',
    helpText: 'Usage: test-tool <path>\n',
    analyzeFile: (fp: string) => ({ filePath: fp, data: 'file-result' }),
    analyzeDirectory: (dp: string) => [{ filePath: dp, data: 'dir-result' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Process mock helpers
// ---------------------------------------------------------------------------

let stdoutChunks: string[];
let stderrChunks: string[];
let originalArgv: string[];

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  originalArgv = process.argv;
  mockGetCacheStats.mockReturnValue({ hits: 0, misses: 0 });

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

function setArgv(...args: string[]): void {
  process.argv = ['node', 'test-tool.ts', ...args];
}

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runObservationToolCli', () => {
  describe('--help', () => {
    it('prints help text and exits with 0', () => {
      setArgv('--help');
      expect(() => runObservationToolCli(buildConfig())).toThrow('process.exit(0)');
      expect(stdout()).toBe('Usage: test-tool <path>\n');
    });
  });

  describe('no paths', () => {
    it('calls fatal with no-path message', () => {
      setArgv();
      expect(() => runObservationToolCli(buildConfig())).toThrow('process.exit(1)');
      expect(stderr()).toContain('No file or directory path provided');
    });
  });

  describe('non-existent path', () => {
    it('calls fatal with path-not-found message', () => {
      setArgv('/does/not/exist/file.ts');
      expect(() => runObservationToolCli(buildConfig())).toThrow('process.exit(1)');
      expect(stderr()).toContain('Path does not exist');
    });
  });

  describe('single file analysis', () => {
    it('analyzes a single file and outputs JSON', () => {
      const analyzeFile = vi.fn().mockReturnValue({ filePath: 'f.ts', observations: [] });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile }));

      expect(analyzeFile).toHaveBeenCalledTimes(1);
      expect(analyzeFile).toHaveBeenCalledWith(FIXTURE_FILE);
      const parsed = JSON.parse(stdout());
      expect(parsed).toEqual({ filePath: 'f.ts', observations: [] });
    });

    it('resolves relative paths against PROJECT_ROOT', () => {
      const analyzeFile = vi.fn().mockReturnValue({ data: 'rel' });
      // Use a relative path that exists when resolved from the project root
      setArgv('scripts/AST/__tests__/fixtures/complexity-samples.ts');
      runObservationToolCli(buildConfig({ analyzeFile }));

      expect(analyzeFile).toHaveBeenCalledTimes(1);
      // The runner passes the original relative path to analyzeFile
      expect(analyzeFile).toHaveBeenCalledWith('scripts/AST/__tests__/fixtures/complexity-samples.ts');
    });
  });

  describe('directory analysis', () => {
    it('calls analyzeDirectory with production filter by default', () => {
      const analyzeDirectory = vi.fn().mockReturnValue([{ filePath: 'd', observations: [] }]);
      setArgv(FIXTURES_DIR);
      runObservationToolCli(buildConfig({ analyzeDirectory }));

      expect(analyzeDirectory).toHaveBeenCalledTimes(1);
      expect(analyzeDirectory).toHaveBeenCalledWith(FIXTURES_DIR, { noCache: false, filter: 'production' });
    });
  });

  describe('multiple paths', () => {
    it('collects results from both files and directories into an array', () => {
      const analyzeFile = vi.fn().mockReturnValue({ filePath: 'file', data: 'f' });
      const analyzeDirectory = vi.fn().mockReturnValue([{ filePath: 'dir', data: 'd' }]);
      setArgv(FIXTURE_FILE, FIXTURES_DIR);
      runObservationToolCli(buildConfig({ analyzeFile, analyzeDirectory }));

      expect(analyzeFile).toHaveBeenCalledTimes(1);
      expect(analyzeDirectory).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(stdout());
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ filePath: 'file', data: 'f' });
      expect(parsed[1]).toEqual({ filePath: 'dir', data: 'd' });
    });
  });

  describe('--no-cache flag', () => {
    it('passes noCache: true to analyzeDirectory', () => {
      const analyzeDirectory = vi.fn().mockReturnValue([]);
      setArgv(FIXTURES_DIR, '--no-cache');
      runObservationToolCli(buildConfig({ analyzeDirectory }));

      expect(analyzeDirectory).toHaveBeenCalledWith(FIXTURES_DIR, { noCache: true, filter: 'production' });
    });
  });

  describe('--test-files flag', () => {
    it('passes filter: test to analyzeDirectory', () => {
      const analyzeDirectory = vi.fn().mockReturnValue([]);
      setArgv(FIXTURES_DIR, '--test-files');
      runObservationToolCli(buildConfig({ analyzeDirectory }));

      expect(analyzeDirectory).toHaveBeenCalledWith(FIXTURES_DIR, { noCache: false, filter: 'test' });
    });
  });

  describe('--kind filtering', () => {
    it('filters observations to matching kind', () => {
      const analyzeFile = vi.fn().mockReturnValue({
        filePath: 'f.ts',
        observations: [
          { kind: 'A', file: 'f.ts', line: 1 },
          { kind: 'B', file: 'f.ts', line: 2 },
        ],
      });
      setArgv(FIXTURE_FILE, '--kind', 'A');
      runObservationToolCli(buildConfig({ analyzeFile }));

      const parsed = JSON.parse(stdout());
      expect(parsed.observations).toEqual([{ kind: 'A', file: 'f.ts', line: 1 }]);
    });
  });

  describe('--count mode', () => {
    it('outputs observation kind counts', () => {
      const analyzeFile = vi.fn().mockReturnValue({
        filePath: 'f.ts',
        observations: [
          { kind: 'A', file: 'f.ts', line: 1 },
          { kind: 'A', file: 'f.ts', line: 2 },
          { kind: 'B', file: 'f.ts', line: 3 },
        ],
      });
      setArgv(FIXTURE_FILE, '--count');
      runObservationToolCli(buildConfig({ analyzeFile }));

      const parsed = JSON.parse(stdout());
      expect(parsed).toEqual({ A: 2, B: 1 });
    });
  });

  describe('--pretty flag', () => {
    it('outputs indented JSON', () => {
      const analyzeFile = vi.fn().mockReturnValue({ filePath: 'f.ts', data: 1 });
      setArgv(FIXTURE_FILE, '--pretty');
      runObservationToolCli(buildConfig({ analyzeFile }));

      const out = stdout();
      expect(out).toContain('  "filePath"');
      expect(out).toContain('  "data"');
    });
  });

  describe('cache stats', () => {
    it('prints cache stats to stderr when hits or misses > 0', () => {
      mockGetCacheStats.mockReturnValue({ hits: 3, misses: 1 });
      const analyzeFile = vi.fn().mockReturnValue({ data: 'x' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile }));

      expect(stderr()).toContain('Cache: 3 hits, 1 misses');
    });

    it('does not print cache stats when both hits and misses are 0', () => {
      mockGetCacheStats.mockReturnValue({ hits: 0, misses: 0 });
      const analyzeFile = vi.fn().mockReturnValue({ data: 'x' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile }));

      expect(stderr()).not.toContain('Cache:');
    });
  });

  describe('preHandler', () => {
    it('exits early when preHandler returns true', () => {
      const preHandler = vi.fn().mockReturnValue(true);
      const analyzeFile = vi.fn();
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ preHandler, analyzeFile }));

      expect(preHandler).toHaveBeenCalledTimes(1);
      expect(preHandler.mock.calls[0][0]).toHaveProperty('paths');
      // analyzeFile should never be called -- preHandler short-circuited
      expect(analyzeFile).not.toHaveBeenCalled();
      expect(stdout()).toBe('');
    });

    it('continues normally when preHandler returns false', () => {
      const preHandler = vi.fn().mockReturnValue(false);
      const analyzeFile = vi.fn().mockReturnValue({ data: 'ok' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ preHandler, analyzeFile }));

      expect(preHandler).toHaveBeenCalledTimes(1);
      expect(analyzeFile).toHaveBeenCalledTimes(1);
    });

    it('skips preHandler when not provided', () => {
      const analyzeFile = vi.fn().mockReturnValue({ data: 'z' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile, preHandler: undefined }));

      const parsed = JSON.parse(stdout());
      expect(parsed).toEqual({ data: 'z' });
    });
  });

  describe('customHandler', () => {
    it('suppresses standard output when customHandler returns true', () => {
      const customHandler = vi.fn().mockReturnValue(true);
      const analyzeFile = vi.fn().mockReturnValue({ data: 'x' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile, customHandler }));

      expect(customHandler).toHaveBeenCalledTimes(1);
      // First arg is the parsed CliArgs
      expect(customHandler.mock.calls[0][0]).toHaveProperty('paths');
      expect(customHandler.mock.calls[0][0]).toHaveProperty('pretty');
      // Second arg is the results array
      expect(customHandler.mock.calls[0][1]).toEqual([{ data: 'x' }]);
      // No standard JSON output
      expect(stdout()).toBe('');
    });

    it('continues to standard output when customHandler returns false', () => {
      const customHandler = vi.fn().mockReturnValue(false);
      const analyzeFile = vi.fn().mockReturnValue({ data: 'x' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile, customHandler }));

      expect(customHandler).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(stdout());
      expect(parsed).toEqual({ data: 'x' });
    });

    it('skips customHandler when not provided', () => {
      const analyzeFile = vi.fn().mockReturnValue({ data: 'y' });
      setArgv(FIXTURE_FILE);
      runObservationToolCli(buildConfig({ analyzeFile, customHandler: undefined }));

      const parsed = JSON.parse(stdout());
      expect(parsed).toEqual({ data: 'y' });
    });
  });

  describe('parseOptions passthrough', () => {
    it('passes extra named options to parseArgs', () => {
      const customHandler = vi.fn().mockImplementation((args: { options: Record<string, string> }) => {
        expect(args.options['summary-mode']).toBe('compact');
        return true;
      });
      setArgv(FIXTURE_FILE, '--summary-mode', 'compact');
      runObservationToolCli(
        buildConfig({
          customHandler,
          parseOptions: { namedOptions: ['--summary-mode'] },
        }),
      );

      expect(customHandler).toHaveBeenCalledTimes(1);
    });

    it('passes extra boolean flags to parseArgs', () => {
      const customHandler = vi.fn().mockImplementation((args: { flags: Set<string> }) => {
        expect(args.flags.has('summary')).toBe(true);
        return true;
      });
      setArgv(FIXTURE_FILE, '--summary');
      runObservationToolCli(
        buildConfig({
          customHandler,
          parseOptions: { extraBooleanFlags: ['--summary'] },
        }),
      );

      expect(customHandler).toHaveBeenCalledTimes(1);
    });
  });
});
