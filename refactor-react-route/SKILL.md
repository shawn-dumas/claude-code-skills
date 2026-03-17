---
name: refactor-react-route
description: Refactor a React page/route file to establish a proper container boundary. Ensures one container per orchestration boundary that owns all hook calls, storage, toasts, and cross-domain invalidation.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/pages/somePage.tsx>
---

Refactor the React page or route file at `$ARGUMENTS`.

## Prerequisite

If you have not run `audit-react-feature` for this route's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

## Step 0: Run AST analysis tools

Run the inventory on the page file AND its children (2-3 levels deep):

```bash
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-react-inventory.ts $ARGUMENTS --pretty
# Also run on direct child components (from the imports output)
npx tsx scripts/AST/ast-jsx-analysis.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-storage-access.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-data-layer.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-ownership.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-hooks.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-effects.ts $ARGUMENTS --pretty
```

Use ownership assessments for Step 2b (hooks in leaves detection):

- `LEAF_VIOLATION` assessments identify components with affirmative leaf
  evidence AND disallowed hooks -- these need hook extraction to container
- `CONTAINER` assessments indicate existing containers that may be incomplete
- `DDAU_COMPONENT` assessments indicate compliant leaf components

Use hook assessments to classify each hook call in the route tree:

- `LIKELY_SERVICE_HOOK` / `LIKELY_CONTEXT_HOOK` in children are violations
- `LIKELY_AMBIENT_HOOK` may remain in children

Use effect assessments for Step 2f (effect bridges in children):

- `DERIVED_STATE` effects in child components indicate data that should
  flow from the container via props instead
- `TIMER_RACE` effects indicate cleanup issues to address

Use JSX observations for Step 2i (template complexity in children). Use
side effect observations (`TOAST_CALL`, `POSTHOG_CALL`) for Steps 2d/2e
(toast call sites and analytics events scattered through the component
tree). Use storage observations for Step 2c (storage boundary -- which
components access storage, raw vs typedStorage). Use data layer
observations (`QUERY_HOOK_DEFINITION`, `MUTATION_HOOK_DEFINITION`,
`FETCH_API_CALL`) for Steps 2a/2b/2h (service hook locations, query key
ownership, fetchApi endpoints across the route tree).

## Step 1: Build the dependency picture

Read the target file. Then read:

- Every component it renders (direct children and their children, 2-3 levels deep)
- Every hook call in those children (context hooks, service hooks, router hooks,
  auth hooks, feature flag hooks)
- The layout component if this page uses one (check for getLayout or layout wrappers)
- Any existing container file for this route

Map the full tree: which components fetch data, which call context hooks, which call
useRouter, which read storage, which fire toasts. This is the "before" picture.

## Step 2: Audit against each principle

### 2a. Container existence and completeness

Every orchestration boundary should have exactly one container that serves as the
boundary between the outside world (hooks, context, routing, storage) and the inside
world (props). Typically this is one per route, but non-route entry points (modals,
embedded panels, shared surfaces) get their own container too.

- Does a container exist for this route?
- If yes, does it absorb ALL hook calls, or do children still self-fetch?
- If no, where is the data-fetching and orchestration scattered?

### 2b. Hook absorption

Review hook assessments from `ast-interpret-hooks` for all components in the
route tree (excluding the container). Each hook with a problematic assessment
is a violation:

- **`LIKELY_SERVICE_HOOK`** in children -- container must call these hooks and
  pass data/callbacks as props
- **`LIKELY_CONTEXT_HOOK`** in children -- container reads context and passes
  values as props
- **`UNKNOWN_HOOK`** in children -- requires manual classification

Review ownership assessments from `ast-interpret-ownership`:

- **`LEAF_VIOLATION`** assessments identify components that have both leaf
  evidence (props, not named as container, not in containers/) AND disallowed
  hooks -- these need immediate hook extraction
- **`AMBIGUOUS`** assessments need manual review to determine if the component
  is a container or a leaf with violations

Hooks assessed as **`LIKELY_AMBIENT_HOOK`** or **`LIKELY_STATE_HOOK`** may
remain in leaf components. These are cross-cutting DOM/browser concerns,
ambient UI environment hooks, or narrow scoped contexts that meet the
escape-hatch criteria.

### 2c. Storage boundary

The container should be the sole reader/writer of storage for its route, using
`readStorage`/`writeStorage`/`removeStorage` from `@/shared/utils/typedStorage`.
Never use raw `localStorage`/`sessionStorage` calls. Check:

- Do any child components directly read or write storage?
- Does the container read stored defaults at mount and pass them as props?
- Does the container write back to storage on state changes?
- Is every read validated with a Zod schema via `readStorage`?

### 2d. Toast boundary

Toast calls (toastSuccess, toastError, toastWarning) belong in the container's
mutation onSuccess/onError callbacks, not in service hooks or child components.
Check:

- Do any service hooks called by this route fire toasts?
- Do any child components fire toasts directly?

### 2e. Cross-domain invalidation boundary

When a mutation in this route's domain must invalidate queries from another domain,
that invalidation happens in the container's onSuccess callback. Check:

- Do any service hooks import query keys from other domains?
- Does the container handle cross-domain invalidation explicitly?

### 2f. Effect bridges (post-extraction artifact)

Review effect assessments from `ast-interpret-effects` on children:

- **`DERIVED_STATE`** in child components indicate data that should flow
  from the container via props instead
- **`EVENT_HANDLER_DISGUISED`** indicate effects that should move to event
  handlers
- **`TIMER_RACE`** indicate cleanup issues to address

After context providers are replaced with prop-passing, child wrapper components
often retain useEffects that transform incoming props and write back to parent state
via a callback prop. This is the most common post-extraction artifact:

```tsx
// WRONG: child watches props and writes back to parent
useEffect(() => {
  const transformed = transformFilters(props.filters);
  props.setParentFilters('key', transformed);
}, [props.filters]);
```

For each child in the route's tree, check whether any useEffect:

- Reads a prop, transforms it, and calls a callback prop with the result
- Initializes parent state on mount via a callback prop

These writes should move to the container:

- Transform-on-change: move to the container's event handler where the triggering
  state change originates (e.g., `handleFilterUpdate`)
- Initialize-on-mount: move to the container's mount useEffect

After hoisting, the child wrapper typically becomes a thin passthrough (just renders
its child with the same props) or can be deleted entirely.

### 2g. Layout-level components

Check if any component in the route's tree is actually rendered at a layout level
(e.g., by a shared layout wrapper, not by the route itself). If so, that component's
DDAU conversion belongs at the layout boundary, not in this route's container. Do not
duplicate prop-wiring for layout-level components across route containers.

### 2h. Fetch depth

Check how deep data-fetching goes in the component tree:

- Fetching at the container level (1 level) -- **good**
- Children 2-3 levels deep calling their own query hooks -- **bad**
  This means the container is not absorbing all data needs.
- Manual `fetch()` calls inside useEffect with `useState` for loading/error/data -- **bad**
  These should be converted to useQuery. See `refactor-react-component` Step 4b for
  the mechanical conversion pattern.

### 2i. Template complexity in children

Scan the return statements of child components in the route's tree for logic that
should live above the return. The container refactor is an opportunity to push
derived values and rendering predicates into the container (or into named
intermediates in the child), so the child's return is flat markup.

Flag:

- Chained ternaries in JSX (multi-way branching belongs in lookup maps)
- Inline data transformation (.map/.filter/.reduce in the return)
- Multi-statement inline handlers (should be named functions)
- Return statements over 100 lines (decompose into sub-components)

These do not block the route refactor, but note them in the report so they are
addressed when `refactor-react-component` runs on each child.

## Step 3: Report

Output a clear report:

```
## Audit: <PageName>

### Container status
<exists | missing | incomplete>

### Hook call sites in children (should be 0)
| Component | Hook | Should become |
|-----------|------|---------------|
| ...       | ...  | prop: <name>  |

### Boundary violations
- Storage: <list of children that touch storage>
- Toasts: <list of hooks/children that fire toasts>
- Cross-domain: <list of hooks that import foreign query keys>

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

- **Create or complete the container.** If no container exists, create one. If one
  exists but is incomplete, add the missing hook calls.
  **Placement rule:** Never create containers (or any non-page file) under
  `src/pages/`. If the target page is under `src/pages/<feature>/`, create the
  container in `src/ui/page_blocks/<feature>/containers/` (or the equivalent
  `page_blocks` directory for the feature). The page file imports the container
  from there.
- **The container calls all service hooks** for this route's data needs. It passes
  query results as props. Children never call useQuery/useMutation.
- **The container absorbs all context hooks.** It destructures what it needs and
  passes individual values as props. Children never call useContext or context
  consumer hooks.
- **The container absorbs router and URL state hooks.** It reads route params and
  URL search params (via nuqs `useQueryState` / `useQueryStates`) and passes them
  as data props. It creates navigation callbacks and param-setter callbacks and
  passes them as callback props. Children never call useRouter, usePathname,
  useSearchParams, or useQueryState.
- **The container owns storage.** It reads stored defaults at mount (via
  `readStorage` with a Zod schema), passes them as props, and writes back on
  changes (via `writeStorage`/`removeStorage`). Children never touch storage.
- **The container owns toasts.** Mutation onSuccess/onError callbacks in the
  container decide user feedback. Service hooks return data/errors only.
- **The container owns cross-domain invalidation.** When a mutation succeeds and
  another domain's cache must be invalidated, the container calls
  queryClient.invalidateQueries with the foreign domain's keys. The service hook
  does not import foreign keys.
- **Update child components** to accept props instead of calling hooks. Define
  explicit Props interfaces. Each child's Props interface becomes its complete
  dependency list.
- Do not change behavior. The route should render the same UI with the same data,
  just with all orchestration in one visible place.

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
finishing. If existing tests cover the refactored route or its components, run them
with the project's test runner. Report the results in the summary.

### Step 5b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher to verify the refactor
preserved the route's behavioral signals. **This step is mandatory.**
Do not skip it. Do not report success without running it and including
the output in your summary. A low score blocks the refactor until
investigated and resolved.

**`refactorType: 'route'`**

1. Collect the file lists:

   - **beforeFiles**: the page file + any files that had hooks extracted
   - **afterFiles**: the page file + new container + modified child components

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
     --refactor-type route \
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
   confirms it was intentional, create a calibration fixture. Follow
   the **intent** template in `scripts/AST/docs/ast-feedback-loop.md`.
   Use `refactorType: "route"`.

   Note the fixture in the summary output: "Created calibration fixture:
   `feedback-<date>-<description>`. Run `/calibrate-ast-interpreter
   --tool intent` when 3+ pending fixtures accumulate."

## Step 6: Summary

Output a short summary of what changed, what files were created or
modified, and whether type-checking and tests passed.

### Files Changed

```
Before (read from HEAD):
- <file1>
- <file2>

After (written/modified):
- <file1> (modified)
- <file3> (created)
- <file4> (created)
```

### Intent preservation

```
Intent preservation: <score>/100
  Preserved: <N> | Intentionally removed: <N> | Dropped: <N> | Added: <N>
```

If any ACCIDENTALLY_DROPPED signals exist, list them with the `!!` marker
from the interpreter's pretty-print.
