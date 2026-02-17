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

## Prerequisite

If you have not run `audit-react-feature` for this hook's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

## Step 1: Build the dependency picture

Read the target file. Then read:
- Every file it imports (API utilities, query key constants, type files, other hooks)
- Every consumer of this hook (grep for its name across the codebase)
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

### 2e. Return surface (least power)

Check what the hook returns:
- Does it return the full TanStack Query result, or a curated subset?
- Does it return mutation functions that no consumer uses?
- Does it return internal state that should be private?

The return type should be the minimum surface consumers actually need. If every
consumer destructures the same 3 fields from a 15-field return, narrow the return.

### 2f. Correct file location

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

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored hook or its consumers, run them with
the project's test runner. Report the results in the summary.

After rewriting, output a short summary of what changed, what files were created or
modified, what consumers need to absorb which side effects, and whether type-checking
and tests passed.
