---
name: refactor-react-component
description: Refactor a React component to follow DDAU, least-power, and clean-separation principles. Audits the component against architectural rules, reports violations, then rewrites.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/Component.tsx>
---

Refactor the React component at `$ARGUMENTS`.

## Prerequisite

If you have not run `audit-react-feature` for this component's feature domain yet,
consider doing so first. The audit produces a dependency graph and migration checklist
that prevents duplicate work and surfaces cross-file issues this skill cannot see in
isolation.

## Step 0: Run AST analysis tools

```bash
npx tsx scripts/AST/ast-authz-audit.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-react-inventory.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-jsx-analysis.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-ownership.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-hooks.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-effects.ts $ARGUMENTS --pretty
```

Use ownership assessments to classify the component first:

- `CONTAINER` -- component owns data orchestration, do not extract hooks
- `DDAU_COMPONENT` -- pure data-down-actions-up, no refactoring needed
- `LAYOUT_SHELL` -- documented layout exception
- `LEAF_VIOLATION` -- has props but calls service/context hooks that
  should move to a container
- `AMBIGUOUS` -- mixed signals, requires manual classification

Use hook assessments for Step 2 (what each hook call is):

- `LIKELY_SERVICE_HOOK` -- data-fetching, belongs in container
- `LIKELY_CONTEXT_HOOK` -- context consumer, belongs in container
- `LIKELY_AMBIENT_HOOK` -- ambient UI hook, may remain in leaf
- `LIKELY_STATE_HOOK` -- React builtin, fine anywhere
- `UNKNOWN_HOOK` -- needs manual classification

Use effect assessments for Step 2e (what each useEffect is doing):

- `DERIVED_STATE` -- anti-pattern, replace with useMemo/useQuery
- `EVENT_HANDLER_DISGUISED` -- move to event handler
- `TIMER_RACE` -- potential race condition, add cleanup
- `DOM_EFFECT` -- legitimate DOM interaction
- `EXTERNAL_SUBSCRIPTION` -- legitimate subscription
- `NECESSARY` -- no issues detected

Use JSX observations (`JSX_TERNARY_CHAIN`, `JSX_GUARD_CHAIN`,
`JSX_TRANSFORM_CHAIN`, `JSX_IIFE`, `JSX_INLINE_HANDLER`,
`JSX_INLINE_STYLE`, `JSX_COMPLEX_CLASSNAME`, `JSX_RETURN_BLOCK`) for
Step 2c-ii (template complexity).

Use side effect observations (`CONSOLE_CALL`, `TOAST_CALL`, `TIMER_CALL`,
`POSTHOG_CALL`, `WINDOW_MUTATION`) for Step 2a (hidden side effects in
functions that look pure, toast calls in wrong layers) and Step 2e
(timer patterns).

Use import observations for Step 1 (dependency picture, consumer count,
cross-domain imports) and Step 4 (updating imports after file splits).

## Step 1: Build the dependency picture

Read the target file. Then read every file it imports -- hooks, contexts, utilities,
child components, type files. Build a mental map of what this component touches and
what touches it.

## Step 2: Audit against each principle

Check the component (and its immediate dependency tree) against every rule below.
For each violation found, note the file, the line, what is wrong, and what the fix is.

### 2a. Zero spooky action at a distance

Look for hidden communication channels:

- Storage keys read or written without a single owner module, or accessed via
  raw `localStorage`/`sessionStorage` instead of `typedStorage` helpers
- Context values consumed deep in the tree instead of passed as props
- Query key strings imported across domain boundaries
- Side effects (toasts, navigation, analytics) buried inside functions that look pure
- Import-time coupling (module-level side effects, register calls)

### 2b. Data Down, Actions Up (DDAU)

The component's Props interface should be its complete dependency list.

- Does the component call useContext, useRouter, useSearchParams, useQueryState,
  or any service hook directly?
- Does it read URL params (router.query, useQueryState) instead of receiving them
  as props? URL params are a state store -- same rule as context and localStorage.
- Does it reach into global state instead of receiving data as props?
- Does it fire side effects instead of calling a callback prop?
- After refactor, could you render this component with just props and no provider tree?

### 2c. Least power

- Values computed from props/state stored in separate state (should be inline or useMemo)
- useEffect used where useMemo or an event handler would suffice
- Setters passed to components that only need the value
- Hooks returning capabilities the consumer does not use (e.g., a hook that returns
  data + toast function when the consumer only reads data)
- Contexts bundling many fields when consumers only read a few

### 2c-ii. Template least-power (JSX discipline)

The return statement should be a flat declaration of layout. All decision-making
and data transformation lives above the return in named intermediate variables.

Flag these in the return statement:

- **Chained ternaries** (`a ? X : b ? Y : Z`) -- should be a lookup map or
  sub-component
- **Complex guards** (3+ conditions in an `&&` chain) -- should be a named
  boolean above the return
- **Inline data transformation** (`.filter()`, `.map()`, `.reduce()` inside the
  return) -- should be `useMemo` or a named variable above the return
- **IIFEs** (`{(() => { ... })()}`) -- should be a named variable or sub-component
- **Multi-statement inline handlers** (`onClick={() => { a; b; c; }}`) -- should
  be a named function above the return
- **Multi-way ternaries for the same discriminant** (type, mode, status) -- should
  be a `Record` lookup map above the return
- **Return statement > 100 lines** -- decompose into sub-components or extract
  named intermediate JSX fragments

### 2d. Separation of concerns

Check layer violations:

- **Service hooks** should only fetch/mutate. No toasts, no navigation, no localStorage.
- **Containers** wire service hooks to components, handle events, manage feedback.
  One container per orchestration boundary (typically per route, but also per
  non-route entry point like a modal or embedded panel).
- **Components** render from props. No service hooks, no context hooks, no useRouter,
  no browser storage.
- **Providers** hold shared UI state only. No data-fetching logic.

### 2e. useEffect discipline

Run `ast-interpret-effects` on the component file:

```bash
npx tsx scripts/AST/ast-interpret-effects.ts $ARGUMENTS --pretty
```

For each assessment:

- `DERIVED_STATE` -> eliminate the effect and replace with the appropriate derived
  value pattern (useQuery, useMemo, or inline computation)
- `EVENT_HANDLER_DISGUISED` -> move the logic to the relevant event handler prop
- `TIMER_RACE` (no cleanup) -> add cleanup or restructure
- `DOM_EFFECT` -> leave in place, verify cleanup
- `NECESSARY` / `EXTERNAL_SUBSCRIPTION` -> leave in place

### 2f. Hooks and context boundaries

Review hook assessments from `ast-interpret-hooks`:

- Hooks assessed as `LIKELY_SERVICE_HOOK` or `LIKELY_CONTEXT_HOOK` in leaf
  components are violations -- they belong in containers
- Hooks assessed as `LIKELY_AMBIENT_HOOK` or `LIKELY_STATE_HOOK` may remain
  in leaf components
- Hooks assessed as `UNKNOWN_HOOK` require manual classification

For ownership assessment:

- If `ast-interpret-ownership` returns `LEAF_VIOLATION`, the component has
  affirmative leaf evidence AND disallowed hooks -- container extraction needed
- If it returns `CONTAINER`, the component already owns orchestration
- If it returns `DDAU_COMPONENT`, no hook violations exist
- If it returns `AMBIGUOUS`, apply manual classification rules

### 2g. State ownership

- Derived state stored separately instead of computed
- URL-worthy state not in the URL
- Form state mirrored into useState instead of owned by the form library
- Server state copied from query results into useState or context
- Multiple writers to the same localStorage key

## Step 3: Report

Output a clear report with this structure:

```
## Audit: <ComponentName>

### Violations found

1. **[Principle name]** <file>:<line>
   What: <description>
   Why it matters: <consequence>
   Fix: <what to do>

2. ...

### No issues
- [List principles with no violations]
```

## Step 4: Rewrite

Apply all fixes. Follow these rules:

- If the component is a leaf that calls context/service hooks, extract a container.
  The container calls hooks, wires props, handles events. The leaf becomes pure props.
  **Placement rule:** Never create containers (or any non-page file) under
  `src/pages/`. If the component being refactored is under `src/pages/<feature>/`,
  place the container in `src/ui/page_blocks/<feature>/containers/` instead of a
  sibling `containers/` directory. For components already under `src/ui/`, a sibling
  `containers/` directory is fine.
- If the file contains both a container function and a content/leaf function
  (e.g., `Foo` wrapping `FooContent`), split them into separate files:
  - Move the container to `containers/<FooContainer>.tsx` (create the directory
    if needed). Rename to `FooContainer` to match the project naming convention.
  - Keep the leaf in the original file and add `export` to it.
  - Update all imports of the old container export to the new path.
  - The container imports the leaf from the original file via relative path.
  - Clean up imports in the original file: remove any imports that were only
    used by the container (service hooks, routing, context, etc.).
- Before extracting a container, check where the component is actually rendered.
  If it is rendered once at a layout level (not per-route), the DDAU boundary is
  the layout, not each route container. Extract or convert a layout-level container
  instead of duplicating prop-wiring across every route that visually contains it.
- If the component is already a container, refactor it in place. Fix violations
  (e.g., passing unnecessary capabilities to children, missing cross-domain
  invalidation ownership, toasts inside hooks instead of in onSuccess callbacks)
  without extracting a new container.
- Replace useEffect-based derived state with useMemo or inline computation.
- Replace useEffect-based post-event logic with event handler logic.
- Replace mount-only useEffect with useState lazy init.
- Remove unnecessary capabilities (setters, toast functions) from props/hooks that
  do not need them.
- When prefixing unused destructured props with `_`, use the alias syntax:
  - Wrong: `{ _unusedProp }` -- TypeScript error, the type defines `unusedProp`
  - Right: `{ unusedProp: _unusedProp }` -- alias preserves the property name
  - With default: `{ unusedProp: _unusedProp = false }` -- alias + default
- When a rewrite introduces an `eslint-disable` comment, always include an
  explanation after `--` that says why the rule does not apply. A bare
  `// eslint-disable-next-line rule-name` is a debug artifact. A commented one
  (`// eslint-disable-next-line rule-name -- reason`) is a deliberate decision.
- Update the Props/interface type to be the component's complete dependency list.
- When extracting or fixing a container, ensure cross-domain cache invalidation
  lives in the container, not in service hooks. Standalone hooks invalidate only
  their own domain's query keys. The container handles cross-domain invalidation
  in mutation onSuccess callbacks.
- **Flatten the return statement.** Lift all logic out of the JSX:
  - Replace chained ternaries with lookup maps or named variables above the return.
  - Replace multi-condition `&&` guards with named booleans (`const showTable = ...`).
  - Move `.filter()`, `.map()`, `.reduce()` chains into `useMemo` or named variables.
  - Replace IIFEs with named variables or sub-components.
  - Replace multi-statement inline handlers with named functions.
  - Extract repeated rendering patterns into shared presentational components.
  - Name every intermediate variable to document the decision it encodes (e.g.,
    `showTable`, `formattedRows`, `iconColor`, `activeRows`).
- Do not change behavior. The component should do exactly what it did before, just
  with explicit, visible, typed wiring instead of hidden channels.

### TanStack Table Components

If the component imports from `@tanstack/react-table`, enforce:

1. **`createColumnHelper` at module scope.** Never inside the component
   body. Column helper is a type utility -- creating it per render wastes
   cycles and causes column definitions to be recreated.

2. **Column definitions are stable.** Define columns as a module-level
   constant or inside `useMemo` with stable dependencies. Never define
   columns inline in the component body without memoization.

3. **`getCoreRowModel` (and other row models) are called once** and
   passed to `useReactTable`. Never recreate them per render.

4. **`columnHelper.accessor` callbacks are pure.** No side effects,
   no hooks, no state access inside accessor functions.

## Step 4b: Common refactoring patterns

Apply these proven patterns when rewriting. Each addresses a specific useEffect
anti-pattern encountered repeatedly in real codebases.

### The `effectiveX` useMemo pattern

**When:** A useEffect watches a filtered list and calls `setSelectedX(null)` when the
selected item no longer exists in the list.

**Before (wrong):**

```tsx
useEffect(() => {
  if (!selectedUser) return;
  const exists = filteredUsers.some(u => u.email === selectedUser);
  if (!exists) {
    setSelectedUser(null);
    setIsUserCollapsed(false);
  }
}, [filteredUsers, selectedUser]);
```

**After (correct):**

```tsx
const effectiveSelectedUser = useMemo(() => {
  if (!selectedUser) return null;
  return filteredUsers.some(u => u.email === selectedUser) ? selectedUser : null;
}, [selectedUser, filteredUsers]);
```

Then replace every downstream READ of `selectedUser` with `effectiveSelectedUser`.
Keep the raw `selectedUser` + `setSelectedUser` for state ownership and persistence
callbacks. The raw value is what gets persisted; the effective value is what renders.

Wire ALL downstream consumers to the effective value:

- Other useMemo hooks that depend on the selection
- useQuery `enabled` flags
- Event handler comparisons (e.g., `effectiveSelectedUser === userEmail`)
- JSX rendering and highlight logic
- Props passed to children

Watch for ghost state: paired booleans (`isCollapsed`) that are NOT reset when the
effective value becomes null. Ensure every JSX path that reads the boolean also guards
on the effective value (e.g., `isUserCollapsed && effectiveSelectedUser`).

### Effect bridge hoisting

**When:** After extracting a context provider into prop-passing, a child component
retains a useEffect that transforms props and writes back to the parent via a
callback. This is the most common post-extraction artifact.

**Before (wrong):**

```tsx
// In child wrapper component
useEffect(() => {
  const transformed = transformFilters(props.filters);
  props.setParentFilters('key', transformed);
}, [props.filters]);
```

**After (correct):**

```tsx
// In container -- at the event boundary where filters are submitted
const handleFilterUpdate = newFilters => {
  setFilters(newFilters);
  setParentFilters('key', transformFilters(newFilters)); // hoisted here
};

// In mount effect -- for session restore
useEffect(() => {
  const stored = loadFromStorage();
  if (stored) {
    setParentFilters('key', transformFilters(stored));
  }
}, []);
```

The child wrapper becomes a thin passthrough or gets deleted entirely.

### Manual fetch to TanStack Query conversion

**When:** A useEffect calls `fetch()` with manual `useState` for loading/error/data
and a `let isCancelled = false` cleanup pattern.

**Before (wrong):**

```tsx
const [data, setData] = useState([]);
const [isLoading, setIsLoading] = useState(false);

useEffect(() => {
  let isCancelled = false;
  const load = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/items?company=${company}`);
      const json = await res.json();
      if (!isCancelled) setData(json.items);
    } finally {
      if (!isCancelled) setIsLoading(false);
    }
  };
  void load();
  return () => {
    isCancelled = true;
  };
}, [company]);
```

**After (correct):**

```tsx
const { data = [], isLoading } = useQuery({
  queryKey: ['items', company],
  queryFn: async () => {
    const res = await fetch(`/api/items?company=${company}`);
    const json = await res.json();
    return json.items;
  },
  enabled: Boolean(company),
});
```

TanStack Query handles cancellation (via AbortSignal), caching, retry, and
loading/error states automatically. If mock and real data paths exist, both go
inside `queryFn` with a conditional branch.

### react-hook-form: `form.watch()` subscription

**When:** A useEffect uses react-hook-form's `useWatch` or `values` to detect field
changes and call `form.setValue` in response (e.g., resetting dependent fields when
a parent field changes).

**Before (suboptimal):**

```tsx
const values = useWatch({ control: form.control });

useEffect(() => {
  if (values.analyzeBy === 'teams') {
    form.setValue('workstreams', '');
  }
}, [values.analyzeBy, form]);
```

**After (preferred):**

```tsx
useEffect(() => {
  const subscription = form.watch((value, { name }) => {
    if (name !== 'analyzeBy') return;
    if (value.analyzeBy === 'teams') {
      form.setValue('workstreams', '');
    }
  });
  return () => subscription.unsubscribe();
}, [form]);
```

The `form.watch()` subscription is event-driven (fires only when a field changes),
not poll-driven (fires on every render cycle). The `name` parameter lets you filter
to the specific field that changed. Always return the unsubscribe cleanup.

Note: `useWatch` is the officially documented react-hook-form API and is acceptable
when the component intentionally needs to re-render on every value change (e.g., to
display a live preview). The subscription pattern is preferred when the goal is to
respond to a specific field change without re-rendering on every keystroke.

### Next.js hydration guard: lazy useState

**When:** A component has `useState(false)` + `useEffect(() => setIsMounted(true), [])`
to detect client-side rendering for hydration-sensitive code.

**Before (wrong):**

```tsx
const [isMounted, setIsMounted] = useState(false);
useEffect(() => {
  setIsMounted(true);
}, []);
```

**After (correct):**

```tsx
const [isMounted] = useState(() => typeof window !== 'undefined');
```

The lazy initializer runs once during state initialization. On the server,
`typeof window` is `'undefined'` so it returns `false`. On the client, it returns
`true`. No useEffect, no extra render cycle.

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
finishing. If existing tests cover the refactored component, run them with the
project's test runner. Report the results in the summary.

### Step 5b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher to verify the refactor
preserved the component's behavioral signals. **This step is mandatory.**
Do not skip it. Do not report success without running it and including
the output in your summary. A low score blocks the refactor until
investigated and resolved.

**`refactorType: 'component'`**

1. Collect the file lists:

   - **beforeFiles**: the original component file(s) as they existed before
     the refactor (the files read in Step 1)
   - **afterFiles**: all files created or modified in Step 4 (the component
     file, any new container file, any extracted sub-component files)

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
     --refactor-type component \
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
   confirms it was intentional, run:
   `/create-feedback-fixture --tool intent --file <before-file> --files <after-files> --expected INTENTIONALLY_REMOVED --actual ACCIDENTALLY_DROPPED`.

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
