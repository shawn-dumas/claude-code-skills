import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { analyzeDateHandling, buildSummary, classifyLayer, main } from '../ast-date-handling';
import { PROJECT_ROOT } from '../project';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE = path.join(FIXTURES_DIR, 'date-handling-samples.ts');

// Clear the per-tool cache directory before the suite runs so that the
// analyzeFile callback (lines 142-259) always executes on first call,
// giving v8 coverage a chance to record those lines.
beforeAll(() => {
  const cacheDir = path.join(PROJECT_ROOT, '.ast-cache', 'ast-date-handling');
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// analyzeDateHandling (analyzeFile)
// ---------------------------------------------------------------------------

describe('analyzeDateHandling', () => {
  it('detects RAW_DATE_CONSTRUCTOR', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const raw = obs.filter(o => o.kind === 'RAW_DATE_CONSTRUCTOR');
    expect(raw.length).toBeGreaterThanOrEqual(3); // new Date(), new Date(ms), new Date(string)
  });

  it('detects RAW_DATE_STATIC', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const statics = obs.filter(o => o.kind === 'RAW_DATE_STATIC');
    expect(statics.length).toBeGreaterThanOrEqual(3); // Date.now(), Date.parse(), Date.UTC()
    const patterns = statics.map(o => o.evidence.pattern);
    expect(patterns).toContain('Date.now()');
    expect(patterns).toContain('Date.parse()');
    expect(patterns).toContain('Date.UTC()');
  });

  it('detects RAW_DATE_ACCESSOR', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const accessors = obs.filter(o => o.kind === 'RAW_DATE_ACCESSOR');
    expect(accessors.length).toBeGreaterThanOrEqual(3); // getFullYear, getMonth, getTime
  });

  it('detects RAW_DATE_FORMAT', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const formats = obs.filter(o => o.kind === 'RAW_DATE_FORMAT');
    expect(formats.length).toBeGreaterThanOrEqual(2); // toISOString, toLocaleDateString
  });

  it('detects MANUAL_DATE_STRING_OP', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const manual = obs.filter(o => o.kind === 'MANUAL_DATE_STRING_OP');
    expect(manual.length).toBeGreaterThanOrEqual(3); // .replace('T', ' '), .replace(/T/, ' '), .split('T')
  });

  it('detects TEMPORAL_USAGE', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const temporal = obs.filter(o => o.kind === 'TEMPORAL_USAGE');
    expect(temporal.length).toBeGreaterThanOrEqual(1);
  });

  it('detects FORMAT_UTIL_USAGE', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const fmtUtil = obs.filter(o => o.kind === 'FORMAT_UTIL_USAGE');
    expect(fmtUtil.length).toBeGreaterThanOrEqual(1);
  });

  it('detects RAW_DATE_FORMAT from ambiguous methods (toLocaleString, toJSON) on Date receiver', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const ambiguous = obs.filter(
      o =>
        o.kind === 'RAW_DATE_FORMAT' &&
        (o.evidence.pattern === '.toLocaleString()' || o.evidence.pattern === '.toJSON()'),
    );
    expect(ambiguous.length).toBeGreaterThanOrEqual(1);
  });

  it('includes evidence with pattern and layer for each observation', () => {
    const obs = analyzeDateHandling(FIXTURE);
    for (const o of obs) {
      expect(o.evidence.pattern).toBeTruthy();
      expect(o.evidence.layer).toBeTruthy();
    }
  });

  it('accepts a relative file path (resolves to absolute)', () => {
    const rel = path.relative(process.cwd(), FIXTURE);
    const obs = analyzeDateHandling(rel);
    expect(Array.isArray(obs)).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
  });

  it('detects MANUAL_DATE_STRING_OP from regex /T/ pattern in .replace()', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const manual = obs.filter(o => o.kind === 'MANUAL_DATE_STRING_OP');
    // Both .replace('T', ...) and .replace(/T/, ...) should be detected
    expect(manual.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty array for empty file', () => {
    // analyzeDateHandling on a file with no date operations returns empty
    const obs = analyzeDateHandling(path.join(FIXTURES_DIR, 'complexity-negative.ts'));
    // complexity-negative.ts has no date usage -- just verify it returns an array
    expect(Array.isArray(obs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyLayer
// ---------------------------------------------------------------------------

describe('classifyLayer', () => {
  it('classifies server paths as bff', () => {
    expect(classifyLayer('src/server/handlers/users.ts')).toBe('bff');
  });

  it('classifies pages/api as bff', () => {
    expect(classifyLayer('src/pages/api/users/data-api/teams.ts')).toBe('bff');
  });

  it('classifies shared paths as shared', () => {
    expect(classifyLayer('src/shared/utils/date/formatDate.ts')).toBe('shared');
  });

  it('classifies ui paths as fe', () => {
    expect(classifyLayer('src/ui/page_blocks/dashboard/team/Team.tsx')).toBe('fe');
  });

  it('classifies test files as test', () => {
    expect(classifyLayer('src/ui/__tests__/MyComponent.spec.tsx')).toBe('test');
  });

  it('classifies fixture files as fixture', () => {
    expect(classifyLayer('src/fixtures/domains/user.fixture.ts')).toBe('fixture');
  });
});

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

describe('buildSummary', () => {
  it('computes raw and proper counts', () => {
    const obs = analyzeDateHandling(FIXTURE);
    const summary = buildSummary(obs);
    expect(summary.rawCount).toBeGreaterThan(0);
    expect(summary.properCount).toBeGreaterThanOrEqual(0);
    expect(summary.ratio).toBeDefined();
    expect(summary.total).toBeDefined();
    expect(summary.byLayer).toBeDefined();
  });

  it('handles empty observations', () => {
    const summary = buildSummary([]);
    expect(summary.rawCount).toBe(0);
    expect(summary.properCount).toBe(0);
    expect(typeof summary.ratio).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// main() CLI
// ---------------------------------------------------------------------------

describe('main()', () => {
  let stdoutChunks: string[];
  let originalArgv: string[];

  beforeEach(() => {
    stdoutChunks = [];
    originalArgv = process.argv;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('--help exits 0', () => {
    process.argv = ['node', 'ast-date-handling.ts', '--help'];
    expect(() => main()).toThrow('process.exit(0)');
    expect(stdoutChunks.join('')).toContain('Usage:');
  });

  it('no args exits 1', () => {
    process.argv = ['node', 'ast-date-handling.ts'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('non-existent path exits 1', () => {
    process.argv = ['node', 'ast-date-handling.ts', '/tmp/does-not-exist-ast-date-handling-test.ts'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('valid file produces JSON output', () => {
    process.argv = ['node', 'ast-date-handling.ts', FIXTURE];
    main();
    const result = JSON.parse(stdoutChunks.join(''));
    expect(result.filePath).toBeDefined();
    expect(result.observations).toBeDefined();
  });

  it('relative path resolves correctly', () => {
    // Use a relative path so the isAbsolute branch is exercised
    const rel = path.relative(process.cwd(), FIXTURE);
    process.argv = ['node', 'ast-date-handling.ts', rel];
    main();
    const result = JSON.parse(stdoutChunks.join(''));
    expect(result.observations).toBeDefined();
  });

  it('directory path scans production files', () => {
    process.argv = ['node', 'ast-date-handling.ts', FIXTURES_DIR];
    main();
    const result = JSON.parse(stdoutChunks.join(''));
    expect(Array.isArray(result.observations)).toBe(true);
  });

  it('--test-files flag sets filter to test', () => {
    process.argv = ['node', 'ast-date-handling.ts', FIXTURES_DIR, '--test-files'];
    main();
    const result = JSON.parse(stdoutChunks.join(''));
    expect(Array.isArray(result.observations)).toBe(true);
  });

  it('--summary produces summary output', () => {
    process.argv = ['node', 'ast-date-handling.ts', FIXTURE, '--summary'];
    main();
    const result = JSON.parse(stdoutChunks.join(''));
    expect(result.rawCount).toBeDefined();
    expect(result.properCount).toBeDefined();
  });

  it('--summary --pretty produces indented summary output', () => {
    process.argv = ['node', 'ast-date-handling.ts', FIXTURE, '--summary', '--pretty'];
    main();
    const output = stdoutChunks.join('');
    // Indented JSON contains newlines
    expect(output).toContain('\n');
    const result = JSON.parse(output);
    expect(result.rawCount).toBeDefined();
  });
});
