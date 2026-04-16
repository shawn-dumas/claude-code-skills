---
name: refactor-react-provider
description: Refactor a React context provider to hold only UI state. Strips data-fetching logic, audits context breadth, fixes mapper side effects, and implements cleanup registration.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/SomeProvider.tsx>
---

Refactor the React context provider at `$ARGUMENTS`.

<!-- role: guidance -->

## Prerequisite

If you have not run `audit-react-feature` for this provider's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

<!-- role: workflow -->

## Step 0: Run AST analysis tools

```bash
npx tsx scripts/AST/ast-query.ts hooks $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts imports $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts side-effects $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts storage $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts data-layer $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts interpret-hooks $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts interpret-effects $ARGUMENTS --pretty
```

Use hook assessments from `ast-interpret-hooks` for data-fetching detection
(Step 2a):

- `LIKELY_SERVICE_HOOK` in a provider indicates embedded data-fetching
  that should be extracted to standalone service hooks

Use effect assessments from `ast-interpret-effects` for Step 2e:

- `DERIVED_STATE` effects indicate data fetching/syncing that does not
  belong in providers
- `TIMER_RACE` effects indicate cleanup registration gaps

Use import observations to find all consumers and measure context breadth
(Step 2c). Count `STATIC_IMPORT` observations that import the context hook.

Use side effect observations (`TOAST_CALL`, `POSTHOG_CALL`) for Step 2b
(mapper side effects) and Step 2e (logout watchers).

Use storage observations (`DIRECT_STORAGE_CALL`, `TYPED_STORAGE_CALL`)
for Step 2f (storage coupling -- raw vs typedStorage, key ownership,
cleanup registration).

Use data layer observations (`QUERY_HOOK_DEFINITION`,
`MUTATION_HOOK_DEFINITION`, `FETCH_API_CALL`) for Step 2a
(useQuery/useMutation hooks embedded in the provider that must be
extracted).

<!-- role: workflow -->

## Step 1: Build the dependency picture

Read the target file. Then read:

- The context definition (createContext call, type interface)
- Every hook and utility the provider imports
- Every consumer of the context (use `npx tsx scripts/AST/ast-query.ts consumers $ARGUMENTS --pretty`)
- Any standalone service hooks that already exist for this domain

Count the fields in the context interface. List every consumer and which fields it
actually uses.

<!-- role: detect -->

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

**URL-dep useEffects in providers are lint-blocked.** ESLint's
`no-restricted-syntax` rule fires on useEffects whose dep list
contains URL-derived identifiers (`pathname`, `searchParams`,
`urlState`, `urlFilters`, `query`, `asPath`), references URL-derived
member expressions (`router.pathname`, `router.query`), or reads
`window.location` in the body. Scope: `src/ui/providers/**`. If the
refactor target has such a useEffect, three options in preference
order:
1. Delete it if the state it derives is already reactive via props or context.
2. Migrate it to an FSM lifecycle hook in `src/shared/utils/urlStateHooks.ts` — see CLAUDE.md "URL state FSM" section for the registry decision table (`renderInitHooks` for render-1 closure timing, `arriveDeeplinkHooks` / `arriveTransferHooks` / `arriveStashHooks` for navigation, `postMountHooks` for post-settle effects, `logoutHooks` for teardown).
3. If migration is out of scope for the current refactor, grandfather with an inline `// eslint-disable-next-line no-restricted-syntax -- <reason + migration ticket>` and file a follow-up in `$PLANS_DIR/continuation-prompts/2026-04-15-user-frontend-render-phase-slot-migration.md`.

The grandfathered sites in `src/ui/providers/context/auth/hooks/useAuthStateObserver.ts` and `src/ui/providers/posthogProvider.tsx` follow pattern 3 and are the reference examples.

Review effect assessments from `ast-interpret-effects`:

- **`DERIVED_STATE`** -- providers should not have these (data fetching
  belongs in service hooks, not providers)
- **`TIMER_RACE`** -- indicates cleanup registration gaps
- **`EVENT_HANDLER_DISGUISED`** -- effect triggered by callback prop,
  should be inline logic
- **`DOM_EFFECT`** -- unusual in providers, review carefully
- **`EXTERNAL_SUBSCRIPTION`** -- acceptable for external system subscriptions
- **`NECESSARY`** -- no issues detected

Additional provider-specific effect violations:

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

<!-- role: detect -->

## Step 3: Behavioral Preservation Checklist (MANDATORY)

Before rewriting, fill in the behavioral fingerprint for each applicable
category. This checklist prevents implicit behavior loss during refactoring.
Categories that do not apply to this file get "N/A" -- never omit a category.

If `ast-behavioral` is available, run it first to pre-populate categories
2, 3, 5, 6, 7, and 8. Categories 1 (state preservation across interactions),
4 (column/field parity), and 9 (export/download inclusion) require manual
inspection -- the tool provides partial signals but cannot fully cover them.

```bash
npx tsx scripts/AST/ast-query.ts behavioral $ARGUMENTS --pretty
```

| # | Category | Concrete values from this file | Preserved after rewrite? |
|---|----------|-------------------------------|------------------------|
| 1 | **State preservation** -- checkbox state, selection state, expanded/collapsed state that must survive filter changes or re-renders | | |
| 2 | **Null/empty display** -- exact fallback strings (N/A, dash, placeholder constant) for missing data | | |
| 3 | **Value caps/limits** -- render caps (.slice(0, N)), pagination limits, maxItems props | | |
| 4 | **Column/field parity** -- CSV export columns, table column definitions, header arrays | | |
| 5 | **String literal parity** -- exact button text, label wording, aria-labels, placeholder text | | |
| 6 | **Type coercion** -- String()/Number() calls, toString(), null-to-empty mappings at boundaries | | |
| 7 | **Default values** -- useState defaults, useQueryState defaults, prop defaults, function param defaults | | |
| 8 | **Conditional visibility** -- guards that control when UI elements appear/disappear (feature flags, role checks, data-dependent visibility) | | |
| 9 | **Export/download inclusion** -- which fields make it into CSV exports, download payloads, clipboard operations | | |

Fill in the "Concrete values" column with actual values from the file
being refactored (e.g., "useState(false) for isExpanded", "name ?? 'N/A'",
".slice(0, 5) render cap"). After the rewrite, confirm each row is
preserved (YES), intentionally changed (CHANGED -- explain), or not
applicable (N/A).

The reconciliation block must include the completed checklist.


<!-- role: emit -->

## Step 4: Report

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

<!-- role: emit -->

## Step 5: Rewrite

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
  in the codebase (`sg -p 'registerCleanup($$$)' src/` or
  `sg -p 'useCleanupRegistry($$$)' src/`). If one exists, use it. If none exists, create a minimal
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
    cleanups.forEach(fn => fn());
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

<!-- role: reference -->

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

<!-- role: workflow -->

## Step 6: Verify

Run `npx tsc --noEmit -p tsconfig.check.json` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored provider or its consumers, run them
with the project's test runner. Report the results in the summary.

### Step 6b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher to verify the refactor
preserved the provider's behavioral signals. **This step is mandatory.**
Do not skip it. Do not report success without running it and including
the output in your summary. A low score blocks the refactor until
investigated and resolved.

**`refactorType: 'provider'`**

1. Collect the file lists:

   - **beforeFiles**: the original provider file
   - **afterFiles**: the modified provider + any new service hook files +
     any new context files

2. Run the intention matcher:

   ```bash
   npx tsx scripts/AST/ast-refactor-intent.ts \
     --before <beforeFiles...> \
     --after <afterFiles...> \
     > /tmp/signal-pair.json
   ```

3. Run the interpreter:

   ```bash
   npx tsx scripts/AST/ast-query.ts interpret-intent \
     --signal-pair /tmp/signal-pair.json \
     --refactor-type provider \
     --pretty
   ```

4. Check the interpreter's exit code:

   - **Exit 0** (score >= 90, zero ACCIDENTALLY_DROPPED): proceed to summary.
   - **Exit 1** (score >= 70, has ACCIDENTALLY_DROPPED): review the pretty-
     printed output. List the dropped signals, assess whether each is truly
     accidental. If all are explained (e.g., dead code removal), proceed.
     If any are genuine drops, fix them before proceeding.
   - **Exit 2** (score < 70): stop and investigate. Something went wrong.

5. If a signal is flagged `ACCIDENTALLY_DROPPED` but investigation
   confirms it was intentional, run
   `/create-feedback-fixture --tool intent --file <before-file> --files <after-files> --expected INTENTIONALLY_REMOVED --actual ACCIDENTALLY_DROPPED`.

<!-- role: emit -->

## Step 7: Summary

Output a short summary of what changed, what files were created or
modified, whether type-checking and tests passed, and list any consumers
that now need to switch from the old context hook to standalone service
hooks or new split context hooks.

### Files Changed

```
Before (read from HEAD):
- <file1>

After (written/modified):
- <file1> (modified)
- <file2> (created)
- <file3> (created)
```

### Intent preservation

```
Intent preservation: <score>/100
  Preserved: <N> | Intentionally removed: <N> | Dropped: <N> | Added: <N>
```

If any ACCIDENTALLY_DROPPED signals exist, list them with the `!!` marker
from the interpreter's pretty-print.
