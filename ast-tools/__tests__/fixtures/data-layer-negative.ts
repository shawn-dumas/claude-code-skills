/* eslint-disable */
// Fixture file for ast-data-layer negative tests.
// Tests edge cases and false positive scenarios.

// 1. Function named 'useCustomQuery' that is NOT a TanStack Query hook
// SHOULD be detected as QUERY_HOOK_DEFINITION observation (name matches pattern).
// The observation reports it; the interpreter/skill verifies if
// it actually uses useQuery internally.
export function useCustomQuery(sql: string): string {
  return `SELECT * FROM ${sql}`;
}

// 2. Variable ending in 'Keys' that is NOT a query key factory
// Should NOT be QUERY_KEY_FACTORY (not an object literal with as const)
const colorKeys = ['red', 'green', 'blue'];

export function getColors(): string[] {
  return colorKeys;
}

// 3. fetch() call that is not fetchApi
// Should NOT be FETCH_API_CALL (it's a bare fetch, not fetchApi)
async function loadData(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json();
}

export { loadData };

// 4. Object ending in 'Keys' but not structured as a query key factory
// This is just a simple object, not { methodName: () => [...] as const }
export const configKeys = {
  primary: 'config_primary',
  secondary: 'config_secondary',
};

// 5. Mutation function that does NOT follow the hook pattern
// Should NOT be detected (no 'use' prefix)
export function createItemMutation(data: { name: string }): Promise<unknown> {
  return fetch('/api/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// 6. A properly structured query key factory (for comparison)
// This SHOULD be detected as QUERY_KEY_DEF
export const itemsQueryKeys = {
  all: () => ['items'] as const,
  list: (filter?: string) => [...itemsQueryKeys.all(), 'list', filter] as const,
  detail: (id: string) => [...itemsQueryKeys.all(), 'detail', id] as const,
} as const;

// 7. String that contains '/api/' but is not in a fetchApi call
// Should NOT create API_ENDPOINT observation
const API_DOCS_URL = 'https://docs.example.com/api/v1/reference';
export function getDocsUrl(): string {
  return API_DOCS_URL;
}
