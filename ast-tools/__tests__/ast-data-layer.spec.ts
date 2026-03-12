import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeDataLayer } from '../ast-data-layer';
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
  const result = analyzeFixture('data-layer-samples.ts');

  describe('QUERY_HOOK_DEF', () => {
    it('detects useQuery hook definitions', () => {
      const queryHooks = usagesOfType(result, 'QUERY_HOOK_DEF');

      expect(queryHooks).toHaveLength(2);
      expect(queryHooks[0].name).toBe('useUsersListQuery');
      expect(queryHooks[0].containingFunction).toBe('<module>');
      expect(queryHooks[0].line).toBeGreaterThan(0);
    });

    it('extracts queryKey from useQuery options', () => {
      const queryHooks = usagesOfType(result, 'QUERY_HOOK_DEF');
      const usersHook = queryHooks.find(h => h.name === 'useUsersListQuery');

      expect(usersHook).toBeDefined();
      expect(usersHook!.details.queryKey).toBeDefined();
      expect(usersHook!.details.queryKey).toContain('usersQueryKeys');
    });

    it('detects inline queryKey arrays', () => {
      const queryHooks = usagesOfType(result, 'QUERY_HOOK_DEF');
      const teamHook = queryHooks.find(h => h.name === 'useTeamDetailQuery');

      expect(teamHook).toBeDefined();
      expect(teamHook!.details.queryKey).toContain('teams');
    });
  });

  describe('MUTATION_HOOK_DEF', () => {
    it('detects useMutation hook definitions', () => {
      const mutationHooks = usagesOfType(result, 'MUTATION_HOOK_DEF');

      expect(mutationHooks).toHaveLength(1);
      expect(mutationHooks[0].name).toBe('useCreateTeamMutation');
      expect(mutationHooks[0].containingFunction).toBe('<module>');
    });
  });

  describe('QUERY_KEY_DEF', () => {
    it('detects query key factory objects', () => {
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
      const fetchCalls = usagesOfType(result, 'FETCH_API_CALL');

      expect(fetchCalls.length).toBeGreaterThanOrEqual(2);

      const usersFetch = fetchCalls.find(f => f.details.url?.includes('/api/users/user-data'));
      expect(usersFetch).toBeDefined();
      expect(usersFetch!.details.schema).toBe('UserArraySchema');
    });

    it('reports containing function for fetchApi calls', () => {
      const fetchCalls = usagesOfType(result, 'FETCH_API_CALL');
      const inUsersQuery = fetchCalls.find(f => f.containingFunction === 'useUsersListQuery');

      expect(inUsersQuery).toBeDefined();
    });
  });

  describe('API_ENDPOINT', () => {
    it('detects /api/ string patterns from fetchApi calls', () => {
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
      const invalidations = usagesOfType(result, 'QUERY_INVALIDATION');

      expect(invalidations).toHaveLength(1);
      expect(invalidations[0].details.queryKey).toContain('usersQueryKeys.all()');
      expect(invalidations[0].containingFunction).toBe('useCreateTeamMutation');
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual usage counts', () => {
      const { summary, usages } = result;

      for (const type of Object.keys(summary) as DataLayerUsageType[]) {
        const count = usages.filter(u => u.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected usage types', () => {
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
