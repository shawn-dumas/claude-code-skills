---
name: refactor-react-provider
description: Refactor a React context provider to hold only UI state. Strips data-fetching logic, audits context breadth, fixes mapper side effects, and implements cleanup registration.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/SomeProvider.tsx>
---

Refactor the React context provider at `$ARGUMENTS`.

## Prerequisite

If you have not run `audit-react-feature` for this provider's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

## Step 1: Build the dependency picture

Read the target file. Then read:
- The context definition (createContext call, type interface)
- Every hook and utility the provider imports
- Every consumer of the context (grep for the context hook name across the codebase)
- Any standalone service hooks that already exist for this domain

Count the fields in the context interface. List every consumer and which fields it
actually uses.

## Step 2: Audit against each principle

### 2a. Data-fetching does not belong in providers

Providers hold shared UI state only. Check for:
- useQuery/useMutation calls defined inside the provider
- Factory hook calls (createQueryFactory, createMutationFactory)
- API calls or data transformation logic
- Query key definitions embedded in the provider file

All of these should be standalone service hooks in `services/hooks/`. The provider
should not know how data is fetched.

### 2b. Mapper side effects

Check every useQuery `select` option and any data transformation callback:
- Does `select` call setState, dispatch, or trigger any side effect?
- `select` may be called multiple times or memoized by TanStack Query. It must be
  a pure function that returns transformed data, nothing else.

### 2c. Context breadth (least power)

Count the fields in the context interface. For each consumer, count how many fields
it actually reads.

- If the context has >10 fields, it is likely too broad.
- If consumers typically read 2-3 fields out of 15+, every consumer re-renders on
  changes to fields it does not use.
- Group fields by co-occurrence of consumption. Fields that are always read together
  belong in one context. Fields read by different consumers belong in separate contexts.

### 2d. State ownership

For each piece of state in the provider, classify it:

- **Derived.** Computable from other state, props, or query data. Do not store it.
  Replace with `useMemo` or inline computation.
- **Server data copy.** A piece of state that mirrors query cache data (often synced
  via `useEffect`). Delete it and read from the query result directly.
- **URL-worthy.** State that affects what the user sees on reload: filters, sort
  order, tab selection, date range, pagination, selected team/user. Move to URL
  search params using nuqs (`useQueryState` / `useQueryStates`). The container
  reads the URL and passes values as props + setter callbacks.

  URL-worthy criteria (all three should be true):
  1. Changes what data is fetched or what view is rendered
  2. A user sharing the URL should see the same view (deep linking)
  3. The browser back button should restore it

  What stays OUT of the URL:
  - Session-level identity (company/tenant ID) -- multi-tenancy hidden from customers
  - Ephemeral UI state (modal open, tooltip visible)
  - Form-in-progress data (owned by the form library)

- **Single-owner UI state.** Legitimate shared UI state with one owner. Kept as a
  thin scoped context (`XxxScopeProvider`) if it meets the escape-hatch criteria,
  or moved to the container if only one route needs it.
- **Multi-writer.** Multiple uncoordinated writers to the same state. This is a bug.
  Identify the single owner and have others receive it as a prop.

Decision tree after stripping queries and derived state:

1. Is the remaining state URL-worthy? --> Move to URL (nuqs) in the container. Provider field deleted.
2. Is it session-level identity (company/tenant)? --> Keep as scoped context.
3. Is it consumed by multiple routes through 3+ intermediaries? --> Keep as scoped context.
4. Is it consumed by only one route or section? --> Move to the container. Provider field deleted.
5. Nothing left? --> Delete the provider entirely.

### 2e. useEffect discipline

Flag every useEffect in the provider and classify it:
- Derived state sync (useEffect + setState where useMemo works) -- **wrong**
- Data-fetching side effects (sync query data into provider state) -- **wrong**
- Logout/reset watchers (useEffect on auth state to clear provider state) -- **wrong,
  use cleanup registry instead**
- External system subscriptions -- **ok**

### 2f. Storage coupling

Does the provider read or write localStorage/sessionStorage?
- If so, does it own that key exclusively, or do other modules also read/write it?
- Does the provider register a cleanup function for logout, or does some external
  logout function know about this provider's storage keys?

### 2g. Cross-domain coupling

Does the provider import query keys from other domains for cache invalidation?
- Providers should not invalidate other domains' caches. That responsibility belongs
  to containers.
- Check for circular imports between providers (Provider A imports Provider B's keys
  and vice versa).

## Step 3: Report

Output a clear report:

```
## Audit: <ProviderName>

### Context interface
<field count> fields -- <assessment: ok | too broad | split recommended>

### Consumer analysis
| Consumer | Fields used | Out of |
|----------|-------------|--------|
| ...      | 3           | 19     |

### Data-fetching embedded
<count> query hooks, <count> mutation hooks -- should be standalone

### Violations found

1. **[Principle name]** <file>:<line>
   What: <description>
   Fix: <what to do>

2. ...

### Recommended split (if applicable)
- Context A (<name>): <fields> -- consumed by <list>
- Context B (<name>): <fields> -- consumed by <list>

### No issues
- [List principles with no violations]
```

## Step 4: Rewrite

Apply all fixes. Follow these rules:

- **Strip data-fetching.** Remove all useQuery/useMutation definitions from the
  provider. If standalone service hooks do not already exist for this domain, create
  them in `services/hooks/`. Each hook is a direct useQuery/useMutation call with
  its own useFetchApi(). No factory indirection.
- **Remove mapper side effects.** Delete any setState calls inside `select` options.
  The new standalone hooks return pure data. Consumers derive what they need with
  useMemo.
- **Split broad contexts.** If the audit recommends a split, create separate context
  files. Each context has its own provider, its own hook, and its own type interface.
  Group fields by co-occurrence of consumption. Aim for <=10 fields per context.
- **Replace logout watchers with cleanup registration.** If the provider has a
  useEffect watching auth state to clear its own state on logout, replace it with
  a cleanup registration pattern. The provider does not watch auth state.

  The pattern works as follows. First, check if a cleanup registry already exists
  in the codebase (grep for `registerCleanup`, `useCleanupRegistry`, or a
  `cleanupRegistry` module). If one exists, use it. If none exists, create a minimal
  one:

  ```ts
  // shared/cleanup-registry.ts
  type CleanupFn = () => void;
  const cleanups: CleanupFn[] = [];

  export function registerCleanup(fn: CleanupFn): () => void {
    cleanups.push(fn);
    return () => {
      const idx = cleanups.indexOf(fn);
      if (idx >= 0) cleanups.splice(idx, 1);
    };
  }

  export function runAllCleanups(): void {
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  }
  ```

  The auth/logout layer calls `runAllCleanups()` on logout. Each provider calls
  `registerCleanup` inside a useEffect to register its own reset function, and
  returns the unregister function as the effect cleanup:

  ```ts
  useEffect(() => {
    return registerCleanup(() => {
      setState(initialState);
      removeStorage(STORAGE_KEY); // from @/shared/utils/typedStorage
    });
  }, []);
  ```

  This inverts the dependency: the provider does not import auth concerns, and the
  auth layer does not know which providers exist. The registry is the only coupling
  point.
- **Eliminate derived state.** Replace useEffect + setState patterns with useMemo or
  inline computation.
- **Migrate URL-worthy state to nuqs.** For each field identified as URL-worthy in
  Step 2d, delete it from the provider and add a `useQueryState` / `useQueryStates`
  call in the container that will own it. Use the appropriate nuqs parser
  (`parseAsString`, `parseAsInteger`, `parseAsArrayOf`, `parseAsJson`, etc.). Pass
  the value and setter as props to children. If the field was previously persisted
  in localStorage, the URL replaces localStorage as the persistence mechanism --
  delete the localStorage read/write for that key.
- **Delete the provider entirely** if, after stripping queries, derived state, and
  URL-worthy state, nothing remains. If only one or two pieces of state remain,
  consider whether a thin UI context is justified or whether the state can live in
  a container.
- Do not change behavior. Consumers should get the same data and capabilities, just
  without the provider owning data-fetching or cross-domain concerns.

## Type touchpoints

When you encounter inline types during the refactor, check whether they belong in
`src/shared/types/`:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. When you find inline types used cross-domain (imported by files in other
   feature areas), move them to the appropriate domain module in
   `src/shared/types/` and update all import sites.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored provider or its consumers, run them
with the project's test runner. Report the results in the summary.

After rewriting, output a short summary of what changed, what files were created or
modified, whether type-checking and tests passed, and list any consumers that now need
to switch from the old context hook to standalone service hooks or new split context
hooks.
