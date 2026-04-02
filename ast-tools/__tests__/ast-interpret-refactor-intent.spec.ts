import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { interpretRefactorIntent, prettyPrint, main } from '../ast-interpret-refactor-intent';
import { computeBoundaryConfidence } from '../shared';
import { astConfig } from '../ast-config';
import type {
  AnyObservation,
  AuditContext,
  RefactorSignalPair,
  HookObservation,
  SideEffectObservation,
  DataLayerObservation,
  ComponentObservation,
} from '../types';

// ---------------------------------------------------------------------------
// Observation builders
// ---------------------------------------------------------------------------

function makeHookCall(
  file: string,
  line: number,
  hookName: string,
  extra: Partial<HookObservation['evidence']> = {},
): HookObservation {
  return {
    kind: 'HOOK_CALL',
    file,
    line,
    evidence: { hookName, ...extra },
  };
}

function makeSideEffect(
  kind: SideEffectObservation['kind'],
  file: string,
  line: number,
  extra: Partial<SideEffectObservation['evidence']> = {},
): SideEffectObservation {
  return { kind, file, line, evidence: extra };
}

function makeDataLayer(
  kind: DataLayerObservation['kind'],
  file: string,
  line: number,
  extra: Partial<DataLayerObservation['evidence']> = {},
): DataLayerObservation {
  return { kind, file, line, evidence: extra };
}

function makeComponent(file: string, line: number, componentName: string): ComponentObservation {
  return {
    kind: 'COMPONENT_DECLARATION',
    file,
    line,
    evidence: { componentName, kind: 'function' },
  };
}

/**
 * Build a RefactorSignalPair with pre-matched, unmatched, and novel signals.
 */
function buildPair(opts: {
  beforeFiles?: string[];
  afterFiles?: string[];
  beforeObs?: AnyObservation[];
  afterObs?: AnyObservation[];
  matched?: { before: AnyObservation; after: AnyObservation; similarity: number }[];
  unmatched?: AnyObservation[];
  novel?: AnyObservation[];
}): RefactorSignalPair {
  return {
    before: {
      files: opts.beforeFiles ?? ['src/before.tsx'],
      observations: opts.beforeObs ?? [],
    },
    after: {
      files: opts.afterFiles ?? ['src/after.tsx'],
      observations: opts.afterObs ?? [],
    },
    matched: opts.matched ?? [],
    unmatched: opts.unmatched ?? [],
    novel: opts.novel ?? [],
  };
}

describe('ast-interpret-refactor-intent', () => {
  describe('classification logic', () => {
    it('classifies all preserved when before and after signals are identical', () => {
      const hookA = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hookB = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const comp = makeComponent('src/comp.tsx', 5, 'MyComp');
      const compAfter = makeComponent('src/comp.tsx', 5, 'MyComp');

      const pair = buildPair({
        beforeObs: [hookA, comp],
        afterObs: [hookB, compAfter],
        matched: [
          { before: hookA, after: hookB, similarity: 1.0 },
          { before: comp, after: compAfter, similarity: 1.0 },
        ],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.score).toBe(100);
      expect(report.summary.preserved).toBe(2);
      expect(report.summary.accidentallyDropped).toBe(0);
      expect(report.summary.intentionallyRemoved).toBe(0);
      expect(report.summary.added).toBe(0);
      expect(report.summary.changed).toBe(0);
    });

    it('classifies intentional removal when audit context flags the kind and location', () => {
      const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
        object: 'toast',
        method: 'success',
      });

      const auditContext: AuditContext = {
        flaggedKinds: new Set(['TOAST_CALL']),
        flaggedLocations: [{ file: 'src/hook.ts', line: 25, kind: 'TOAST_CALL' }],
        refactorType: 'service-hook',
      };

      const pair = buildPair({
        beforeObs: [toast],
        unmatched: [toast],
      });

      const report = interpretRefactorIntent(pair, auditContext);

      expect(report.summary.intentionallyRemoved).toBe(1);
      expect(report.summary.accidentallyDropped).toBe(0);
      const signal = report.signals.find(s => s.classification === 'INTENTIONALLY_REMOVED');
      expect(signal).toBeDefined();
      expect(signal!.confidence).toBe('high');
      expect(signal!.rationale).toContain('exact location');
    });

    it('classifies accidental drop without audit context', () => {
      const posthog = makeSideEffect('POSTHOG_CALL', 'src/comp.tsx', 30, {
        object: 'posthog',
        method: 'capture',
      });

      const pair = buildPair({
        beforeObs: [posthog],
        unmatched: [posthog],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.accidentallyDropped).toBe(1);
      const signal = report.signals.find(s => s.classification === 'ACCIDENTALLY_DROPPED');
      expect(signal).toBeDefined();
      expect(signal!.confidence).toBe('high');
      expect(signal!.rationale).toContain('Not flagged by audit');
    });

    it('classifies intentional removal via refactor-type heuristic for service-hook', () => {
      const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 15, {
        object: 'toast',
        method: 'success',
      });

      const auditContext: AuditContext = {
        flaggedKinds: new Set<string>(),
        flaggedLocations: [],
        refactorType: 'service-hook',
      };

      const pair = buildPair({
        beforeObs: [toast],
        unmatched: [toast],
      });

      const report = interpretRefactorIntent(pair, auditContext);

      expect(report.summary.intentionallyRemoved).toBe(1);
      const signal = report.signals.find(s => s.classification === 'INTENTIONALLY_REMOVED');
      expect(signal).toBeDefined();
      expect(signal!.confidence).toBe('low');
      expect(signal!.rationale).toContain('service-hook');
    });

    it('computes score based on signal weights', () => {
      // Create a pair with one HOOK_CALL (weight 2.0) preserved and
      // one TOAST_CALL (weight 1.5) accidentally dropped
      const hook = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'Container' });
      const hookAfter = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'Container' });
      const toast = makeSideEffect('TOAST_CALL', 'src/comp.tsx', 20, {
        object: 'toast',
        method: 'success',
      });

      const pair = buildPair({
        beforeObs: [hook, toast],
        afterObs: [hookAfter],
        matched: [{ before: hook, after: hookAfter, similarity: 1.0 }],
        unmatched: [toast],
      });

      const report = interpretRefactorIntent(pair);

      // HOOK_CALL weight=2.0 preserved, TOAST_CALL weight=1.5 dropped
      // score = (2.0 / (2.0 + 1.5)) * 100 = 57 (rounded)
      expect(report.score).toBe(57);
      expect(report.summary.preserved).toBe(1);
      expect(report.summary.accidentallyDropped).toBe(1);
    });

    it('handles file split: signals from 1 file before matched across 2 files after', () => {
      const hook1 = makeHookCall('src/old.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hook2 = makeHookCall('src/old.tsx', 15, 'useQuery', { parentFunction: 'MyComp' });
      const hook1After = makeHookCall('src/newA.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hook2After = makeHookCall('src/newB.tsx', 15, 'useQuery', { parentFunction: 'MyComp' });

      const pair = buildPair({
        beforeFiles: ['src/old.tsx'],
        afterFiles: ['src/newA.tsx', 'src/newB.tsx'],
        beforeObs: [hook1, hook2],
        afterObs: [hook1After, hook2After],
        matched: [
          { before: hook1, after: hook1After, similarity: 0.85 },
          { before: hook2, after: hook2After, similarity: 0.85 },
        ],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.score).toBe(100);
      expect(report.summary.preserved).toBe(2);
      expect(report.summary.accidentallyDropped).toBe(0);
    });

    it('classifies CHANGED when matched signal has different evidence', () => {
      // Similarity between warn and fail thresholds -> CHANGED
      const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'Container' });
      const hookAfter = makeHookCall('src/comp.tsx', 12, 'useTeamsQuery', { parentFunction: 'Container' });

      // Similarity is 0.7 -- between fail (0.6) and warn (0.8)
      const pair = buildPair({
        beforeObs: [hookBefore],
        afterObs: [hookAfter],
        matched: [{ before: hookBefore, after: hookAfter, similarity: 0.7 }],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.changed).toBe(1);
      const signal = report.signals.find(s => s.classification === 'CHANGED');
      expect(signal).toBeDefined();
      expect(signal!.matchedTo).toEqual({
        file: 'src/comp.tsx',
        line: 12,
        kind: 'HOOK_CALL',
      });
    });

    it('classifies matched signal as ACCIDENTALLY_DROPPED when similarity is below fail threshold', () => {
      // Similarity below fail threshold (0.6) -> ACCIDENTALLY_DROPPED despite being matched
      const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery', { parentFunction: 'OldComp' });
      const hookAfter = makeHookCall('src/comp.tsx', 50, 'useQuery', { parentFunction: 'NewComp' });

      const pair = buildPair({
        beforeObs: [hookBefore],
        afterObs: [hookAfter],
        matched: [{ before: hookBefore, after: hookAfter, similarity: 0.45 }],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.accidentallyDropped).toBe(1);
      const signal = report.signals.find(s => s.classification === 'ACCIDENTALLY_DROPPED');
      expect(signal).toBeDefined();
      expect(signal!.rationale).toContain('below fail threshold');
    });

    it('classifies all unmatched as ACCIDENTALLY_DROPPED without audit context or refactor type', () => {
      const hook = makeHookCall('src/comp.tsx', 10, 'useState');
      const toast = makeSideEffect('TOAST_CALL', 'src/comp.tsx', 20, { object: 'toast' });
      const fetch = makeDataLayer('FETCH_API_CALL', 'src/comp.tsx', 30, { url: '/api/data' });

      const pair = buildPair({
        beforeObs: [hook, toast, fetch],
        unmatched: [hook, toast, fetch],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.summary.accidentallyDropped).toBe(3);
      expect(report.summary.intentionallyRemoved).toBe(0);
      for (const s of report.signals) {
        expect(s.classification).toBe('ACCIDENTALLY_DROPPED');
      }
    });

    it('assigns low confidence when similarity is near boundary threshold', () => {
      // Use similarity at exactly the warn threshold (0.8) -- boundary confidence should be 'low'
      const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery');
      const hookAfter = makeHookCall('src/comp.tsx', 10, 'useQuery');

      const pair = buildPair({
        matched: [{ before: hookBefore, after: hookAfter, similarity: 0.8 }],
      });

      const report = interpretRefactorIntent(pair);

      // At exactly threshold=0.8, computeBoundaryConfidence returns 'low'
      const signal = report.signals[0];
      expect(signal.classification).toBe('PRESERVED');
      // Verify computeBoundaryConfidence behavior directly
      const conf = computeBoundaryConfidence(0.8, [
        astConfig.intentMatcher.thresholds.warn,
        astConfig.intentMatcher.thresholds.fail,
      ]);
      expect(conf).toBe('low');
      expect(signal.confidence).toBe('low');
    });
  });

  describe('scoring', () => {
    it('returns 100 for empty signal pair', () => {
      const pair = buildPair({});
      const report = interpretRefactorIntent(pair);
      expect(report.score).toBe(100);
    });

    it('excludes ADDED signals from score computation', () => {
      const hook = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const hookAfter = makeHookCall('src/comp.tsx', 10, 'useState', { parentFunction: 'MyComp' });
      const novel = makeHookCall('src/comp.tsx', 20, 'useEffect', { parentFunction: 'MyComp' });

      const pair = buildPair({
        matched: [{ before: hook, after: hookAfter, similarity: 1.0 }],
        novel: [novel],
      });

      const report = interpretRefactorIntent(pair);

      // ADDED should not affect score
      expect(report.score).toBe(100);
      expect(report.summary.added).toBe(1);
      expect(report.summary.preserved).toBe(1);
    });
  });

  describe('report structure', () => {
    it('includes file metadata in report', () => {
      const pair = buildPair({
        beforeFiles: ['src/A.tsx', 'src/B.tsx'],
        afterFiles: ['src/C.tsx'],
        beforeObs: [],
        afterObs: [],
      });

      const report = interpretRefactorIntent(pair);

      expect(report.before.files).toEqual(['src/A.tsx', 'src/B.tsx']);
      expect(report.after.files).toEqual(['src/C.tsx']);
    });
  });
});

// ---------------------------------------------------------------------------
// prettyPrint tests
// ---------------------------------------------------------------------------

describe('prettyPrint', () => {
  it('renders header, score, and summary lines', () => {
    const pair = buildPair({
      matched: [
        {
          before: makeHookCall('src/a.tsx', 10, 'useState'),
          after: makeHookCall('src/a.tsx', 10, 'useState'),
          similarity: 1.0,
        },
      ],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('=== REFACTOR INTENT REPORT ===');
    expect(output).toContain('Score: 100/100');
    expect(output).toContain('Preserved:');
    expect(output).toContain('Intentionally removed:');
    expect(output).toContain('Accidentally dropped:');
    expect(output).toContain('Added:');
    expect(output).toContain('Changed:');
    expect(output).toContain('=== END ===');
  });

  it('renders ACCIDENTALLY DROPPED section with weight info', () => {
    const hook = makeHookCall('src/comp.tsx', 10, 'useState');
    const pair = buildPair({
      beforeObs: [hook],
      unmatched: [hook],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('ACCIDENTALLY DROPPED:');
    expect(output).toContain('!! REVIEW');
    expect(output).toContain('hookName=useState');
    expect(output).toContain('Weight:');
  });

  it('renders INTENTIONALLY REMOVED section', () => {
    const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
      object: 'toast',
      method: 'success',
    });
    const auditContext: AuditContext = {
      flaggedKinds: new Set(['TOAST_CALL']),
      flaggedLocations: [{ file: 'src/hook.ts', line: 25, kind: 'TOAST_CALL' }],
      refactorType: 'service-hook',
    };
    const pair = buildPair({
      beforeObs: [toast],
      unmatched: [toast],
    });
    const report = interpretRefactorIntent(pair, auditContext);
    const output = prettyPrint(report, false);

    expect(output).toContain('INTENTIONALLY REMOVED:');
    expect(output).toContain('ok ');
    expect(output).toContain('method=success');
  });

  it('renders CHANGED section with matchedTo info', () => {
    const hookBefore = makeHookCall('src/comp.tsx', 10, 'useQuery');
    const hookAfter = makeHookCall('src/comp.tsx', 12, 'useTeamsQuery');
    const pair = buildPair({
      matched: [{ before: hookBefore, after: hookAfter, similarity: 0.7 }],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('CHANGED:');
    expect(output).toContain('~  ');
    expect(output).toContain('-> src/comp.tsx:12');
  });

  it('renders verbose PRESERVED section with matchedTo info', () => {
    const hook = makeHookCall('src/a.tsx', 10, 'useState');
    const hookAfter = makeHookCall('src/b.tsx', 15, 'useState');
    const pair = buildPair({
      matched: [{ before: hook, after: hookAfter, similarity: 1.0 }],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, true);

    // The PRESERVED section should list signals, not "omitted for brevity"
    expect(output).toMatch(/PRESERVED:\n\s+ok /);
    expect(output).toContain('-> src/b.tsx:15');
  });

  it('renders non-verbose PRESERVED with count only', () => {
    const hook = makeHookCall('src/a.tsx', 10, 'useState');
    const hookAfter = makeHookCall('src/a.tsx', 10, 'useState');
    const pair = buildPair({
      matched: [{ before: hook, after: hookAfter, similarity: 1.0 }],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('PRESERVED: 1 signals (omitted for brevity');
  });

  it('renders verbose ADDED section', () => {
    const novel = makeHookCall('src/a.tsx', 20, 'useEffect');
    const pair = buildPair({ novel: [novel] });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, true);

    expect(output).toContain('ADDED:');
    expect(output).toContain('+  ');
    expect(output).toContain('hookName=useEffect');
  });

  it('renders non-verbose ADDED with count only', () => {
    const novel = makeHookCall('src/a.tsx', 20, 'useEffect');
    const pair = buildPair({ novel: [novel] });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('ADDED: 1 signals (omitted for brevity');
  });

  it('formats signal with multiple evidence identifiers', () => {
    const sideEffect = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
      object: 'toast',
      method: 'success',
    });
    const pair = buildPair({
      beforeObs: [sideEffect],
      unmatched: [sideEffect],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('method=success');
  });

  it('renders medium-signal weight description for weight=1.0 kinds', () => {
    // STATIC_IMPORT has weight 1.0 -> "medium-signal"
    const obs = {
      kind: 'STATIC_IMPORT' as const,
      file: 'src/a.tsx',
      line: 1,
      evidence: { source: './utils', name: 'foo' },
    } as AnyObservation;
    const pair = buildPair({
      beforeObs: [obs],
      unmatched: [obs],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('medium-signal');
  });

  it('renders low-signal weight description for weight<1.0 kinds', () => {
    // FUNCTION_COMPLEXITY has weight 0.5 -> "low-signal"
    const obs = {
      kind: 'FUNCTION_COMPLEXITY' as const,
      file: 'src/a.tsx',
      line: 5,
      evidence: {
        functionName: 'doStuff',
        endLine: 20,
        lineCount: 15,
        cyclomaticComplexity: 8,
        maxNestingDepth: 3,
        contributors: [],
      },
    } satisfies AnyObservation;
    const pair = buildPair({
      beforeObs: [obs],
      unmatched: [obs],
    });
    const report = interpretRefactorIntent(pair);
    const output = prettyPrint(report, false);

    expect(output).toContain('low-signal');
  });
});

// ---------------------------------------------------------------------------
// main() CLI tests
// ---------------------------------------------------------------------------

describe('main()', () => {
  const originalArgv = process.argv;
  let stdoutChunks: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  class ExitError extends Error {
    code: number;
    constructor(code: number) {
      super(`process.exit(${code})`);
      this.code = code;
    }
  }

  beforeEach(() => {
    stdoutChunks = [];
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('--help prints usage and exits 0', () => {
    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--help'];
    expect(() => main()).toThrow('process.exit(0)');

    const output = stdoutChunks.join('');
    expect(output).toContain('Usage:');
    expect(output).toContain('--signal-pair');
    expect(output).toContain('Classifications:');
  });

  it('fails when --signal-pair is missing', () => {
    process.argv = ['node', 'ast-interpret-refactor-intent.ts'];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(1);
    }

    const errOutput = (stderrSpy.mock.calls[0]?.[0] as string) ?? '';
    expect(errOutput).toContain('--signal-pair');
    stderrSpy.mockRestore();
  });

  it('reads signal pair JSON and outputs report', () => {
    const signalPair: RefactorSignalPair = buildPair({
      matched: [
        {
          before: makeHookCall('src/a.tsx', 10, 'useState'),
          after: makeHookCall('src/a.tsx', 10, 'useState'),
          similarity: 1.0,
        },
      ],
    });

    const tmpFile = '/tmp/test-signal-pair.json';
    fs.writeFileSync(tmpFile, JSON.stringify(signalPair));

    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--signal-pair', tmpFile];

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(0);
    }

    const output = stdoutChunks.join('');
    expect(output).toContain('"score":100');

    fs.unlinkSync(tmpFile);
  });

  it('outputs pretty format with --pretty', () => {
    const signalPair: RefactorSignalPair = buildPair({
      matched: [
        {
          before: makeHookCall('src/a.tsx', 10, 'useState'),
          after: makeHookCall('src/a.tsx', 10, 'useState'),
          similarity: 1.0,
        },
      ],
    });

    const tmpFile = '/tmp/test-signal-pair-pretty.json';
    fs.writeFileSync(tmpFile, JSON.stringify(signalPair));

    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--signal-pair', tmpFile, '--pretty'];

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(0);
    }

    const output = stdoutChunks.join('');
    expect(output).toContain('=== REFACTOR INTENT REPORT ===');
    expect(output).toContain('Score: 100/100');

    fs.unlinkSync(tmpFile);
  });

  it('exits 2 when score < 70', () => {
    const hook = makeHookCall('src/a.tsx', 10, 'useState');
    const signalPair: RefactorSignalPair = buildPair({
      beforeObs: [hook],
      unmatched: [hook],
    });

    const tmpFile = '/tmp/test-signal-pair-low.json';
    fs.writeFileSync(tmpFile, JSON.stringify(signalPair));

    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--signal-pair', tmpFile];

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(2);
    }

    fs.unlinkSync(tmpFile);
  });

  it('exits 1 when score >= 70 but has drops', () => {
    const hooks = Array.from({ length: 8 }, (_, i) => makeHookCall('src/a.tsx', 10 + i, `useHook${i}`));
    const hooksAfter = hooks.map(h => makeHookCall(h.file, h.line, h.evidence.hookName));
    const dropped = makeSideEffect('CONSOLE_CALL', 'src/a.tsx', 50);

    const matched = hooks.map((h, i) => ({
      before: h as AnyObservation,
      after: hooksAfter[i] as AnyObservation,
      similarity: 1.0,
    }));

    const signalPair: RefactorSignalPair = buildPair({
      beforeObs: [...hooks, dropped],
      afterObs: hooksAfter,
      matched,
      unmatched: [dropped],
    });

    const tmpFile = '/tmp/test-signal-pair-review.json';
    fs.writeFileSync(tmpFile, JSON.stringify(signalPair));

    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--signal-pair', tmpFile];

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(1);
    }

    fs.unlinkSync(tmpFile);
  });

  it('reads --audit-context and deserializes flaggedKinds into Set', () => {
    const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
      object: 'toast',
      method: 'success',
    });
    const signalPair: RefactorSignalPair = buildPair({
      beforeObs: [toast],
      unmatched: [toast],
    });
    const auditContext = {
      flaggedKinds: ['TOAST_CALL'],
      flaggedLocations: [{ file: 'src/hook.ts', line: 25, kind: 'TOAST_CALL' }],
      refactorType: 'service-hook',
    };

    const spFile = '/tmp/test-sp-ctx.json';
    const acFile = '/tmp/test-ac-ctx.json';
    fs.writeFileSync(spFile, JSON.stringify(signalPair));
    fs.writeFileSync(acFile, JSON.stringify(auditContext));

    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--signal-pair', spFile, '--audit-context', acFile];

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(0);
    }

    const output = stdoutChunks.join('');
    expect(output).toContain('INTENTIONALLY_REMOVED');

    fs.unlinkSync(spFile);
    fs.unlinkSync(acFile);
  });

  it('builds minimal audit context from --refactor-type alone', () => {
    const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
      object: 'toast',
      method: 'success',
    });
    const signalPair: RefactorSignalPair = buildPair({
      beforeObs: [toast],
      unmatched: [toast],
    });

    const tmpFile = '/tmp/test-sp-rtype.json';
    fs.writeFileSync(tmpFile, JSON.stringify(signalPair));

    process.argv = [
      'node',
      'ast-interpret-refactor-intent.ts',
      '--signal-pair',
      tmpFile,
      '--refactor-type',
      'service-hook',
    ];

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(0);
    }

    const output = stdoutChunks.join('');
    expect(output).toContain('INTENTIONALLY_REMOVED');

    fs.unlinkSync(tmpFile);
  });

  it('fails when --signal-pair points to invalid file', () => {
    process.argv = ['node', 'ast-interpret-refactor-intent.ts', '--signal-pair', '/tmp/nonexistent-file.json'];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      main();
    } catch (e) {
      expect((e as ExitError).code).toBe(1);
    }

    const errOutput = (stderrSpy.mock.calls[0]?.[0] as string) ?? '';
    expect(errOutput).toContain('Failed to read');
    stderrSpy.mockRestore();
  });

  it('classifies kind-only flagged as low confidence intentional removal', () => {
    const toast = makeSideEffect('TOAST_CALL', 'src/hook.ts', 25, {
      object: 'toast',
      method: 'success',
    });
    const auditContext: AuditContext = {
      flaggedKinds: new Set(['TOAST_CALL']),
      flaggedLocations: [{ file: 'src/other.ts', line: 99, kind: 'TOAST_CALL' }],
      refactorType: 'service-hook',
    };
    const pair = buildPair({
      beforeObs: [toast],
      unmatched: [toast],
    });
    const report = interpretRefactorIntent(pair, auditContext);

    const signal = report.signals[0];
    expect(signal.classification).toBe('INTENTIONALLY_REMOVED');
    expect(signal.confidence).toBe('low');
    expect(signal.rationale).toContain('exact location not matched');
  });
});
