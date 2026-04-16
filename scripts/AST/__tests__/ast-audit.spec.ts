import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main, parseAuditArgs, groupObservations, filterByPriority, commonAncestor } from '../ast-audit';
import type { Observation, Finding } from '../types';

// ---------------------------------------------------------------------------
// parseAuditArgs
// ---------------------------------------------------------------------------

describe('parseAuditArgs', () => {
  it('defaults: src/ path, no output, no cache, no json, no diff, no track, P4 min-priority', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts']);
    expect(args.paths).toEqual(['src/']);
    expect(args.outputDir).toBeNull();
    expect(args.noCache).toBe(false);
    expect(args.json).toBe(false);
    expect(args.diffDir).toBeNull();
    expect(args.track).toBeNull();
    expect(args.minPriority).toBe('P4');
  });

  it('accepts explicit path argument', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', 'src/ui/']);
    expect(args.paths).toEqual(['src/ui/']);
  });

  it('accepts multiple path arguments', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', 'src/ui/', 'src/server/']);
    expect(args.paths).toEqual(['src/ui/', 'src/server/']);
  });

  it('parses --output flag', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--output', '/tmp/out']);
    expect(args.outputDir).toBe('/tmp/out');
  });

  it('parses --no-cache flag', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--no-cache']);
    expect(args.noCache).toBe(true);
  });

  it('parses --json flag', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--json']);
    expect(args.json).toBe(true);
  });

  it('parses --diff flag', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--diff', '/prev/dir']);
    expect(args.diffDir).toBe('/prev/dir');
  });

  it('parses --track fe', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--track', 'fe']);
    expect(args.track).toBe('fe');
  });

  it('parses --track bff', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--track', 'bff']);
    expect(args.track).toBe('bff');
  });

  it('ignores unknown --track value', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--track', 'unknown']);
    expect(args.track).toBeNull();
  });

  it('parses --min-priority P1', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--min-priority', 'P1']);
    expect(args.minPriority).toBe('P1');
  });

  it('parses --min-priority P2', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--min-priority', 'P2']);
    expect(args.minPriority).toBe('P2');
  });

  it('parses --min-priority P3', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--min-priority', 'P3']);
    expect(args.minPriority).toBe('P3');
  });

  it('parses --min-priority P5', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--min-priority', 'P5']);
    expect(args.minPriority).toBe('P5');
  });

  it('ignores unknown --min-priority value, keeps default P4', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--min-priority', 'P9']);
    expect(args.minPriority).toBe('P4');
  });

  it('handles all flags combined', () => {
    const args = parseAuditArgs([
      'node',
      'ast-audit.ts',
      'src/ui/',
      '--output',
      '/tmp/out',
      '--no-cache',
      '--json',
      '--diff',
      '/prev',
      '--track',
      'bff',
      '--min-priority',
      'P2',
    ]);
    expect(args.paths).toEqual(['src/ui/']);
    expect(args.outputDir).toBe('/tmp/out');
    expect(args.noCache).toBe(true);
    expect(args.json).toBe(true);
    expect(args.diffDir).toBe('/prev');
    expect(args.track).toBe('bff');
    expect(args.minPriority).toBe('P2');
  });

  it('skips unknown flags that start with -', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', '--unknown-flag']);
    // Unknown flag is ignored; path defaults to src/
    expect(args.paths).toEqual(['src/']);
  });

  it('treats non-flag args as paths', () => {
    const args = parseAuditArgs(['node', 'ast-audit.ts', 'scripts/', 'src/']);
    expect(args.paths).toEqual(['scripts/', 'src/']);
  });
});

// ---------------------------------------------------------------------------
// groupObservations
// ---------------------------------------------------------------------------

describe('groupObservations', () => {
  function makeObs(kind: string): Observation {
    return { kind, file: 'test.ts', line: 1, evidence: {} } as unknown as Observation;
  }

  it('returns empty groups for empty input', () => {
    const g = groupObservations([]);
    expect(g.effect).toHaveLength(0);
    expect(g.hook).toHaveLength(0);
    expect(g.component).toHaveLength(0);
    expect(g.sideEffect).toHaveLength(0);
    expect(g.jsx).toHaveLength(0);
    expect(g.import).toHaveLength(0);
    expect(g.numberFormat).toHaveLength(0);
    expect(g.nullDisplay).toHaveLength(0);
    expect(g.testCoverage).toHaveLength(0);
    expect(g.all).toHaveLength(0);
  });

  it('routes EFFECT_LOCATION to effect group', () => {
    const g = groupObservations([makeObs('EFFECT_LOCATION')]);
    expect(g.effect).toHaveLength(1);
  });

  it('routes EFFECT_FETCH_CALL to effect group', () => {
    const g = groupObservations([makeObs('EFFECT_FETCH_CALL')]);
    expect(g.effect).toHaveLength(1);
  });

  it('routes EFFECT_DOM_API to effect group', () => {
    const g = groupObservations([makeObs('EFFECT_DOM_API')]);
    expect(g.effect).toHaveLength(1);
  });

  it('routes HOOK_CALL to hook group', () => {
    const g = groupObservations([makeObs('HOOK_CALL')]);
    expect(g.hook).toHaveLength(1);
  });

  it('routes HOOK_DEFINITION to hook group', () => {
    const g = groupObservations([makeObs('HOOK_DEFINITION')]);
    expect(g.hook).toHaveLength(1);
  });

  it('routes COMPONENT_DECLARATION to component group', () => {
    const g = groupObservations([makeObs('COMPONENT_DECLARATION')]);
    expect(g.component).toHaveLength(1);
  });

  it('routes PROP_FIELD to component group', () => {
    const g = groupObservations([makeObs('PROP_FIELD')]);
    expect(g.component).toHaveLength(1);
  });

  it('routes CONSOLE_CALL to sideEffect group', () => {
    const g = groupObservations([makeObs('CONSOLE_CALL')]);
    expect(g.sideEffect).toHaveLength(1);
  });

  it('routes TOAST_CALL to sideEffect group', () => {
    const g = groupObservations([makeObs('TOAST_CALL')]);
    expect(g.sideEffect).toHaveLength(1);
  });

  it('routes WINDOW_MUTATION to sideEffect group', () => {
    const g = groupObservations([makeObs('WINDOW_MUTATION')]);
    expect(g.sideEffect).toHaveLength(1);
  });

  it('routes JSX_TERNARY_CHAIN to jsx group', () => {
    const g = groupObservations([makeObs('JSX_TERNARY_CHAIN')]);
    expect(g.jsx).toHaveLength(1);
  });

  it('routes JSX_RETURN_BLOCK to jsx group', () => {
    const g = groupObservations([makeObs('JSX_RETURN_BLOCK')]);
    expect(g.jsx).toHaveLength(1);
  });

  it('routes STATIC_IMPORT to import group', () => {
    const g = groupObservations([makeObs('STATIC_IMPORT')]);
    expect(g.import).toHaveLength(1);
  });

  it('routes CIRCULAR_DEPENDENCY to import group', () => {
    const g = groupObservations([makeObs('CIRCULAR_DEPENDENCY')]);
    expect(g.import).toHaveLength(1);
  });

  it('routes DEAD_EXPORT_CANDIDATE to import group', () => {
    const g = groupObservations([makeObs('DEAD_EXPORT_CANDIDATE')]);
    expect(g.import).toHaveLength(1);
  });

  it('routes RAW_TO_FIXED to numberFormat group', () => {
    const g = groupObservations([makeObs('RAW_TO_FIXED')]);
    expect(g.numberFormat).toHaveLength(1);
  });

  it('routes FORMAT_NUMBER_CALL to numberFormat group', () => {
    const g = groupObservations([makeObs('FORMAT_NUMBER_CALL')]);
    expect(g.numberFormat).toHaveLength(1);
  });

  it('routes NULL_COALESCE_FALLBACK to nullDisplay group', () => {
    const g = groupObservations([makeObs('NULL_COALESCE_FALLBACK')]);
    expect(g.nullDisplay).toHaveLength(1);
  });

  it('routes NO_FALLBACK_CELL to nullDisplay group', () => {
    const g = groupObservations([makeObs('NO_FALLBACK_CELL')]);
    expect(g.nullDisplay).toHaveLength(1);
  });

  it('routes TEST_COVERAGE to testCoverage group', () => {
    const g = groupObservations([makeObs('TEST_COVERAGE')]);
    expect(g.testCoverage).toHaveLength(1);
  });

  it('does not route unknown kinds to any typed group', () => {
    const g = groupObservations([makeObs('UNKNOWN_FUTURE_KIND')]);
    expect(g.effect).toHaveLength(0);
    expect(g.hook).toHaveLength(0);
    expect(g.component).toHaveLength(0);
    expect(g.sideEffect).toHaveLength(0);
    expect(g.jsx).toHaveLength(0);
    expect(g.import).toHaveLength(0);
    expect(g.numberFormat).toHaveLength(0);
    expect(g.nullDisplay).toHaveLength(0);
    expect(g.testCoverage).toHaveLength(0);
    // But all always contains everything
    expect(g.all).toHaveLength(1);
  });

  it('all group always contains every observation', () => {
    const obs = [makeObs('HOOK_CALL'), makeObs('JSX_RETURN_BLOCK'), makeObs('UNKNOWN_KIND')];
    const g = groupObservations(obs);
    expect(g.all).toHaveLength(3);
  });

  it('handles multiple observations across different groups', () => {
    const obs = [
      makeObs('EFFECT_LOCATION'),
      makeObs('HOOK_CALL'),
      makeObs('COMPONENT_DECLARATION'),
      makeObs('CONSOLE_CALL'),
      makeObs('JSX_TERNARY_CHAIN'),
      makeObs('STATIC_IMPORT'),
      makeObs('RAW_TO_FIXED'),
      makeObs('NULL_COALESCE_FALLBACK'),
      makeObs('TEST_COVERAGE'),
    ];
    const g = groupObservations(obs);
    expect(g.effect).toHaveLength(1);
    expect(g.hook).toHaveLength(1);
    expect(g.component).toHaveLength(1);
    expect(g.sideEffect).toHaveLength(1);
    expect(g.jsx).toHaveLength(1);
    expect(g.import).toHaveLength(1);
    expect(g.numberFormat).toHaveLength(1);
    expect(g.nullDisplay).toHaveLength(1);
    expect(g.testCoverage).toHaveLength(1);
    expect(g.all).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// filterByPriority
// ---------------------------------------------------------------------------

describe('filterByPriority', () => {
  function makeFinding(priority: string): Finding {
    return {
      id: `f-${priority}`,
      kind: 'test',
      priority: priority as Finding['priority'],
      category: 'Bug',
      file: 'test.ts',
      evidence: '',
      rationale: [],
      confidence: 'high',
      source: 'test',
      astConfirmed: false,
      track: 'fe',
    } satisfies Finding;
  }

  const allFindings = ['P1', 'P2', 'P3', 'P4', 'P5'].map(makefinding => makeFinding(makefinding));

  function makeFindings(...priorities: string[]): Finding[] {
    return priorities.map(p => makeFinding(p));
  }

  it('P4 min-priority includes P1-P4 and excludes P5', () => {
    const result = filterByPriority(allFindings, 'P4');
    const priorities = result.map(f => f.priority);
    expect(priorities).toContain('P1');
    expect(priorities).toContain('P2');
    expect(priorities).toContain('P3');
    expect(priorities).toContain('P4');
    expect(priorities).not.toContain('P5');
  });

  it('P1 min-priority includes only P1', () => {
    const result = filterByPriority(allFindings, 'P1');
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe('P1');
  });

  it('P5 min-priority includes all five priorities', () => {
    const result = filterByPriority(allFindings, 'P5');
    expect(result).toHaveLength(5);
  });

  it('P2 min-priority includes P1 and P2 only', () => {
    const result = filterByPriority(allFindings, 'P2');
    const priorities = result.map(f => f.priority);
    expect(priorities).toContain('P1');
    expect(priorities).toContain('P2');
    expect(priorities).not.toContain('P3');
    expect(priorities).not.toContain('P4');
    expect(priorities).not.toContain('P5');
  });

  it('P3 min-priority includes P1, P2, P3 only', () => {
    const result = filterByPriority(allFindings, 'P3');
    const priorities = result.map(f => f.priority);
    expect(priorities).toContain('P1');
    expect(priorities).toContain('P2');
    expect(priorities).toContain('P3');
    expect(priorities).not.toContain('P4');
    expect(priorities).not.toContain('P5');
  });

  it('returns empty array when no findings meet min-priority', () => {
    const result = filterByPriority(makeFindings('P5'), 'P1');
    expect(result).toHaveLength(0);
  });

  it('returns all findings when all meet min-priority', () => {
    const result = filterByPriority(makeFindings('P1', 'P1', 'P2'), 'P3');
    expect(result).toHaveLength(3);
  });

  it('handles empty findings array', () => {
    const result = filterByPriority([], 'P4');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// commonAncestor
// ---------------------------------------------------------------------------

describe('commonAncestor', () => {
  const sep = path.sep;

  it('returns PROJECT_ROOT for empty paths', () => {
    // The function returns PROJECT_ROOT when paths is empty.
    // We just verify it returns a non-empty string.
    const result = commonAncestor([]);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns the single path when given one path', () => {
    const p = `${sep}a${sep}b${sep}c`;
    const result = commonAncestor([p]);
    expect(result).toBe(p);
  });

  it('finds common ancestor of two paths', () => {
    const a = `${sep}a${sep}b${sep}c`;
    const b = `${sep}a${sep}b${sep}d`;
    const result = commonAncestor([a, b]);
    // Common ancestor is /a/b
    expect(result).toBe(`${sep}a${sep}b`);
  });

  it('returns PROJECT_ROOT when paths share no common segments', () => {
    const a = `${sep}x${sep}y`;
    const b = `${sep}z${sep}w`;
    const result = commonAncestor([a, b]);
    // Empty common prefix falls back to PROJECT_ROOT
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles three paths with a common ancestor', () => {
    const a = `${sep}a${sep}b${sep}c1`;
    const b = `${sep}a${sep}b${sep}c2`;
    const c = `${sep}a${sep}b${sep}c3`;
    const result = commonAncestor([a, b, c]);
    expect(result).toBe(`${sep}a${sep}b`);
  });
});

// ---------------------------------------------------------------------------
// main() -- full pipeline tests
// ---------------------------------------------------------------------------

describe('ast-audit main()', () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let originalArgv: string[];

  // The fixtures directory has real TypeScript source files, so pointing the
  // audit at a single known-small file keeps the test fast.
  const FIXTURE_FILE = path.resolve(__dirname, 'fixtures', 'simple-component.tsx');

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    originalArgv = process.argv;
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

  it('non-existent path exits 1', () => {
    process.argv = ['node', 'ast-audit.ts', '/tmp/nonexistent-audit-path-12345'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('--json mode outputs valid JSON array to stdout', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json'];
    main();
    const stdout = stdoutChunks.join('');
    const parsed = JSON.parse(stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  }, 60_000);

  it('default mode outputs markdown summary to stdout', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE];
    main();
    const stdout = stdoutChunks.join('');
    // Markdown summary starts with a heading
    expect(stdout).toMatch(/^#/m);
  }, 60_000);

  it('--track fe filters to fe findings only', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json', '--track', 'fe'];
    main();
    const stdout = stdoutChunks.join('');
    const findings = JSON.parse(stdout) as { track: string }[];
    for (const f of findings) {
      expect(f.track).toBe('fe');
    }
  }, 60_000);

  it('--track bff filters to bff findings only', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json', '--track', 'bff'];
    main();
    const stdout = stdoutChunks.join('');
    const findings = JSON.parse(stdout) as { track: string }[];
    for (const f of findings) {
      expect(f.track).toBe('bff');
    }
  }, 60_000);

  it('--min-priority P1 returns only P1 findings', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json', '--min-priority', 'P1'];
    main();
    const stdout = stdoutChunks.join('');
    const findings = JSON.parse(stdout) as { priority: string }[];
    for (const f of findings) {
      expect(f.priority).toBe('P1');
    }
  }, 60_000);

  it('--min-priority P5 returns more findings than --min-priority P1', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json', '--min-priority', 'P1'];
    main();
    const p1Count = (JSON.parse(stdoutChunks.join('')) as unknown[]).length;

    stdoutChunks = [];
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json', '--min-priority', 'P5'];
    main();
    const p5Count = (JSON.parse(stdoutChunks.join('')) as unknown[]).length;

    expect(p5Count).toBeGreaterThanOrEqual(p1Count);
  }, 120_000);

  it('single file path (not a directory) runs without error', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json'];
    expect(() => main()).not.toThrow();
    const stdout = stdoutChunks.join('');
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  }, 60_000);

  it('phase progress messages are emitted to stderr', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--json'];
    main();
    const stderr = stderrChunks.join('');
    expect(stderr).toContain('Phase 1');
    expect(stderr).toContain('Phase 2');
    expect(stderr).toContain('Phase 3');
    expect(stderr).toContain('Phase 4');
    expect(stderr).toContain('Phase 5');
    expect(stderr).toContain('Phase 6');
    expect(stderr).toContain('Phase 7');
    expect(stderr).toContain('Phase 8');
  }, 60_000);

  it('--output writes findings.json and summary.md to a temp directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-audit-test-'));
    try {
      process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--output', tmpDir];
      main();
      expect(fs.existsSync(path.join(tmpDir, 'findings.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'summary.md'))).toBe(true);
      // findings.json should be valid JSON array
      const content = fs.readFileSync(path.join(tmpDir, 'findings.json'), 'utf-8');
      expect(Array.isArray(JSON.parse(content))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--diff with a previous findings.json emits diff output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-audit-diff-test-'));
    try {
      // First run: produce findings.json in tmpDir
      process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--output', tmpDir];
      main();

      // Reset stdout capture for diff run
      stdoutChunks = [];

      // Second run: diff against that previous output
      process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--diff', tmpDir];
      main();
      // Diff run should succeed without throwing
      // It writes diff to stdout (no --output) or to file (with --output)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('--diff with missing findings.json exits 1', () => {
    process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--diff', '/tmp/nonexistent-diff-dir-99999'];
    expect(() => main()).toThrow('process.exit(1)');
  }, 60_000);

  it('--diff --output writes diff.md to output directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-audit-diff-out-'));
    const prevDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-audit-prev-'));
    try {
      // Produce a previous findings.json
      process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--output', prevDir];
      main();

      stdoutChunks = [];

      // Diff with output
      process.argv = ['node', 'ast-audit.ts', FIXTURE_FILE, '--diff', prevDir, '--output', tmpDir];
      main();

      expect(fs.existsSync(path.join(tmpDir, 'diff.md'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(prevDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('directory path runs all phases without error', () => {
    // Use a small directory -- the effect-negative fixture dir is just a few files
    const smallDir = path.resolve(__dirname, 'fixtures', 'handler-structure-clean');
    process.argv = ['node', 'ast-audit.ts', smallDir, '--json'];
    expect(() => main()).not.toThrow();
    const stdout = stdoutChunks.join('');
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  }, 60_000);

  it('two path args use commonAncestor for import graph', () => {
    const file1 = FIXTURE_FILE;
    const file2 = path.resolve(__dirname, 'fixtures', 'effect-negative.tsx');
    process.argv = ['node', 'ast-audit.ts', file1, file2, '--json'];
    expect(() => main()).not.toThrow();
    const stdout = stdoutChunks.join('');
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  }, 60_000);
});
