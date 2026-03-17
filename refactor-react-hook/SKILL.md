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

## Step 0: Run AST analysis tools

```bash
npx tsx scripts/AST/ast-react-inventory.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-data-layer.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-effects.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-hooks.ts $ARGUMENTS --pretty
```

Use hook assessments from `ast-interpret-hooks` to classify the hook
(Step 2):

- `LIKELY_SERVICE_HOOK` -- redirect to `refactor-react-service-hook`
- `LIKELY_CONTEXT_HOOK` -- context-wrapping hook, inline into containers
- `LIKELY_AMBIENT_HOOK` -- DOM/browser utility hook, belongs in `shared/hooks/`
- `LIKELY_STATE_HOOK` -- state utility hook, belongs in `shared/hooks/`
- `UNKNOWN_HOOK` -- requires manual classification

Use effect assessments from `ast-interpret-effects` for Step 3g:

- `DERIVED_STATE` -- hook is syncing state that should be derived
- `TIMER_RACE` -- potential cleanup issues
- `DOM_EFFECT` -- expected in DOM/browser utility hooks
- `EXTERNAL_SUBSCRIPTION` -- expected in subscription-based hooks

Use import observations for consumer list and cross-domain imports
(Step 3d). Use side effect observations for Step 3a (detecting toast,
navigate, storage writes, and analytics calls). Use data layer
observations for Steps 3b-3d (factory indirection, mapper side effects,
cross-domain query key imports).

## Step 1: Build the dependency picture

Read the target file. Then read every file it imports -- other hooks, API utilities,
query key constants, type files, context providers. Also find all consumers of this
hook (use `npx tsx scripts/AST/ast-imports.ts --consumers $ARGUMENTS --pretty`). Build a map of what this hook depends on
and what depends on it.

## Step 2: Classify the hook

Review the hook assessment from `ast-interpret-hooks`:

- **`LIKELY_SERVICE_HOOK`** -- calls useQuery/useMutation, talks to an API.
  **Stop here and use `refactor-react-service-hook` instead -- it has more
  targeted rules for factory indirection, mapper side effects, cross-domain
  keys, and return surface.**
- **`LIKELY_CONTEXT_HOOK`** -- internally calls useContext or another context
  consumer. This is a hidden dependency -- it makes its consumers implicitly
  dependent on a provider tree. Should be inlined into containers, not used
  in leaves.
- **`LIKELY_AMBIENT_HOOK`** -- DOM/browser utility hook or state utility hook.
  Should live in `shared/hooks/`.
- **`LIKELY_STATE_HOOK`** -- React builtin wrapped with additional logic.
  If it adds meaningful abstraction, should live in `shared/hooks/`.
- **`UNKNOWN_HOOK`** -- requires manual classification. Determine if it is:
  - **DOM/browser utility hook**: interacts with DOM APIs (ResizeObserver,
    click-outside, scroll, keyboard events)
  - **State utility hook**: manages local state patterns (debounce, pagination,
    toggle)
  - **Composite hook**: does multiple things (fetches data AND shows toasts AND
    navigates) -- should be split

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

### 3g. useEffect assessment

Review effect assessments from `ast-interpret-effects`:

- **`DERIVED_STATE`** -- hook is syncing state that should be derived via
  useMemo or returned directly from a query
- **`EVENT_HANDLER_DISGUISED`** -- effect triggered by callback, should be
  inline logic
- **`TIMER_RACE`** -- potential cleanup issues, verify cleanup functions
  clear all timers
- **`DOM_EFFECT`** -- expected in DOM/browser utility hooks
- **`EXTERNAL_SUBSCRIPTION`** -- expected in subscription-based hooks
- **`NECESSARY`** -- no issues detected

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

## Step 6: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored hook or its consumers, run them with
the project's test runner. Report the results in the summary.

### Step 6b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher to verify the refactor
preserved the hook's behavioral signals. **This step is mandatory.**
Do not skip it. Do not report success without running it and including
the output in your summary. A low score blocks the refactor until
investigated and resolved.

**`refactorType: 'hook'`**

1. Collect the file lists:

   - **beforeFiles**: the original hook file as it existed before the refactor
   - **afterFiles**: the hook file (if modified in place) + any new files
     created during the refactor

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
     --refactor-type hook \
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

## Step 7: Summary

Output a short summary of what changed, what files were created or
modified, what consumers need to be updated (if any), and whether
type-checking and tests passed.

### Files Changed

```
Before (read from HEAD):
- <file1>

After (written/modified):
- <file1> (modified)
- <file2> (created)
```

### Intent preservation

```
Intent preservation: <score>/100
  Preserved: <N> | Intentionally removed: <N> | Dropped: <N> | Added: <N>
```

If any ACCIDENTALLY_DROPPED signals exist, list them with the `!!` marker
from the interpreter's pretty-print.
