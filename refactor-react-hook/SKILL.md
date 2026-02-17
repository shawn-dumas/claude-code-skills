---
name: refactor-react-hook
description: Refactor a React custom hook to follow separation-of-concerns, least-power, and single-ownership principles. Audits the hook against architectural rules, reports violations, then rewrites.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/useCustomHook.ts>
---

Refactor the React custom hook at `$ARGUMENTS`.

## Prerequisite

If you have not run `audit-react-feature` for this hook's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

## Step 1: Build the dependency picture

Read the target file. Then read every file it imports -- other hooks, API utilities,
query key constants, type files, context providers. Also find all consumers of this
hook (grep for its name across the codebase). Build a map of what this hook depends on
and what depends on it.

## Step 2: Classify the hook

Determine what kind of hook this is:

- **Service hook** (data-fetching): calls useQuery/useMutation, talks to an API.
  Should live in `services/hooks/`. Should be a direct useQuery/useMutation call
  with no factory indirection. **If the hook is a service hook, stop here and use
  `refactor-react-service-hook` instead -- it has more targeted rules for
  factory indirection, mapper side effects, cross-domain keys, and return surface.**
- **Context-wrapping hook**: internally calls useContext or another context consumer.
  This is a hidden dependency -- it makes its consumers implicitly dependent on a
  provider tree. Should be inlined into containers, not used in leaves.
- **DOM/browser utility hook**: interacts with DOM APIs (ResizeObserver, click-outside,
  scroll, keyboard events). Should live in `shared/hooks/`.
- **State utility hook**: manages local state patterns (debounce, pagination, toggle).
  Should live in `shared/hooks/`.
- **Composite hook**: does multiple things (fetches data AND shows toasts AND navigates).
  Should be split.

## Step 3: Audit against each principle

### 3a. Separation of concerns

A hook should do one job. Check for layer violations:

- **Service hooks** fetch/mutate only. They must NOT:
  - Call toastSuccess/toastError/toastWarning (containers decide feedback)
  - Call useRouter or navigate (containers decide navigation)
  - Write to localStorage/sessionStorage (containers or dedicated storage hooks own this)
  - Import query keys from another domain (cross-domain invalidation belongs in containers)
- **Utility hooks** handle DOM/browser/state concerns only. They must NOT:
  - Call useQuery/useMutation (that makes them service hooks)
  - Call context consumer hooks (that makes them context-wrapping hooks)

### 3b. No factory indirection

If the hook uses createQueryFactory, createMutationFactory, or any curried factory
pattern, it must be rewritten as a direct useQuery/useMutation call. The hook should
own its own useFetchApi() call, query key, query function, and options.

### 3c. No mapper side effects

If the hook's useQuery `select` option calls setState, dispatches actions, or triggers
any side effect, that is wrong. `select` must be a pure function. Consumers read from
the query's `.data` directly. If derived state is needed, the consumer computes it
with useMemo.

### 3d. Single-domain query keys

A service hook imports only its own domain's query key constants. It does NOT import
keys from other domains for cache invalidation. If a mutation in one domain must
invalidate queries in another domain, that invalidation call happens in the container's
onSuccess callback, not inside the hook.

### 3e. Least power

- Does the hook return capabilities the consumer does not need? (e.g., returns a
  mutateAsync function when the consumer only reads data)
- Does the hook accept options the consumer cannot meaningfully customize?
- Could the hook be simpler? If it wraps useQuery with zero customization, maybe the
  consumer should just call useQuery directly.

### 3f. Duplicate patterns

Check if this hook duplicates logic that already exists in another hook or could be
extracted into a shared utility:
- Multiple hooks with the same click-outside/escape-key/resize pattern
- Multiple hooks reading the same storage key independently
- Multiple hooks with identical error handling or retry logic

## Step 4: Report

Output a clear report:

```
## Audit: <hookName>

### Classification
<service | context-wrapping | DOM utility | state utility | composite>

### Current location
<file path> -- should be in <correct directory>

### Consumers
<list of files that import this hook>

### Violations found

1. **[Principle name]** <file>:<line>
   What: <description>
   Fix: <what to do>

2. ...

### No issues
- [List principles with no violations]
```

## Step 5: Rewrite

Apply all fixes. Follow these rules:

- If the hook is a service hook using factory indirection, rewrite it as a direct
  useQuery or useMutation call. The hook owns its own useFetchApi() call. Preserve
  the same query key, URL builder, and type signatures.
- If the hook has mapper side effects in `select`, remove them. Return pure data.
  Document what the consumer must now do differently (e.g., derive selectedUser
  via useMemo in the container).
- If the hook has toast/navigation/storage side effects, remove them. Document which
  container callback should absorb each side effect.
- If the hook imports cross-domain query keys, remove those imports. Document which
  container onSuccess callback should handle the cross-domain invalidation.
- If the hook is a context-wrapping hook used in leaf components, do not rewrite the
  hook itself -- instead note that its call sites in leaves must move to containers.
  The hook may still exist for use in containers.
- If the hook duplicates a DOM pattern (click-outside, escape-key, resize, width
  measurement), consolidate into a shared hook in `shared/hooks/`.
- Move the hook to the correct directory if it is in the wrong place:
  - Data-fetching hooks go in `services/hooks/queries/` or `services/hooks/mutations/`
  - DOM/browser/state utility hooks go in `shared/hooks/`
  - **When moving a file, update every import across the codebase that references the
    old path.** Grep for the old module name, update each import, and list every file
    changed. Because this skill runs in a forked context, do not run it in parallel
    with other refactor skills that touch the same import graph.
- Do not change behavior. Consumers should get the same data and capabilities, just
  through cleaner, more explicit channels.

## Step 6: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored hook or its consumers, run them with
the project's test runner. Report the results in the summary.

After rewriting, output a short summary of what changed, what files were created or
modified, what consumers need to be updated (if any), and whether type-checking and
tests passed.
