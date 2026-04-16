/* eslint-disable */
// Fixture: covers extractQueryKeyFromCallArgs and extractFetchApiSchema
// when queryKey/schema are passed as shorthand property assignments (not PropertyAssignment).
// This triggers the `return null` at lines 63 and 107 in ast-data-layer.ts.

import { useQuery, useMutation } from '@tanstack/react-query';

// The queryKey shorthand covers line 63:
// getProperty('queryKey') finds a ShorthandPropertyAssignment, not PropertyAssignment.
// extractQueryKeyFromCallArgs returns null.
export function useShorthandKeyQuery(id: string) {
  const queryKey = ['shorthand', id];
  return useQuery({
    queryKey,
    queryFn: async () => ({ id }),
  });
}

function fetchApi<T>(url: string, config: { method: string; schema: unknown }): Promise<T> {
  return fetch(url).then(r => r.json()) as Promise<T>;
}

// The schema shorthand covers line 107:
// getProperty('schema') finds a ShorthandPropertyAssignment, not PropertyAssignment.
// extractFetchApiSchema returns null.
export function useShorthandSchemaMutation() {
  const schema = {};
  return useMutation({
    mutationFn: async (params: { name: string }) => {
      return fetchApi<unknown>('/api/items', { method: 'POST', schema });
    },
  });
}
