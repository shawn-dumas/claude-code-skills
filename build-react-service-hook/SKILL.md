---
name: build-react-service-hook
description: Generate a new React service hook (useQuery or useMutation) that fetches or mutates data. Owns its own useFetchApi call, query key, and query function. No toasts, no navigation, no storage.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <domain/useHookName> <description>
---

Generate a new React service hook. `$ARGUMENTS`

The first token is the hook path: `<domain>/<useHookName>` (e.g.,
`insights/useTopUsedQuery`). Everything after the first whitespace is the
description of what data to fetch or mutate.

## Step 1: Parse the argument

Extract the domain name and hook name. Classify the hook:

- **Query hook** if the name contains `Query`, `Data`, `List`, or the description
  says "fetch", "get", "list", "read". Target: `src/ui/services/hooks/queries/<domain>/`
- **Mutation hook** if the name contains `Mutation`, `Create`, `Update`, `Delete`,
  or the description says "mutate", "create", "update", "delete", "post", "put",
  "patch". Target: `src/ui/services/hooks/mutations/<domain>/`

If the target directory does not exist, it will be created. This is normal -- the
`services/hooks/` directory structure is established incrementally by the first
invocations of build and refactor skills.

## Step 2: Survey the codebase

- Grep for `<domain>QueryKeys` or a query keys file for this domain. Read it if
  found to understand the existing key hierarchy.
- Read `src/ui/urls_registry.ts` to find the API endpoint for this domain
- Read `src/shared/lib/fetchApi/useFetchApi.ts` to understand the fetch pattern
  (the hook must own its own `useFetchApi()` call)
- Read 1-2 existing query or mutation hooks anywhere in the codebase to match
  conventions (even if they use the old factory pattern, the data shapes and API
  contracts are informative)

## Step 3: Design the query key

If the domain already has a query keys file, add a new entry following the
hierarchical factory pattern:

```ts
export const domainQueryKeys = {
  all: () => ['domain-prefix'] as const,
  specificThing: {
    all: () => [...domainQueryKeys.all(), 'specific-thing'] as const,
    detail: (id: string) => [...domainQueryKeys.specificThing.all(), id] as const,
  },
};
```

If no query keys file exists for the domain, create one at the same directory level
as the hook file.

## Step 4: Generate the files

Create the target directory with `mkdir -p` if it does not exist.

### 4a. `<useHookName>.ts`

- Direct `useQuery` or `useMutation` call (no factory indirection)
- Owns its own `useFetchApi()` call
- Imports query key from the domain's query keys file
- Types the request parameters and response explicitly
- For queries: includes `staleTime`, `enabled`, and other relevant options
- For mutations: `onSuccess` invalidates only same-domain query keys
- The hook must NOT:
  - Call toastSuccess/toastError/toastWarning
  - Call useRouter or navigate
  - Write to localStorage/sessionStorage
  - Import query keys from another domain
  - Dispatch context actions
  - Fire analytics events
- If `select` is used, it must be a pure function (no setState, no side effects)
- Return type is the minimum surface consumers need. Add an explicit return type
  annotation if narrowing from the full TanStack Query result.

### 4b. `index.ts`

```ts
export { useHookName } from './useHookName';
```

### 4c. `queryKeys.ts` (if first hook for domain)

Create the query keys file with the hierarchical factory pattern.

### 4d. `<useHookName>.spec.ts`

The generated test must score 10/10 on `/audit-react-test`. Follow the
contract-first testing principles below.

**Strategy:** Hook unit test with `QueryClientProvider` wrapper. Service hooks
call `useQuery`/`useMutation` via `useFetchApi`, so they need a QueryClient.
Use `fetchMock` (globally available from vitest-fetch-mock) to intercept
network calls at the fetch boundary (P2, P4).

**Imports:**

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
// Import fixture builders for response data
import { buildTeam } from '@/fixtures';
import { useMyQuery } from './useMyQuery';
```

**Test infrastructure:**

```ts
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}
```

**Test data (P5 + P6):**

- Use fixture builders from `src/fixtures/domains/` for response data. Check
  `src/fixtures/domains/` for builders before writing inline data.
- Mock responses with `fetchMock.mockResponseOnce(JSON.stringify(data))`.
- No `as any`. Use explicit types and `satisfies` for mock data.

**Test cases — cover the hook's public API:**

For **query hooks:**
- Returns expected data shape on success (assert `result.current.data`).
- Calls fetch with correct URL and parameters (assert via `fetchMock`
  call args).
- Handles `enabled: false` (hook does not fire fetch).
- Tests `select` transformation if the hook uses one (assert on
  `result.current.data` shape, not on the `select` function directly).
- Handles fetch error (mock rejection, assert `result.current.isError`).

For **mutation hooks:**
- Returns `mutate`/`mutateAsync` function.
- Calls fetch with correct URL, method, and body on invocation.
- `onSuccess` invalidates correct query keys (spy on `queryClient.invalidateQueries`).

**Cleanup (P10):**

```ts
beforeEach(() => {
  fetchMock.resetMocks();
});
```

The global `vitest.setup.ts` handles `afterEach(() => vi.clearAllMocks())`.
Do NOT add redundant cleanup. Add `afterEach(() => vi.useRealTimers())` only
if using fake timers.

**Mocking (P2):** Mock only at the fetch boundary via `fetchMock`. Do NOT
mock own utility functions, own query key helpers, or own `select` mappers.
Let them run — they are internal implementation.

**Assertions (P1):** Assert on `result.current.data`, `result.current.isSuccess`,
`result.current.isError` — the hook's public return surface. Do not assert on
internal state, query key construction, or effect execution.

**Do NOT generate:**
- `// TODO:` markers. Write real, passing tests.
- Tests that mock own utility functions or own query key files.
- Snapshot tests.

## Type touchpoints

Before defining any new type or interface for request/response shapes, check first:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. For new shared types, add them to the appropriate domain module in
   `src/shared/types/`, not inline in the hook file.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test file with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths) and
whether type-checking and tests passed.
