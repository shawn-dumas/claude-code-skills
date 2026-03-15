---
name: refactor-react-service-hook
description: Refactor a React service hook (useQuery/useMutation) to follow single-responsibility, no-factory, and single-domain principles. Strips toasts, navigation, storage, cross-domain keys, and factory indirection.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/useServiceHook.ts>
---

Refactor the React service hook at `$ARGUMENTS`.

This skill is specifically for hooks that call useQuery or useMutation. For DOM/browser
utility hooks, state utility hooks, or context-wrapping hooks, use `refactor-react-hook`
instead.

This skill also applies when converting a manual fetch pattern (useEffect + fetch() +
useState for loading/error/data) into a proper TanStack Query hook. If the target file
contains raw `fetch()` inside a useEffect instead of useQuery, that is the primary
violation to fix.

## Prerequisite

If you have not run `audit-react-feature` for this hook's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

## Step 0: Run AST analysis tools

```bash
npx tsx scripts/AST/ast-react-inventory.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-data-layer.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-hooks.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-effects.ts $ARGUMENTS --pretty
```

Use hook assessments from `ast-interpret-hooks` to verify the hook is
correctly classified as `LIKELY_SERVICE_HOOK`. If it is `UNKNOWN_HOOK`,
determine whether it should be a service hook or utility hook.

Use effect assessments from `ast-interpret-effects` for Step 2h:

- `DERIVED_STATE` effects involving fetch calls indicate manual fetch
  patterns that should be converted to useQuery

Use import observations for cross-domain key detection (Step 2d) --
`STATIC_IMPORT` from other domain's query key files are violations.

Use side effect observations for Step 2a:

- `TOAST_CALL` -- belongs in container onSuccess, not hook
- `POSTHOG_CALL` -- analytics belongs in container
- `WINDOW_MUTATION` (navigation) -- belongs in container

Use data layer observations for Steps 2b/2c/2d/2f/2h:

- `QUERY_HOOK_DEFINITION` / `MUTATION_HOOK_DEFINITION` -- verify structure
- `QUERY_INVALIDATION` -- check for cross-domain keys
- `FETCH_API_CALL` -- verify correct API path sourcing
- `API_ENDPOINT` -- should be inline string, not imported from urlsRegistry

## Step 1: Build the dependency picture

Read the target file. Then read:

- Every file it imports (API utilities, query key constants, type files, other hooks)
- Every consumer of this hook (use `npx tsx scripts/AST/ast-imports.ts --consumers $ARGUMENTS --pretty`)
- The query key constants file for this domain
- Any cross-domain query key files this hook imports

Build a map of what this hook depends on and what depends on it.

## Step 2: Audit against each principle

### 2a. Single responsibility

A service hook fetches or mutates data. That is all. It must NOT:

- Call toastSuccess/toastError/toastWarning (containers decide user feedback)
- Call useRouter or navigate (containers decide navigation)
- Write to localStorage/sessionStorage (containers or storage hooks own this)
- Dispatch context actions (containers own context interactions)
- Fire analytics events (containers own side effects)

For each violation, record the file, the line, what the hook does, and which
container callback should absorb the responsibility.

### 2b. No factory indirection

If the hook uses createQueryFactory, createMutationFactory, or any curried factory
pattern, it must be rewritten as a direct useQuery/useMutation call. The hook should
own its own:

- useFetchApi() call
- Query key
- Query/mutation function
- Options (staleTime, gcTime, enabled, select, etc.)

Factory wrappers hide what the hook actually does and make it harder to customize
per-call-site options.

### 2c. No mapper side effects

If the hook's useQuery `select` option calls setState, dispatches actions, or triggers
any side effect, that is wrong. `select` may be called multiple times or be memoized
by TanStack Query. It must be a pure function that returns transformed data only.

If consumers need derived state, they compute it with useMemo from the query's `.data`.

### 2d. Single-domain query keys

A service hook imports only its own domain's query key constants. It does NOT import
keys from other domains for cache invalidation.

If a mutation's onSuccess currently invalidates queries from another domain:

- Remove the cross-domain invalidation from the hook
- Document which container's onSuccess callback should own it instead

The hook's onSuccess/onError callbacks should only handle same-domain cache updates.

### 2e. Mutation options forwarding

For mutation hooks: verify the hook accepts an optional `options` parameter
(typed as `MutationOpts` from `src/ui/services/hooks/types`) that forwards
caller-provided `onSuccess`/`onError` callbacks. The hook's own `onSuccess`
(cache invalidation) runs first, then the caller's. If the mutation does not
accept options, add it. See `build-react-service-hook` for the pattern.

### 2f. API path sourcing

Service hooks hardcode their API endpoint path as a string literal. They must
NOT import path helpers from `urlsRegistry.ts` (that file is for page route
helpers only). If the hook imports from `urlsRegistry`, inline the path string
and remove the import.

### 2g. Return surface (least power)

Check what the hook returns:

- Does it return the full TanStack Query result, or a curated subset?
- Does it return mutation functions that no consumer uses?
- Does it return internal state that should be private?

The return type should be the minimum surface consumers actually need. If every
consumer destructures the same 3 fields from a 15-field return, narrow the return.

### 2h. Manual fetch conversion

Review effect assessments from `ast-interpret-effects`:

- **`DERIVED_STATE`** with fetch/async calls indicate manual fetch patterns
  that should be converted to useQuery
- **`TIMER_RACE`** may indicate a fetch without proper cancellation

If the hook (or container) uses `useEffect` + `fetch()` + `useState` for
loading/error/data with a `let isCancelled = false` cleanup pattern, convert to
useQuery:

- The `queryFn` receives the fetch logic (no manual cancellation needed -- TQ
  handles AbortSignal)
- The `queryKey` captures all dependencies that would have been in the useEffect
  dependency array
- `enabled` replaces the early-return guard inside the useEffect
- `useState` for loading/error/data is deleted entirely -- useQuery provides
  `isLoading`, `error`, and `data`
- If mock and real data paths coexist (e.g., `if (shouldUseMock) { ... } else { fetch(...) }`),
  both go inside `queryFn` with a conditional branch
- `staleTime` and `refetchOnWindowFocus` should be set appropriately for the data
  characteristics (e.g., static CSV data gets `staleTime: 5 * 60 * 1000`)

### 2i. Correct file location

Service hooks should live in:

- `services/hooks/queries/` for useQuery hooks
- `services/hooks/mutations/` for useMutation hooks

If the hook is in the wrong directory, it should be moved.

## Step 3: Report

Output a clear report:

```
## Audit: <hookName>

### Current location
<file path> -- should be in <correct directory>

### Consumers
<list of files that import this hook>

### Side effects found (should be 0)
| Line | Side effect | Should move to |
|------|-------------|----------------|
| ...  | toast call  | container X onSuccess |

### Cross-domain keys imported (should be 0)
| Line | Foreign key | Should move to |
|------|-------------|----------------|
| ...  | ...         | container X onSuccess |

### Factory indirection
<uses factory | direct call>

### Mapper side effects
<list or "none">

### Violations found

1. **[Principle name]** <file>:<line>
   What: <description>
   Fix: <what to do>

2. ...

### No issues
- [List principles with no violations]
```

## Step 4: Rewrite

Apply all fixes. Follow these rules:

- **Rewrite factory calls as direct useQuery/useMutation.** The hook owns its own
  useFetchApi() call. Preserve the same query key, URL builder, and type signatures.
- **Strip all side effects.** Remove toast calls, navigation, storage writes, context
  dispatches, and analytics from the hook body and from onSuccess/onError callbacks.
  Document which container callback should absorb each one.
- **Remove cross-domain invalidation.** Delete imports of foreign query keys. Keep
  only same-domain invalidation in onSuccess. Document which container should handle
  the cross-domain invalidation.
- **Purify `select`.** Remove any setState or side-effect calls from `select` options.
  Return pure transformed data only.
- **Narrow the return type.** If the hook wraps TanStack Query, return only the fields
  consumers actually use. Add an explicit return type annotation.
- **Move the hook** to the correct directory if it is in the wrong place.
  When moving a file, update every import across the codebase that references the
  old path. Grep for the old module name, update each import, and list every file
  changed. Because this skill runs in a forked context, do not run it in parallel
  with other refactor skills that touch the same import graph.
- Do not change behavior. Consumers should get the same data, just through a cleaner
  interface. Side effects that were removed must be documented so the caller knows
  to absorb them.

## Type touchpoints

When you encounter inline types during the refactor, check whether they belong in
`src/shared/types/`:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. When you find inline request/response types used cross-domain (imported by
   files in other feature areas), move them to the appropriate domain module in
   `src/shared/types/` and update all import sites.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored hook or its consumers, run them with
the project's test runner. Report the results in the summary.

### Step 5b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher to verify the refactor
preserved the hook's behavioral signals. **This step is mandatory.**
Do not skip it. Do not report success without running it and including
the output in your summary. A low score blocks the refactor until
investigated and resolved.

**`refactorType: 'service-hook'`**

Note: this skill intentionally strips side effects (toasts, navigation,
storage). The `refactorType: 'service-hook'` heuristic classifies these
as INTENTIONALLY_REMOVED rather than ACCIDENTALLY_DROPPED.

1. Collect the file lists:

   - **beforeFiles**: the original service hook file
   - **afterFiles**: the modified hook file

2. Run the intention matcher:

   ```bash
   npx tsx scripts/AST/ast-refactor-intent.ts \
     --before <beforeFiles...> \
     --after <afterFiles...> \
     > /tmp/signal-pair.json
   ```

3. Run the interpreter:

   ```bash
   npx tsx scripts/AST/ast-interpret-refactor-intent.ts \
     --signal-pair /tmp/signal-pair.json \
     --refactor-type service-hook \
     --pretty
   ```

4. Check the interpreter's exit code:

   - **Exit 0** (score >= 90, zero ACCIDENTALLY_DROPPED): proceed to summary.
   - **Exit 1** (score >= 70, has ACCIDENTALLY_DROPPED): review the pretty-
     printed output. List the dropped signals, assess whether each is truly
     accidental. If all are explained (e.g., dead code removal), proceed.
     If any are genuine drops, fix them before proceeding.
   - **Exit 2** (score < 70): stop and investigate. Something went wrong.

5. If the intention matcher flags a signal as ACCIDENTALLY_DROPPED and
   investigation confirms it was actually intentional (e.g., removing dead
   code, cleaning up an unused side effect that the audit did not explicitly
   flag), create a calibration fixture:

   a. Create a directory:
   `scripts/AST/ground-truth/fixtures/feedback-<date>-<brief-description>/`

   b. Copy the before-file(s) into the directory with a "before-" prefix.
   Copy the after-file(s) with an "after-" prefix. These are snapshots
   of the actual code at this moment -- not references to live files.

   c. Write a `manifest.json`:

   ```json
   {
     "tool": "intent",
     "created": "<ISO date>",
     "source": "feedback",
     "refactorType": "service-hook",
     "beforeFiles": ["before-<filename>"],
     "afterFiles": ["after-<filename>"],
     "expectedClassifications": [
       {
         "kind": "<observation kind that was misclassified>",
         "functionContext": "<containing function name>",
         "expectedClassification": "INTENTIONALLY_REMOVED",
         "actualClassification": "ACCIDENTALLY_DROPPED",
         "notes": "<why this was actually intentional>"
       }
     ],
     "status": "pending"
   }
   ```

   Classify ALL signals in the fixture, not just the misclassified one.
   The calibration skill needs the full picture to tune weights without
   regressing other classifications.

   The calibration skill follows a diagnostic-first approach: it checks
   for algorithmic defects before tuning weights. See
   `scripts/AST/docs/ast-calibration.md`.

   d. Note in the summary output: "Created calibration fixture:
   feedback-<date>-<description>. Run /calibrate-ast-interpreter --tool
   intent when 3+ pending fixtures accumulate. See
   scripts/AST/docs/ast-calibration.md for current accuracy baselines."

## Step 6: Summary

Output a short summary of what changed, what files were created or
modified, what consumers need to absorb which side effects, and whether
type-checking and tests passed.

### Files Changed

```
Before (read from HEAD):
- <file1>

After (written/modified):
- <file1> (modified)
```

### Intent preservation

```
Intent preservation: <score>/100
  Preserved: <N> | Intentionally removed: <N> | Dropped: <N> | Added: <N>
```

If any ACCIDENTALLY_DROPPED signals exist, list them with the `!!` marker
from the interpreter's pretty-print.
