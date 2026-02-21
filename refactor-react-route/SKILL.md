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

List every hook call site in the route's component tree (excluding the container).
Each one is a potential violation:

- **Context consumer hooks** in children (useInsightsContext, useTeams, useUsers,
  useBpoProjectContext, useAuthState, usePosthogContext, useFlyoutContext, etc.)
  -- these must move to the container. Children receive the values as props.
- **Router and URL state hooks** in children (useRouter, usePathname,
  useSearchParams, useQueryState, useQueryStates, router.query)
  -- navigation becomes callback props, route/URL params become data props.
  Children never read the URL directly; the container reads it and passes values.
- **Auth hooks** in children -- container passes userRoles, currentUser, canEdit
  as props.
- **Feature flag hooks** in children -- container passes boolean props.
- **Service hooks** in children (useQuery, useMutation calls)
  -- container calls the hooks, passes data and mutation callbacks as props.

**MAY-remain hooks (do NOT flag these in leaves):** useBreakpoints, useWindowSize,
useDropdownScrollHandler, useClickAway, useScrollCallback, usePagination,
useSorting, useTheme, useTranslation, and any `useXxxScope()` hook exported by a
scoped context (`XxxScopeProvider`). These are either cross-cutting DOM/browser
concerns, ambient UI environment hooks, or narrow scoped contexts that meet the
escape-hatch criteria (stable, narrow, local, no orchestration).

### 2c. Storage boundary

The container should be the sole reader/writer of localStorage/sessionStorage for
its route. Check:
- Do any child components directly read or write storage?
- Does the container read stored defaults at mount and pass them as props?
- Does the container write back to storage on state changes?

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
- **The container owns storage.** It reads stored defaults at mount, passes them as
  props, and writes back on changes. Children never touch localStorage/sessionStorage.
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

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored route or its components, run them
with the project's test runner. Report the results in the summary.

After rewriting, output a short summary of what changed, what files were created or
modified, and whether type-checking and tests passed.
