import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'bff-gaps');
const FIXTURE_API_DIR = path.join(FIXTURE_ROOT, 'src', 'pages', 'api');
const FIXTURE_HOOKS_DIR = path.join(FIXTURE_ROOT, 'src', 'ui', 'services', 'hooks');

// ---------------------------------------------------------------------------
// Mock PROJECT_ROOT so path helpers resolve relative to the fixture root.
// Must be hoisted before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('../project', async () => {
  const pathMod = await import('path');
  const url = await import('url');
  const dir = pathMod.dirname(url.fileURLToPath(import.meta.url));
  const fixtureRoot = pathMod.join(dir, 'fixtures', 'bff-gaps');

  // Re-import the real getSourceFile using the actual project.ts module but
  // with the patched root. We need a real ts-morph project for parseable files.
  const { Project } = await import('ts-morph');
  const tsProject = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });

  return {
    PROJECT_ROOT: fixtureRoot,
    getSourceFile: (filePath: string) => {
      const absolute = pathMod.isAbsolute(filePath) ? filePath : pathMod.resolve(fixtureRoot, filePath);
      const existing = tsProject.getSourceFile(absolute);
      if (existing) return existing;
      return tsProject.addSourceFileAtPath(absolute);
    },
  };
});

// ---------------------------------------------------------------------------
// Mock ast-data-layer so findQueryHookGaps can be controlled in tests
// ---------------------------------------------------------------------------

const mockAnalyzeDataLayerDirectory = vi.fn(() => [] as Record<string, unknown>[]);

vi.mock('../ast-data-layer', () => ({
  analyzeDataLayerDirectory: (...args: Parameters<typeof mockAnalyzeDataLayerDirectory>) =>
    mockAnalyzeDataLayerDirectory(...args),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are hoisted
// ---------------------------------------------------------------------------

import {
  analyzeBffGaps,
  extractBffGapObservations,
  filePathToApiPath,
  mockPathToBffPath,
  extractMiddleware,
  extractHttpMethods,
  findContainingHookName,
  main,
} from '../ast-bff-gaps';

// ---------------------------------------------------------------------------
// filePathToApiPath
// ---------------------------------------------------------------------------

describe('filePathToApiPath', () => {
  it('converts a relative src/pages/api path to an API path', () => {
    // With PROJECT_ROOT = FIXTURE_ROOT, passing a relative path from fixture root
    const result = filePathToApiPath('src/pages/api/users/data-api/teams.ts');
    expect(result).toBe('/api/users/data-api/teams');
  });

  it('strips tsx extension', () => {
    const result = filePathToApiPath('src/pages/api/users/data-api/summary.tsx');
    expect(result).toBe('/api/users/data-api/summary');
  });

  it('handles index files -- strips /index suffix', () => {
    const result = filePathToApiPath('src/pages/api/widgets/index.ts');
    expect(result).toBe('/api/widgets');
  });

  it('handles mock routes', () => {
    const result = filePathToApiPath('src/pages/api/mock/users/data-api/teams.ts');
    expect(result).toBe('/api/mock/users/data-api/teams');
  });
});

// ---------------------------------------------------------------------------
// mockPathToBffPath
// ---------------------------------------------------------------------------

describe('mockPathToBffPath', () => {
  it('strips /mock/ segment from a mock API path', () => {
    expect(mockPathToBffPath('/api/mock/users/data-api/teams')).toBe('/api/users/data-api/teams');
  });

  it('strips /mock/ from nested paths', () => {
    expect(mockPathToBffPath('/api/mock/systems/confluence/events')).toBe('/api/systems/confluence/events');
  });
});

// ---------------------------------------------------------------------------
// extractMiddleware
// ---------------------------------------------------------------------------

describe('extractMiddleware', () => {
  it('extracts withXxx names from default export chain', () => {
    const text = `export default withErrorHandler(withMethod(['GET'], withAuth(handler)));`;
    expect(extractMiddleware(text)).toEqual(['withErrorHandler', 'withMethod', 'withAuth']);
  });

  it('returns empty array when no default export', () => {
    expect(extractMiddleware('const x = 1;')).toEqual([]);
  });

  it('returns empty array when default export has no with-middleware', () => {
    expect(extractMiddleware('export default handler;')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractHttpMethods
// ---------------------------------------------------------------------------

describe('extractHttpMethods', () => {
  it('extracts single method', () => {
    const text = `export default withMethod(['GET'], handler);`;
    expect(extractHttpMethods(text)).toEqual(['GET']);
  });

  it('extracts multiple methods', () => {
    const text = `export default withMethod(['GET', 'POST'], handler);`;
    expect(extractHttpMethods(text)).toEqual(['GET', 'POST']);
  });

  it('returns empty array when no withMethod call', () => {
    expect(extractHttpMethods('export default handler;')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findContainingHookName
// ---------------------------------------------------------------------------

describe('findContainingHookName', () => {
  it('returns basename when it starts with "use"', () => {
    expect(findContainingHookName('/path/to/useTeamsQuery.ts')).toBe('useTeamsQuery');
  });

  it('falls back to parent directory name when it starts with "use"', () => {
    expect(findContainingHookName('/path/to/useTeamsQuery/index.ts')).toBe('useTeamsQuery');
  });

  it('returns basename when neither basename nor parent starts with "use"', () => {
    expect(findContainingHookName('/path/to/helpers/utils.ts')).toBe('utils');
  });
});

// ---------------------------------------------------------------------------
// analyzeBffGaps -- integration using fixture files
// ---------------------------------------------------------------------------

describe('analyzeBffGaps', () => {
  beforeEach(() => {
    mockAnalyzeDataLayerDirectory.mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('detects BFF_STUB_ROUTE for a route returning status(501)', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    expect(stubs.length).toBeGreaterThanOrEqual(1);
    const teamsStub = stubs.find(o => o.evidence.apiPath?.includes('teams'));
    expect(teamsStub).toBeDefined();
  });

  it('BFF_STUB_ROUTE evidence includes apiPath, bffFile, and middleware', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    const teams = stubs.find(o => o.evidence.apiPath?.includes('teams'));
    expect(teams?.evidence.apiPath).toContain('teams');
    expect(teams?.evidence.bffFile).toBeDefined();
    expect(teams?.evidence.middleware).toEqual(expect.arrayContaining(['withErrorHandler', 'withMethod', 'withAuth']));
  });

  it('BFF_STUB_ROUTE includes todoComments from the stub file', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    const teams = stubs.find(o => o.evidence.apiPath?.includes('teams'));
    // teams.ts has a TODO comment
    expect(teams?.evidence.todoComments).toBeDefined();
    expect(teams?.evidence.todoComments?.length).toBeGreaterThanOrEqual(1);
  });

  it('BFF_STUB_ROUTE includes httpMethods when withMethod is present', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    const teams = stubs.find(o => o.evidence.apiPath?.includes('teams'));
    expect(teams?.evidence.httpMethods).toEqual(['GET']);
  });

  it('detects MOCK_ROUTE for each mock file', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const mocks = result.observations.filter(o => o.kind === 'MOCK_ROUTE');
    expect(mocks.length).toBeGreaterThanOrEqual(2); // teams + projects mock routes
  });

  it('MOCK_ROUTE evidence includes apiPath and mockFile', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const mocks = result.observations.filter(o => o.kind === 'MOCK_ROUTE');
    const teams = mocks.find(o => o.evidence.apiPath?.includes('teams'));
    expect(teams?.evidence.mockFile).toBeDefined();
    expect(teams?.evidence.apiPath).toContain('mock');
  });

  it('MOCK_ROUTE with a corresponding BFF file includes bffFile in evidence', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const mocks = result.observations.filter(o => o.kind === 'MOCK_ROUTE');
    // teams mock has a corresponding BFF route
    const teams = mocks.find(o => o.evidence.apiPath?.includes('/mock/users/data-api/teams'));
    expect(teams?.evidence.bffFile).toBeDefined();
  });

  it('detects BFF_MISSING_ROUTE for mock routes without a BFF counterpart', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const missing = result.observations.filter(o => o.kind === 'BFF_MISSING_ROUTE');
    // projects mock exists but there is no BFF /api/users/data-api/projects route
    expect(missing.length).toBeGreaterThanOrEqual(1);
    const projects = missing.find(o => o.evidence.apiPath?.includes('projects'));
    expect(projects).toBeDefined();
  });

  it('includes fixture builders in MOCK_ROUTE evidence when detected', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const mocks = result.observations.filter(o => o.kind === 'MOCK_ROUTE');
    // teams mock calls buildTeamList
    const teams = mocks.find(o => o.evidence.apiPath?.includes('/mock/users/data-api/teams'));
    expect(teams?.evidence.fixtureBuilders).toEqual(expect.arrayContaining(['buildTeamList']));
  });

  it('bffRoutes summary lists all non-mock routes with isStub flag', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    expect(result.bffRoutes.length).toBeGreaterThanOrEqual(2);
    const teamsRoute = result.bffRoutes.find(r => r.path.includes('teams'));
    expect(teamsRoute?.isStub).toBe(true);
    const summaryRoute = result.bffRoutes.find(r => r.path.includes('summary'));
    expect(summaryRoute?.isStub).toBe(false);
  });

  it('mockRoutes summary lists all mock routes with apiPath', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    expect(result.mockRoutes.length).toBeGreaterThanOrEqual(2);
    const teamsMock = result.mockRoutes.find(r => r.path.includes('teams'));
    expect(teamsMock?.apiPath).toContain('mock');
  });

  it('handles a directory with no mock subdirectory gracefully', () => {
    // Pass just the widgets subdirectory which has no mock/ peer
    const widgetsDir = path.join(FIXTURE_API_DIR, 'widgets');
    const result = analyzeBffGaps(widgetsDir);
    expect(result.observations.filter(o => o.kind === 'MOCK_ROUTE')).toHaveLength(0);
    expect(result.bffRoutes.length).toBeGreaterThanOrEqual(1);
  });

  it('BFF_STUB_ROUTE includes correspondingMock mockFile when a mock file exists', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    const teams = stubs.find(o => o.evidence.apiPath?.includes('teams'));
    // teams stub has a matching mock route
    expect(teams?.evidence.mockFile).toBeDefined();
  });

  it('non-stub BFF routes do not produce BFF_STUB_ROUTE observations', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR);
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    const summaryStub = stubs.find(o => o.evidence.apiPath?.includes('summary'));
    // summary.ts returns 200, not 501, so it should NOT be a stub
    expect(summaryStub).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // hookDirs / QUERY_HOOK_BFF_GAP path
  // ---------------------------------------------------------------------------

  it('emits QUERY_HOOK_BFF_GAP when a hook references a gap endpoint', () => {
    mockAnalyzeDataLayerDirectory.mockReturnValue([
      {
        filePath: path.join(FIXTURE_HOOKS_DIR, 'useTeamsQuery.ts'),
        usages: [
          {
            type: 'FETCH_API_CALL',
            line: 5,
            column: 14,
            name: 'fetchApi',
            text: 'fetchApi(`/api/users/data-api/teams`)',
            containingFunction: 'useTeamsQuery',
            details: {
              url: '/api/users/data-api/teams',
              schema: 'TeamsSchema',
            },
          },
        ],
        summary: {
          QUERY_HOOK_DEF: 0,
          MUTATION_HOOK_DEF: 0,
          QUERY_KEY_DEF: 0,
          FETCH_API_CALL: 1,
          API_ENDPOINT: 0,
          QUERY_INVALIDATION: 0,
        },
      },
    ]);

    const result = analyzeBffGaps(FIXTURE_API_DIR, { hookDirs: [FIXTURE_HOOKS_DIR] });
    const hookGaps = result.observations.filter(o => o.kind === 'QUERY_HOOK_BFF_GAP');
    expect(hookGaps.length).toBeGreaterThanOrEqual(1);
    const gap = hookGaps.find(o => o.evidence.queryHookName === 'useTeamsQuery');
    expect(gap).toBeDefined();
    expect(gap?.evidence.fetchApiUrl).toBe('/api/users/data-api/teams');
    expect(gap?.evidence.responseSchema).toBe('TeamsSchema');
  });

  it('enriches BFF_STUB_ROUTE with queryHookName when hook cross-reference matches', () => {
    mockAnalyzeDataLayerDirectory.mockReturnValue([
      {
        filePath: path.join(FIXTURE_HOOKS_DIR, 'useTeamsQuery.ts'),
        usages: [
          {
            type: 'FETCH_API_CALL',
            line: 5,
            column: 14,
            name: 'fetchApi',
            text: 'fetchApi(`/api/users/data-api/teams`)',
            containingFunction: 'useTeamsQuery',
            details: {
              url: '/api/users/data-api/teams',
              schema: 'TeamsSchema',
            },
          },
        ],
        summary: {
          QUERY_HOOK_DEF: 0,
          MUTATION_HOOK_DEF: 0,
          QUERY_KEY_DEF: 0,
          FETCH_API_CALL: 1,
          API_ENDPOINT: 0,
          QUERY_INVALIDATION: 0,
        },
      },
    ]);

    const result = analyzeBffGaps(FIXTURE_API_DIR, { hookDirs: [FIXTURE_HOOKS_DIR] });
    const stubs = result.observations.filter(o => o.kind === 'BFF_STUB_ROUTE');
    const teams = stubs.find(o => o.evidence.apiPath?.includes('teams'));
    expect(teams?.evidence.queryHookName).toBe('useTeamsQuery');
    expect(teams?.evidence.responseSchema).toBe('TeamsSchema');
  });

  it('skips non-existent hookDir paths silently', () => {
    const result = analyzeBffGaps(FIXTURE_API_DIR, {
      hookDirs: ['/tmp/nonexistent-hooks-dir-99999'],
    });
    const hookGaps = result.observations.filter(o => o.kind === 'QUERY_HOOK_BFF_GAP');
    expect(hookGaps).toHaveLength(0);
  });

  it('skips usages without a url', () => {
    mockAnalyzeDataLayerDirectory.mockReturnValue([
      {
        filePath: path.join(FIXTURE_HOOKS_DIR, 'useTeamsQuery.ts'),
        usages: [
          {
            type: 'FETCH_API_CALL',
            line: 5,
            column: 14,
            name: 'fetchApi',
            text: 'fetchApi(buildUrl())',
            containingFunction: 'useTeamsQuery',
            details: {
              // no url
              schema: 'TeamsSchema',
            },
          },
        ],
        summary: {
          QUERY_HOOK_DEF: 0,
          MUTATION_HOOK_DEF: 0,
          QUERY_KEY_DEF: 0,
          FETCH_API_CALL: 1,
          API_ENDPOINT: 0,
          QUERY_INVALIDATION: 0,
        },
      },
    ]);
    const result = analyzeBffGaps(FIXTURE_API_DIR, { hookDirs: [FIXTURE_HOOKS_DIR] });
    const hookGaps = result.observations.filter(o => o.kind === 'QUERY_HOOK_BFF_GAP');
    expect(hookGaps).toHaveLength(0);
  });

  it('handles template-literal fetchApi URLs with ${varName} converting to [varName]', () => {
    mockAnalyzeDataLayerDirectory.mockReturnValue([
      {
        filePath: path.join(FIXTURE_HOOKS_DIR, 'useTeamsQuery.ts'),
        usages: [
          {
            type: 'FETCH_API_CALL',
            line: 5,
            column: 14,
            name: 'fetchApi',
            text: 'fetchApi(`/api/users/data-api/teams/${teamId}`)',
            containingFunction: 'useTeamsQuery',
            details: {
              url: '`/api/users/data-api/teams/${teamId}`',
              schema: null,
            },
          },
        ],
        summary: {
          QUERY_HOOK_DEF: 0,
          MUTATION_HOOK_DEF: 0,
          QUERY_KEY_DEF: 0,
          FETCH_API_CALL: 1,
          API_ENDPOINT: 0,
          QUERY_INVALIDATION: 0,
        },
      },
    ]);
    // Just verify it doesn't throw -- the template URL is normalized but won't match any gap
    expect(() => analyzeBffGaps(FIXTURE_API_DIR, { hookDirs: [FIXTURE_HOOKS_DIR] })).not.toThrow();
  });

  it('skips non-FETCH_API_CALL usages', () => {
    mockAnalyzeDataLayerDirectory.mockReturnValue([
      {
        filePath: path.join(FIXTURE_HOOKS_DIR, 'useTeamsQuery.ts'),
        usages: [
          {
            type: 'QUERY_HOOK_DEF',
            line: 4,
            column: 0,
            name: 'useTeamsQuery',
            text: 'useQuery(...)',
            containingFunction: 'useTeamsQuery',
            details: { queryKey: "['teams']" },
          },
        ],
        summary: {
          QUERY_HOOK_DEF: 1,
          MUTATION_HOOK_DEF: 0,
          QUERY_KEY_DEF: 0,
          FETCH_API_CALL: 0,
          API_ENDPOINT: 0,
          QUERY_INVALIDATION: 0,
        },
      },
    ]);
    const result = analyzeBffGaps(FIXTURE_API_DIR, { hookDirs: [FIXTURE_HOOKS_DIR] });
    const hookGaps = result.observations.filter(o => o.kind === 'QUERY_HOOK_BFF_GAP');
    expect(hookGaps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractBffGapObservations
// ---------------------------------------------------------------------------

describe('extractBffGapObservations', () => {
  it('returns an ObservationResult wrapping the analysis observations', () => {
    const fakeAnalysis = {
      bffRoutes: [],
      mockRoutes: [],
      observations: [
        {
          kind: 'BFF_STUB_ROUTE' as const,
          file: 'src/pages/api/teams.ts',
          line: 1,
          evidence: { apiPath: '/api/teams', bffFile: 'src/pages/api/teams.ts' },
        },
      ],
    };
    const result = extractBffGapObservations(fakeAnalysis);
    expect(result.filePath).toBe('src/pages/api/');
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.kind).toBe('BFF_STUB_ROUTE');
  });
});

// ---------------------------------------------------------------------------
// main() CLI
// ---------------------------------------------------------------------------

describe('ast-bff-gaps main()', () => {
  let stdoutChunks: string[];
  let originalArgv: string[];

  beforeEach(() => {
    stdoutChunks = [];
    originalArgv = process.argv;
    mockAnalyzeDataLayerDirectory.mockReturnValue([]);
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
    process.argv = ['node', 'ast-bff-gaps.ts', '--help'];
    expect(() => main()).toThrow('process.exit(0)');
    expect(stdoutChunks.join('')).toContain('Usage:');
  });

  it('no args exits 1', () => {
    process.argv = ['node', 'ast-bff-gaps.ts'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('non-existent path exits 1', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', '/tmp/nonexistent-bff-dir-12345'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('file path (not directory) exits 1', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', __filename];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('runs analysis on a real directory and outputs JSON', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', FIXTURE_API_DIR];
    main();
    const out = stdoutChunks.join('');
    // Should output valid JSON containing analysis keys
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed).toHaveProperty('observations');
    expect(parsed).toHaveProperty('bffRoutes');
    expect(parsed).toHaveProperty('mockRoutes');
  });

  it('--pretty outputs indented JSON', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', FIXTURE_API_DIR, '--pretty'];
    main();
    const out = stdoutChunks.join('');
    // Indented JSON contains newlines
    expect(out).toContain('\n');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed).toHaveProperty('observations');
  });

  it('--count outputs kind counts instead of full data', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', FIXTURE_API_DIR, '--count'];
    main();
    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out) as Record<string, number>;
    // Should have keys like BFF_STUB_ROUTE, MOCK_ROUTE, etc.
    expect(typeof parsed).toBe('object');
  });

  it('--kind filters to a specific observation kind', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', FIXTURE_API_DIR, '--kind', 'BFF_STUB_ROUTE', '--pretty'];
    main();
    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    const obs = parsed.observations as { kind: string }[];
    expect(obs.every(o => o.kind === 'BFF_STUB_ROUTE')).toBe(true);
  });

  it('--hook-dir passes hookDirs to analyzeBffGaps', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', FIXTURE_API_DIR, '--hook-dir', FIXTURE_HOOKS_DIR];
    // Should not throw and should output valid JSON
    main();
    const out = stdoutChunks.join('');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('--no-cache flag is accepted and passes through', () => {
    process.argv = ['node', 'ast-bff-gaps.ts', FIXTURE_API_DIR, '--no-cache'];
    main();
    const out = stdoutChunks.join('');
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
