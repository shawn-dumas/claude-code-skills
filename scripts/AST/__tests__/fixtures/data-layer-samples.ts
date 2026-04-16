/* eslint-disable */
// Fixture file for ast-data-layer tests. Contains intentional data layer patterns.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// --- QUERY_KEY_DEF: query key factory object ---
const USERS_PREFIX = 'users' as const;

export const usersQueryKeys = {
  all: () => [USERS_PREFIX] as const,
  list: () => [...usersQueryKeys.all(), 'list'] as const,
  detail: (id: string) => [...usersQueryKeys.all(), 'detail', id] as const,
} as const;

// --- Helper stubs to make the fixture parse ---
function useFetchApi() {
  return {
    fetchApi: async <T>(url: string, config: { method: string; schema: unknown; body?: string }): Promise<T | null> => {
      return null;
    },
  };
}

const UserArraySchema = {};
const TeamSchema = {};

// --- QUERY_HOOK_DEF + FETCH_API_CALL + API_ENDPOINT ---
export function useUsersListQuery(teamId?: string) {
  const { fetchApi } = useFetchApi();

  return useQuery({
    queryKey: [...usersQueryKeys.list(), teamId],
    queryFn: async () => {
      const result = await fetchApi<unknown[]>('/api/users/user-data', {
        method: 'GET',
        schema: UserArraySchema,
      });
      if (!result) throw new Error('Failed to load users list');
      return result;
    },
  });
}

// --- MUTATION_HOOK_DEF + QUERY_INVALIDATION + FETCH_API_CALL + API_ENDPOINT ---
export function useCreateTeamMutation() {
  const { fetchApi } = useFetchApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { name: string }) => {
      const result = await fetchApi<unknown>('/api/teams/create', {
        method: 'POST',
        body: JSON.stringify(params),
        schema: TeamSchema,
      });
      if (!result) throw new Error('Failed to create team');
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersQueryKeys.all() });
    },
  });
}

// --- Another QUERY_HOOK_DEF with inline queryKey ---
export function useTeamDetailQuery(id: string) {
  const { fetchApi } = useFetchApi();

  return useQuery({
    queryKey: ['teams', 'detail', id],
    queryFn: async () => {
      const result = await fetchApi<unknown>(`/api/teams/${id}`, {
        method: 'GET',
        schema: TeamSchema,
      });
      return result;
    },
  });
}
