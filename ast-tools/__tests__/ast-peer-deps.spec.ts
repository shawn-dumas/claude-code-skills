import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { analyzePeerDeps, extractPeerDepObservations, satisfies, main } from '../ast-peer-deps';

const fixtureDir = (name: string) => path.join(__dirname, 'fixtures', name);

// ---------------------------------------------------------------------------
// semver satisfies() unit tests
// ---------------------------------------------------------------------------

describe('satisfies (semver range evaluation)', () => {
  it('handles caret ranges', () => {
    expect(satisfies('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfies('1.9.9', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('0.9.9', '^1.0.0')).toBe(false);
  });

  it('handles caret ranges for 0.x', () => {
    expect(satisfies('0.2.0', '^0.2.0')).toBe(true);
    expect(satisfies('0.2.5', '^0.2.0')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false);
  });

  it('handles caret ranges for 0.0.x', () => {
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
  });

  it('handles tilde ranges', () => {
    expect(satisfies('1.2.3', '~1.2.0')).toBe(true);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
  });

  it('handles OR ranges (||)', () => {
    expect(satisfies('18.2.0', '^18 || ^19')).toBe(true);
    expect(satisfies('19.2.4', '^18 || ^19')).toBe(true);
    expect(satisfies('17.0.0', '^18 || ^19')).toBe(false);
    expect(satisfies('20.0.0', '^18 || ^19')).toBe(false);
  });

  it('handles comparison operators', () => {
    expect(satisfies('2.0.0', '>=1.0.0')).toBe(true);
    expect(satisfies('1.0.0', '>=1.0.0')).toBe(true);
    expect(satisfies('0.9.9', '>=1.0.0')).toBe(false);
    expect(satisfies('1.0.0', '<2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '<2.0.0')).toBe(false);
    expect(satisfies('2.0.0', '<=2.0.0')).toBe(true);
    expect(satisfies('3.0.0', '>2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>2.0.0')).toBe(false);
  });

  it('handles AND ranges (space-separated)', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfies('0.9.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('handles hyphen ranges', () => {
    expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(satisfies('1.0.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false);
    expect(satisfies('0.9.9', '1.0.0 - 2.0.0')).toBe(false);
  });

  it('handles x-ranges', () => {
    expect(satisfies('1.0.0', '1.x')).toBe(true);
    expect(satisfies('1.9.9', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('5.0.0', '*')).toBe(true);
  });

  it('handles wildcard star', () => {
    expect(satisfies('99.0.0', '*')).toBe(true);
  });

  it('handles complex real-world ranges', () => {
    // react-flatpickr style
    expect(satisfies('19.2.4', '>=16 <=19')).toBe(true);
    expect(satisfies('16.0.0', '>=16 <=19')).toBe(true);
    expect(satisfies('15.9.9', '>=16 <=19')).toBe(false);
    // Note: <=19 means <=19.0.0 which fails for 19.2.4
    // This is actually correct semver behavior -- <=19 parses as <=19.0.0
  });

  it('returns false for unparseable versions', () => {
    expect(satisfies('not-a-version', '^1.0.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzePeerDeps on fixtures
// ---------------------------------------------------------------------------

describe('analyzePeerDeps', () => {
  it('detects satisfied peer dependencies', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    const satisfied = result.observations.filter(o => o.kind === 'PEER_DEP_SATISFIED');

    // dep-a requires peer-lib ^1.0.0 || ^2.0.0, installed 2.3.1 -> satisfied
    const depA = satisfied.find(o => o.evidence.package === 'dep-a');
    expect(depA).toBeDefined();
    expect(depA!.evidence.peer).toBe('peer-lib');
    expect(depA!.evidence.installedPeerVersion).toBe('2.3.1');
    expect(depA!.evidence.constraint).toBe('^1.0.0 || ^2.0.0');
  });

  it('detects violated peer dependencies (version mismatch)', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    const violated = result.observations.filter(o => o.kind === 'PEER_DEP_VIOLATED');

    // dep-violated requires peer-lib ^3.0.0, installed 2.3.1 -> violated
    const depViolated = violated.find(
      o => o.evidence.package === 'dep-violated' && o.evidence.reason === 'version-mismatch',
    );
    expect(depViolated).toBeDefined();
    expect(depViolated!.evidence.peer).toBe('peer-lib');
    expect(depViolated!.evidence.installedPeerVersion).toBe('2.3.1');
  });

  it('detects violated peer dependencies (not installed)', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    const violated = result.observations.filter(o => o.kind === 'PEER_DEP_VIOLATED');

    // dep-not-installed requires missing-peer >=1.0.0, not installed -> violated
    const depNotInstalled = violated.find(o => o.evidence.reason === 'not-installed');
    expect(depNotInstalled).toBeDefined();
    expect(depNotInstalled!.evidence.package).toBe('dep-not-installed');
    expect(depNotInstalled!.evidence.peer).toBe('missing-peer');
  });

  it('detects optional missing peer dependencies', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    const optionalMissing = result.observations.filter(o => o.kind === 'PEER_DEP_OPTIONAL_MISSING');

    // dep-optional requires optional-peer ^1.0.0 (optional: true), not installed
    const depOptional = optionalMissing.find(o => o.evidence.package === 'dep-optional');
    expect(depOptional).toBeDefined();
    expect(depOptional!.evidence.peer).toBe('optional-peer');
    expect(depOptional!.evidence.constraint).toBe('^1.0.0');
  });

  it('handles scoped packages', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    const satisfied = result.observations.filter(o => o.kind === 'PEER_DEP_SATISFIED');

    // @scope/dep-scoped requires @scope/peer-scoped ^3.0.0, installed 3.1.0
    const scoped = satisfied.find(o => o.evidence.package === '@scope/dep-scoped');
    expect(scoped).toBeDefined();
    expect(scoped!.evidence.peer).toBe('@scope/peer-scoped');
    expect(scoped!.evidence.installedPeerVersion).toBe('3.1.0');
    expect(scoped!.file).toBe('node_modules/@scope/dep-scoped/package.json');
  });

  it('reports correct summary counts', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    expect(result.summary.satisfied).toBe(2); // dep-a + @scope/dep-scoped
    expect(result.summary.violated).toBe(2); // dep-violated + dep-not-installed
    expect(result.summary.optionalMissing).toBe(1); // dep-optional
    expect(result.summary.totalPeers).toBe(5);
  });

  it('sets file field to node_modules path', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    for (const obs of result.observations) {
      expect(obs.file).toMatch(/^node_modules\//);
      expect(obs.file).toMatch(/\/package\.json$/);
    }
  });

  it('sets line to 0 for all observations', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    for (const obs of result.observations) {
      expect(obs.line).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Negative fixture
// ---------------------------------------------------------------------------

describe('analyzePeerDeps (negative fixture)', () => {
  it('produces no observations when no peer deps exist', () => {
    const result = analyzePeerDeps(fixtureDir('peer-deps-negative'));
    expect(result.observations).toHaveLength(0);
    expect(result.summary.totalPeers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractPeerDepObservations
// ---------------------------------------------------------------------------

describe('extractPeerDepObservations', () => {
  it('returns ObservationResult format', () => {
    const analysis = analyzePeerDeps(fixtureDir('peer-deps-positive'));
    const obsResult = extractPeerDepObservations(analysis);
    expect(obsResult.filePath).toBeDefined();
    expect(obsResult.observations).toBe(analysis.observations);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('analyzePeerDeps (edge cases)', () => {
  it('returns empty for nonexistent project root', () => {
    const result = analyzePeerDeps('/nonexistent/path/that/should/not/exist');
    expect(result.observations).toHaveLength(0);
    expect(result.summary.totalPeers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// main() CLI tests
// ---------------------------------------------------------------------------

describe('main()', () => {
  const originalArgv = process.argv;
  let stdoutChunks: string[];

  class ExitError extends Error {
    code: number;
    constructor(code: number) {
      super(`process.exit(${code})`);
      this.code = code;
    }
  }

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new ExitError(code ?? 0);
    }) as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('--help prints usage and exits 0', () => {
    process.argv = ['node', 'ast-peer-deps.ts', '--help'];
    expect(() => main()).toThrow('process.exit(0)');

    const out = stdoutChunks.join('');
    expect(out).toContain('Usage:');
    expect(out).toContain('--pretty');
    expect(out).toContain('peerDependency');
  });

  it('errors when path does not exist', () => {
    process.argv = ['node', 'ast-peer-deps.ts', '/nonexistent/definitely/not/here'];
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => main()).toThrow('process.exit(1)');
  });

  it('runs analysis on actual project root and outputs JSON', () => {
    process.argv = ['node', 'ast-peer-deps.ts'];
    main();

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('observations');
    expect(parsed).toHaveProperty('summary');
    expect(parsed.summary).toHaveProperty('totalPeers');
  });

  it('runs analysis with --pretty and produces formatted table', () => {
    process.argv = ['node', 'ast-peer-deps.ts', '--pretty'];
    main();

    const out = stdoutChunks.join('');
    expect(out).toContain('PEER DEPENDENCY ANALYSIS');
    expect(out).toContain('Summary:');
  });

  it('runs analysis with --count', () => {
    process.argv = ['node', 'ast-peer-deps.ts', '--count'];
    main();

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    // At least one observation kind should be present
    expect(typeof parsed).toBe('object');
  });

  it('runs analysis with --kind filter', () => {
    process.argv = ['node', 'ast-peer-deps.ts', '--kind', 'PEER_DEP_SATISFIED'];
    main();

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    // All observations should be PEER_DEP_SATISFIED
    for (const obs of parsed.observations) {
      expect(obs.kind).toBe('PEER_DEP_SATISFIED');
    }
  });
});
