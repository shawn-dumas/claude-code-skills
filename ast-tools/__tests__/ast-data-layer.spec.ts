import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeDataLayer, analyzeDataLayerDirectory, extractDataLayerObservations } from '../ast-data-layer';
import type { DataLayerAnalysis, DataLayerUsageType } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): DataLayerAnalysis {
  return analyzeDataLayer(fixturePath(name));
}

function usagesOfType(analysis: DataLayerAnalysis, type: DataLayerUsageType) {
  return analysis.usages.filter(u => u.type === type);
}

describe('ast-data-layer', () => {
  describe('QUERY_HOOK_DEF', () => {
    it('detects useQuery hook definitions', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const queryHooks = usagesOfType(result, 'QUERY_HOOK_DEF');

      expect(queryHooks).toHaveLength(2);
      expect(queryHooks[0].name).toBe('useUsersListQuery');
      expect(queryHooks[0].containingFunction).toBe('<module>');
      expect(queryHooks[0].line).toBeGreaterThan(0);
    });

    it('extracts queryKey from useQuery options', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const queryHooks = usagesOfType(result, 'QUERY_HOOK_DEF');
      const usersHook = queryHooks.find(h => h.name === 'useUsersListQuery');

      expect(usersHook).toBeDefined();
      expect(usersHook!.details.queryKey).toBeDefined();
      expect(usersHook!.details.queryKey).toContain('usersQueryKeys');
    });

    it('detects inline queryKey arrays', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const queryHooks = usagesOfType(result, 'QUERY_HOOK_DEF');
      const teamHook = queryHooks.find(h => h.name === 'useTeamDetailQuery');

      expect(teamHook).toBeDefined();
      expect(teamHook!.details.queryKey).toContain('teams');
    });
  });

  describe('MUTATION_HOOK_DEF', () => {
    it('detects useMutation hook definitions', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const mutationHooks = usagesOfType(result, 'MUTATION_HOOK_DEF');

      expect(mutationHooks).toHaveLength(1);
      expect(mutationHooks[0].name).toBe('useCreateTeamMutation');
      expect(mutationHooks[0].containingFunction).toBe('<module>');
    });
  });

  describe('QUERY_KEY_DEF', () => {
    it('detects query key factory objects', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const keyDefs = usagesOfType(result, 'QUERY_KEY_DEF');

      expect(keyDefs).toHaveLength(1);
      expect(keyDefs[0].name).toBe('usersQueryKeys');
      expect(keyDefs[0].details.keys).toContain('all');
      expect(keyDefs[0].details.keys).toContain('list');
      expect(keyDefs[0].details.keys).toContain('detail');
    });
  });

  describe('FETCH_API_CALL', () => {
    it('detects fetchApi calls with URL and schema', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const fetchCalls = usagesOfType(result, 'FETCH_API_CALL');

      expect(fetchCalls.length).toBeGreaterThanOrEqual(2);

      const usersFetch = fetchCalls.find(f => f.details.url?.includes('/api/users/user-data'));
      expect(usersFetch).toBeDefined();
      expect(usersFetch!.details.schema).toBe('UserArraySchema');
    });

    it('reports containing function for fetchApi calls', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const fetchCalls = usagesOfType(result, 'FETCH_API_CALL');
      const inUsersQuery = fetchCalls.find(f => f.containingFunction === 'useUsersListQuery');

      expect(inUsersQuery).toBeDefined();
    });
  });

  describe('API_ENDPOINT', () => {
    it('detects /api/ string patterns from fetchApi calls', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const endpoints = usagesOfType(result, 'API_ENDPOINT');

      expect(endpoints.length).toBeGreaterThanOrEqual(2);

      const userEndpoint = endpoints.find(e => e.name.includes('/api/users/user-data'));
      expect(userEndpoint).toBeDefined();

      const teamEndpoint = endpoints.find(e => e.name.includes('/api/teams/create'));
      expect(teamEndpoint).toBeDefined();
    });
  });

  describe('QUERY_INVALIDATION', () => {
    it('detects queryClient.invalidateQueries calls', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const invalidations = usagesOfType(result, 'QUERY_INVALIDATION');

      expect(invalidations).toHaveLength(1);
      expect(invalidations[0].details.queryKey).toContain('usersQueryKeys.all()');
      expect(invalidations[0].containingFunction).toBe('useCreateTeamMutation');
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual usage counts', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      const { summary, usages } = result;

      for (const type of Object.keys(summary) as DataLayerUsageType[]) {
        const count = usages.filter(u => u.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected usage types', () => {
      const result = analyzeFixture('data-layer-samples.ts');
      expect(result.summary.QUERY_HOOK_DEF).toBeGreaterThan(0);
      expect(result.summary.MUTATION_HOOK_DEF).toBeGreaterThan(0);
      expect(result.summary.QUERY_KEY_DEF).toBeGreaterThan(0);
      expect(result.summary.FETCH_API_CALL).toBeGreaterThan(0);
      expect(result.summary.API_ENDPOINT).toBeGreaterThan(0);
      expect(result.summary.QUERY_INVALIDATION).toBeGreaterThan(0);
    });
  });

  describe('real file smoke test', () => {
    it('analyzes a real query hook without crashing', () => {
      const realResult = analyzeDataLayer('src/ui/services/hooks/queries/users/useUsersListQuery/useUsersListQuery.ts');

      expect(realResult.filePath).toContain('useUsersListQuery');
      expect(realResult.usages).toBeDefined();
      expect(realResult.summary).toBeDefined();

      const expectedKeys: DataLayerUsageType[] = [
        'QUERY_HOOK_DEF',
        'MUTATION_HOOK_DEF',
        'QUERY_KEY_DEF',
        'FETCH_API_CALL',
        'API_ENDPOINT',
        'QUERY_INVALIDATION',
      ];
      for (const key of expectedKeys) {
        expect(realResult.summary).toHaveProperty(key);
        expect(typeof realResult.summary[key]).toBe('number');
      }
    });

    it('analyzes a real mutation hook without crashing', () => {
      const realResult = analyzeDataLayer(
        'src/ui/services/hooks/mutations/teams/useCreateTeamMutation/useCreateTeamMutation.ts',
      );

      expect(realResult.filePath).toContain('useCreateTeamMutation');
      expect(realResult.summary.MUTATION_HOOK_DEF).toBeGreaterThan(0);
    });

    it('analyzes a real query key file without crashing', () => {
      const realResult = analyzeDataLayer('src/ui/services/hooks/keys/users.ts');

      expect(realResult.filePath).toContain('users');
      expect(realResult.summary.QUERY_KEY_DEF).toBeGreaterThan(0);
    });
  });
});

describe('analyzeDataLayerDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeDataLayerDirectory(FIXTURES_DIR);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
    }
  });
});

describe('extractDataLayerObservations', () => {
  it('extracts observations from analysis results', () => {
    const analysis = analyzeFixture('data-layer-samples.ts');
    const result = extractDataLayerObservations(analysis);

    expect(result.filePath).toBe(analysis.filePath);
    expect(result.observations.length).toBe(analysis.usages.length);
  });

  it('maps usage types to observation kinds correctly', () => {
    const analysis = analyzeFixture('data-layer-samples.ts');
    const result = extractDataLayerObservations(analysis);

    const queryHookObs = result.observations.filter(o => o.kind === 'QUERY_HOOK_DEFINITION');
    const mutationHookObs = result.observations.filter(o => o.kind === 'MUTATION_HOOK_DEFINITION');
    const queryKeyObs = result.observations.filter(o => o.kind === 'QUERY_KEY_FACTORY');

    expect(queryHookObs.length).toBe(analysis.summary.QUERY_HOOK_DEF);
    expect(mutationHookObs.length).toBe(analysis.summary.MUTATION_HOOK_DEF);
    expect(queryKeyObs.length).toBe(analysis.summary.QUERY_KEY_DEF);
  });

  it('observation evidence contains name and containingFunction', () => {
    const analysis = analyzeFixture('data-layer-samples.ts');
    const result = extractDataLayerObservations(analysis);

    for (const obs of result.observations) {
      expect(obs.evidence.name).toBeDefined();
      expect(obs.evidence.containingFunction).toBeDefined();
    }
  });

  it('FETCH_API_CALL observations include url in evidence', () => {
    const analysis = analyzeFixture('data-layer-samples.ts');
    const result = extractDataLayerObservations(analysis);

    const fetchObs = result.observations.filter(o => o.kind === 'FETCH_API_CALL');
    expect(fetchObs.length).toBeGreaterThan(0);

    const obsWithUrl = fetchObs.find(o => o.evidence.url);
    expect(obsWithUrl).toBeDefined();
  });

  it('QUERY_KEY_FACTORY observations include keys in evidence', () => {
    const analysis = analyzeFixture('data-layer-samples.ts');
    const result = extractDataLayerObservations(analysis);

    const keyObs = result.observations.filter(o => o.kind === 'QUERY_KEY_FACTORY');
    expect(keyObs.length).toBeGreaterThan(0);

    const obsWithKeys = keyObs.find(o => o.evidence.keys && o.evidence.keys.length > 0);
    expect(obsWithKeys).toBeDefined();
  });
});

describe('negative fixture tests', () => {
  it('detects useCustomQuery as QUERY_HOOK_DEF (name pattern match)', () => {
    const analysis = analyzeFixture('data-layer-negative.ts');
    const queryHooks = usagesOfType(analysis, 'QUERY_HOOK_DEF');

    // useCustomQuery should be detected based on name pattern
    const customQuery = queryHooks.find(h => h.name === 'useCustomQuery');
    expect(customQuery).toBeDefined();
  });

  it('detects itemsQueryKeys as QUERY_KEY_DEF (proper factory pattern)', () => {
    const analysis = analyzeFixture('data-layer-negative.ts');
    const keyDefs = usagesOfType(analysis, 'QUERY_KEY_DEF');

    // itemsQueryKeys should be detected (proper object literal with as const)
    const itemsKeys = keyDefs.find(k => k.name === 'itemsQueryKeys');
    expect(itemsKeys).toBeDefined();
  });

  it('does not detect colorKeys as QUERY_KEY_DEF (array, not object)', () => {
    const analysis = analyzeFixture('data-layer-negative.ts');
    const keyDefs = usagesOfType(analysis, 'QUERY_KEY_DEF');

    // colorKeys is an array, not a query key factory object
    const colorKeys = keyDefs.find(k => k.name === 'colorKeys');
    expect(colorKeys).toBeUndefined();
  });

  it('does not detect bare fetch() as FETCH_API_CALL', () => {
    const analysis = analyzeFixture('data-layer-negative.ts');
    const fetchCalls = usagesOfType(analysis, 'FETCH_API_CALL');

    // The bare fetch() call should not be detected
    expect(fetchCalls.length).toBe(0);
  });
});

describe('template literal resolution in query key factories', () => {
  it('populates resolvedKeys for template literal keys', () => {
    const analysis = analyzeFixture('data-layer-template-key.ts');
    const keyDefs = usagesOfType(analysis, 'QUERY_KEY_DEF');

    const analyticsKeys = keyDefs.find(k => k.name === 'analyticsQueryKeys');
    expect(analyticsKeys).toBeDefined();
    expect(analyticsKeys!.details.resolvedKeys).toBeDefined();
    expect(analyticsKeys!.details.resolvedKeys!['byTeam']).toBe('analytics-team-${teamId}');
  });

  it('does not populate resolvedKeys for array-only factories', () => {
    const analysis = analyzeFixture('data-layer-template-key.ts');
    const keyDefs = usagesOfType(analysis, 'QUERY_KEY_DEF');

    const projectsKeys = keyDefs.find(k => k.name === 'projectsQueryKeys');
    expect(projectsKeys).toBeDefined();
    expect(projectsKeys!.details.resolvedKeys).toBeUndefined();
  });

  it('passes resolvedKeys through to observations', () => {
    const analysis = analyzeFixture('data-layer-template-key.ts');
    const result = extractDataLayerObservations(analysis);

    const keyObs = result.observations.filter(o => o.kind === 'QUERY_KEY_FACTORY');
    expect(keyObs.length).toBe(2);

    const analyticsObs = keyObs.find(o => o.evidence.name === 'analyticsQueryKeys');
    expect(analyticsObs).toBeDefined();
    expect(analyticsObs!.evidence.resolvedKeys).toBeDefined();
    expect(analyticsObs!.evidence.resolvedKeys!['byTeam']).toBe('analytics-team-${teamId}');

    const projectsObs = keyObs.find(o => o.evidence.name === 'projectsQueryKeys');
    expect(projectsObs).toBeDefined();
    expect(projectsObs!.evidence.resolvedKeys).toBeUndefined();
  });
});
