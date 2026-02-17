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

## Step 1: Build the dependency picture

Read the target file. Then read every file it imports -- hooks, contexts, utilities,
child components, type files. Build a mental map of what this component touches and
what touches it.

## Step 2: Audit against each principle

Check the component (and its immediate dependency tree) against every rule below.
For each violation found, note the file, the line, what is wrong, and what the fix is.

### 2a. Zero spooky action at a distance

Look for hidden communication channels:
- localStorage/sessionStorage keys read or written without a single owner module
- Context values consumed deep in the tree instead of passed as props
- Query key strings imported across domain boundaries
- Side effects (toasts, navigation, analytics) buried inside functions that look pure
- Import-time coupling (module-level side effects, register calls)

### 2b. Data Down, Actions Up (DDAU)

The component's Props interface should be its complete dependency list.
- Does the component call useContext, useRouter, or any service hook directly?
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

Flag every useEffect and classify it:
- Derived state sync (useEffect + setState where useMemo works) -- **wrong**
- Post-event work split across handler + effect -- **wrong**
- Mount-only initialization that could be useState lazy init -- **wrong**
- Post-mutation logic that could use TanStack Query onSuccess/onError -- **wrong**
- External system subscription (WebSocket, ResizeObserver, DOM listener) -- **ok**
- Unmount cleanup -- **ok**
- Browser API sync with no React binding (document.title, focus) -- **ok**

### 2f. Hooks and context boundaries

- Leaf components must call zero hooks that reach outside their own scope
- Only containers/pages call context hooks
- Custom hooks wrapping context are still context dependencies -- they belong in containers

**MAY-remain hooks (do NOT flag these in leaves):** `useBreakpoints`, `useWindowSize`,
`useDropdownScrollHandler`, `useClickAway`, `useScrollCallback`, `usePagination`,
`useSorting`, `useTheme`, `useTranslation`, and any `useXxxScope()` hook exported by
a scoped context (`XxxScopeProvider`). These are either cross-cutting DOM/browser
concerns with no provider coupling, ambient UI environment hooks, or narrow scoped
contexts that meet the escape-hatch criteria (stable, narrow, local, no orchestration).

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
  The container goes in a `containers/` sibling directory (create it if needed).
  The container calls hooks, wires props, handles events. The leaf becomes pure props.
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
- Update the Props/interface type to be the component's complete dependency list.
- When extracting or fixing a container, ensure cross-domain cache invalidation
  lives in the container, not in service hooks. Standalone hooks invalidate only
  their own domain's query keys. The container handles cross-domain invalidation
  in mutation onSuccess callbacks.
- Do not change behavior. The component should do exactly what it did before, just
  with explicit, visible, typed wiring instead of hidden channels.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored component, run them with the
project's test runner. Report the results in the summary.

After rewriting, output a short summary of what changed, what files were created or
modified, and whether type-checking and tests passed.
