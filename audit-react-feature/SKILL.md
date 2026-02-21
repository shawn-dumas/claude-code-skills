---
name: audit-react-feature
description: Audit an entire React feature area. Maps dependencies, counts violations across all files, classifies every hook call and useEffect, and produces a prioritized migration checklist.
context: fork
allowed-tools: Read, Grep, Glob
argument-hint: <path/to/feature/directory>
---

Audit the React feature area at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a complete migration report.

## Step 1: Inventory all files

Glob for all .ts/.tsx files in the target directory and its subdirectories. For each
file, record:
- File path
- What it exports (components, hooks, types, utilities)
- What it imports (other local files, libraries, context hooks, service hooks)

## Step 2: Map the dependency graph

For each file, trace its imports to build a directed dependency graph. Identify:
- Which files import context consumer hooks (and which hooks)
- Which files import service hooks or call useQuery/useMutation directly
- Which files import from other feature domains (cross-domain coupling)
- Which files call useRouter/usePathname
- Which files read/write localStorage/sessionStorage
- Which files call toast functions
- Circular dependencies between files

## Step 3: Classify every component

For each component in the feature, classify it:

| Classification | Criteria |
|----------------|----------|
| **DDAU** | Receives all data via props, fires all actions via callbacks. No context hooks, no service hooks, no router hooks, no storage access. |
| **Self-contained** | Fetches its own data, calls context hooks, or reaches into global state. |
| **Container** | Orchestrates data-fetching and hook calls for a route or section. |
| **Inner container** | Sits below the route container. Owns section-level data orchestration (conditional fetching based on drill-down state or user selection). Receives context/navigation from the outer container as props. Calls service hooks for data that depends on local selection state. Has its own container above it. |
| **Provider** | Holds shared state via React context. |
| **Infrastructure** | Layout, auth guard, error boundary, or similar app-level concern. |

## Step 3b: Dead code detection

Before classifying violations, check whether each file/component/hook has any
consumers. For each export:
- Grep for its name across the codebase (outside its own file)
- Check barrel exports (index.ts) to see if it is re-exported
- Check if the barrel itself is imported anywhere

If zero consumers exist, classify as **DEAD_CODE** instead of auditing for
violations. Dead code should be deleted, not refactored. This saves significant
effort -- a surprising fraction of "violations" turn out to be unreachable code.

**Orphaned test files.** For each `.spec.ts` / `.spec.tsx` / `.test.ts` /
`.test.tsx` file in the feature, check whether the source file it imports still
exists. If the source was deleted (by this refactor or a prior one), the test
file is orphaned and should be deleted. Orphaned tests cause false test failures
and mask the true test count.

**Co-located container/leaf detection.** Check whether any single file exports
both a container component (calls multiple service hooks, passes data down to a
child) and a leaf/content component (receives everything via props). If a file
contains both roles, flag it as a candidate for file splitting: the container
should move to `containers/` and the leaf should be exported from the original
file. Common pattern: `Foo` (container) wrapping `FooContent` (leaf) in the
same file.

## Step 3c: Debug artifact detection

Scan for development leftovers that should be cleaned up:
- `console.log` / `console.debug` / `console.info` statements (not `console.error`
  or `console.warn`, which may be intentional)
- Commented-out code blocks longer than 3 lines
- `// TODO` or `// HACK` or `// FIXME` markers
- Disabled ESLint rules (`eslint-disable`) without an explanatory comment

Record these in the report under a "Debug artifacts" section.

## Step 3d: Type audit

For each file in the feature:

- Flag any `type` or `interface` declaration that duplicates a definition in
  `src/types/`. List the duplicate and the canonical source.
- Flag any bare `string` or `number` field that should be a branded type (IDs,
  timestamps, durations, emails, URLs, percentages). List the field, file, and
  which branded type it should use.
- Flag any `enum` that should be an `as const` object.
- Flag any inline object type annotation in a function signature that appears
  in 2+ files (candidate for extraction to `src/types/`).
- Flag any `QueryOptions` interface defined locally instead of imported from
  `src/types/api.ts`.
- Flag any explicit `any` type (`: any`, `as any`, `Record<string, any>`). Count
  occurrences per file.
- Flag any non-null assertion (`!`) that is not immediately preceded by a Map
  `has()` check or equivalent guard.
- Flag any `as unknown as X` double cast in production code (test files are lower
  priority).
- Flag any type guard function that is unsound (claims `value is T` but only
  checks a subset of `T`'s required properties).
- Flag any trust boundary (`JSON.parse`, `fetch` response, localStorage read,
  Supabase query) that uses `as T` without runtime validation.
- Flag any `catch (error: any)` that should be `catch (error: unknown)`.
- Flag any `@ts-expect-error` without an explanatory comment.

Record these in the report under a "Type violations" section.

## Step 4: Classify every useEffect

For each useEffect in the feature, classify it:

| Code | Meaning | Action |
|------|---------|--------|
| DERIVED_STATE | Value computable from props/state/query data | Replace with useMemo |
| SYNC_PROPS | Effect mirrors prop into local state | Controlled component or useMemo |
| SYNC_CONTEXT | Copies context/query data into local state | Derive at point of use |
| EVENT_HANDLER_DISGUISED | Reacts to state change from user action | Move to event handler |
| MAPPER_SIDE_EFFECT | setState inside TanStack Query select | Read from .data directly |
| DOM_EFFECT | DOM interaction (resize, click-outside, etc.) | Extract to shared hook |
| ANIMATION | Visual animation | Keep or extract |
| EFFECT_BRIDGE | Child useEffect watches props, writes back to parent state via callback | Hoist write to container event handler or mount effect |
| TIMER_RACE | setTimeout/setInterval inside useEffect with state updates | Move to event handler or replace with CSS transition; verify cleanup |
| NECESSARY | Legitimately necessary | Keep |

## Step 4b: Detect ghost state

Ghost state is a boolean (like `isCollapsed`, `isDetailCollapsed`, `isUserCollapsed`)
that is paired with a selection state (like `selectedUser`, `selectedDetail`). When a
useEffect nulls the selection (e.g., because the selected item was filtered out), the
boolean may remain `true`, creating a hidden inconsistency.

For each boolean state variable:
- Identify whether it is paired with a selection (set together, cleared together)
- Check whether the selection can be nulled independently (by a useEffect or by the
  `effectiveX` useMemo pattern)
- If yes, check whether every JSX path that reads the boolean also guards on the
  selection being non-null (e.g., `isUserCollapsed && effectiveSelectedUser`)
- If any JSX path reads the boolean WITHOUT guarding on the selection, flag it as
  **GHOST_STATE** -- the UI will show collapsed/expanded state for a selection that
  no longer exists

Ghost state is invisible when JSX guards are correct, but becomes a latent bug if
someone later removes the guard. Flag it in the report even when currently guarded.

## Step 4c: Detect timer race conditions

Scan for `setTimeout` and `setInterval` inside useEffect callbacks (or inside
functions called by useEffect callbacks). These are code smells because:

- **setState after timeout**: The component may have unmounted or the triggering
  condition may have changed before the timer fires. Even with cleanup, the
  pattern is fragile and hard to reason about.
- **Missing cleanup**: A setTimeout/setInterval without a corresponding
  `clearTimeout`/`clearInterval` in the useEffect cleanup function is a leak.
- **Deferred state sync**: Using setTimeout to "wait for React to settle" before
  reading or writing state is almost always papering over a missing dependency
  or a wrong data flow. The timer duration is arbitrary and environment-dependent.

For each timer found:
- Check whether the cleanup function clears it
- Check whether the callback calls setState
- Check whether the same logic could be an event handler, a CSS transition,
  or a requestAnimationFrame (for layout reads)

Classify as **TIMER_RACE** in the useEffect inventory. Flag in the report even
if cleanup is present -- the pattern itself is worth reviewing.

Note: `requestAnimationFrame` inside useEffect for one-time layout measurement
is a recognized pattern and less risky than setTimeout, but still flag it if it
calls setState -- the same unmount race applies.

## Step 4d: Audit JSX template complexity

For each component's return statement, scan for logic that should live above the
return in named intermediate variables. The return should be a flat declaration of
layout, not a program that computes what to render.

**Chained ternaries:** Flag any ternary chain (`a ? X : b ? Y : Z`) in JSX.
Single binary ternaries and simple `&&` guards are fine. Chained ternaries are
switch statements -- they should be lookup maps or sub-components.

**Multi-condition guards:** Flag `&&` chains with 3+ conditions in JSX
(e.g., `{a && b && c && <Component />}`). Extract to a named boolean above the
return.

**Inline data transformation:** Flag `.filter()`, `.map()`, `.reduce()`, and
chained combinations of these inside the return statement. These belong in
`useMemo` or named variables above the return.

**IIFEs in JSX:** Flag `{(() => { ... })()}` inside a return. Extract to a named
variable or sub-component.

**Multi-statement inline handlers:** Flag `onClick={() => { stmt1; stmt2; ... }}`
with 2+ statements. These should be named functions above the return.

**Repeated rendering patterns:** Flag identical or near-identical JSX patterns
appearing 3+ times across files in the feature. Examples:
- Percentage-width bars (`style={{ width: \`${pct}%\` }}`)
- Loading/empty/error cascading ternaries
- KPI display with nested loading ternary
- Multi-way type/mode/status switches using the same discriminant

For each repeated pattern, note: the pattern, the files where it appears, and
what shared component would replace it.

**Return statement length:** If a component's return statement exceeds 100 lines,
flag it. This is a strong signal that decision logic is embedded in markup.

Record these in the report under a "Template complexity" section.

Classify each finding:

| Code | Meaning | Action |
|------|---------|--------|
| CHAINED_TERNARY | Multi-way branch in JSX | Lookup map or sub-component |
| COMPLEX_GUARD | 3+ conditions in `&&` chain | Named boolean above return |
| INLINE_TRANSFORM | Data transformation in return | useMemo or named variable |
| IIFE_IN_JSX | Immediately-invoked function in return | Named variable or sub-component |
| MULTI_STMT_HANDLER | 2+ statements in inline handler | Named function above return |
| REPEATED_PATTERN | Same JSX pattern in 3+ files | Shared presentational component |
| LONG_RETURN | Return statement > 100 lines | Decompose into sub-components |

## Step 5: Classify every hook call in leaves

For each context hook, router hook, auth hook, or feature flag hook called in a
non-container component, record:
- The component and line number
- The hook being called
- Which fields/values are destructured from it
- Which container should absorb this call
- What props the component should receive instead

**MAY-remain hooks (do NOT flag):** useBreakpoints, useWindowSize,
useDropdownScrollHandler, useClickAway, useScrollCallback, usePagination,
useSorting, useTheme, useTranslation, and any `useXxxScope()` hook exported by a
scoped context (`XxxScopeProvider`). These are either cross-cutting DOM/browser
concerns, ambient UI environment hooks, or narrow scoped contexts that meet the
escape-hatch criteria (stable, narrow, local, no orchestration).

## Step 6: Check storage, toast, cross-domain coupling, and URL state

### URL state
- List every component that reads URL params (useRouter/router.query,
  useSearchParams, useQueryState, useQueryStates)
- Flag any leaf component (non-container) that reads URL params directly --
  this is a state-store access violation, same as calling useContext
- List every piece of state currently in context or localStorage that is
  URL-worthy (affects what the user sees on reload: filters, sort, tab,
  date range, pagination, selected team/user)
- For each URL-worthy field: where does it currently live, and which container
  should own the `useQueryState` call after refactor?

### Storage
- List every localStorage/sessionStorage key accessed in this feature
- For each key: who reads it, who writes it, is there a single owner?
- Flag any key with multiple independent writers
- Flag any leaf component that directly accesses storage
- Flag any localStorage key that stores URL-worthy state (should move to URL
  params instead of localStorage after refactor)

### Toasts
- List every toast call site in this feature
- Flag any toast call inside a service hook or utility function
- Note which container onSuccess/onError callback should own each toast

### Cross-domain query keys
- List every import of query keys from outside this feature's domain
- For each: what mutation triggers it, and which container should own it instead

## Step 7: Identify the DDAU boundary

Determine where containers should exist:
- One container per orchestration boundary (typically per route, but also per
  non-route entry point like a modal or embedded panel)
- Check if any component is rendered at a layout level (its container is the layout,
  not a route container)
- Check for deeply nested data-fetching (components 2-3 levels deep calling hooks)

## Step 8: Produce the migration report

Output a structured report:

```
## Feature Audit: <FeatureName>

### File inventory
| File | Type | Classification |
|------|------|----------------|
| ...  | ...  | DDAU / Self-contained / Container / Provider |

### Scorecard
| Classification | Count | % |
|----------------|-------|---|
| DDAU           | ...   |   |
| Self-contained | ...   |   |
| Container      | ...   |   |
| Provider       | ...   |   |

### useEffect inventory
| File:Line | Classification | Action |
|-----------|----------------|--------|
| ...       | DERIVED_STATE  | useMemo |

### useEffect summary
| Outcome | Count |
|---------|-------|
| Eliminate (effectiveX useMemo) | ... |
| Eliminate (event handler) | ... |
| Eliminate (effect bridge -> container) | ... |
| Eliminate (manual fetch -> TanStack Query) | ... |
| Eliminate (lazy useState init) | ... |
| Review (timer race condition) | ... |
| Extract to shared hook | ... |
| Keep | ... |

### Dead code
| File | Export | Reason |
|------|--------|--------|
| ...  | ...    | zero consumers / not exported from barrel |

### Ghost state
| File | Boolean state | Paired selection | Guarded in JSX? |
|------|--------------|-----------------|----------------|
| ...  | isCollapsed  | selectedUser    | yes / NO       |

### Timer race conditions
| File:Line | Timer type | Calls setState? | Has cleanup? | Suggested fix |
|-----------|-----------|-----------------|-------------|---------------|
| ...       | setTimeout | yes / no        | yes / no    | event handler / CSS transition / remove |

### Debug artifacts
| File:Line | Type | Content |
|-----------|------|---------|
| ...       | console.log | ... |
| ...       | commented-out block | ... |

### Type violations
| File:Line | Violation | Canonical type | Action |
|-----------|-----------|---------------|--------|
| ...       | bare string for userId | UserId from brand.ts | Replace with branded type |
| ...       | duplicate ErrorResponse | ErrorResponse from api.ts | Import from src/types/api |
| ...       | enum ClassificationCategories | as const object | Convert |
| ...       | explicit any (16x) | typed interface | Define DailyMetric interface |
| ...       | non-null assertion without guard | optional chaining | Replace with ?. |
| ...       | unsound type guard isUser | Zod schema or full check | Validate all required keys |
| ...       | JSON.parse as T without validation | Zod safeParse | Add runtime validation |
| ...       | catch (error: any) | catch (error: unknown) | Narrow with instanceof |

### Type violations summary
| Category | Count |
|----------|-------|
| Duplicate type definitions | ... |
| Bare primitives (should be branded) | ... |
| Enums (should be as const) | ... |
| Explicit any | ... |
| Non-null assertions without guard | ... |
| Unsound type guards | ... |
| Trust boundaries without validation | ... |
| catch (error: any) | ... |
| Double casts (as unknown as X) | ... |
| @ts-expect-error without comment | ... |

### Template complexity
| File:Line | Classification | Description | Action |
|-----------|----------------|-------------|--------|
| ...       | CHAINED_TERNARY | 3-way switch on opportunityType | Lookup map |
| ...       | INLINE_TRANSFORM | .filter().map() chain in return | useMemo above return |
| ...       | LONG_RETURN | ~970 lines | Decompose into sub-components |

### Template complexity summary
| Classification | Count |
|----------------|-------|
| Chained ternary | ... |
| Complex guard (3+ conditions) | ... |
| Inline data transformation | ... |
| IIFE in JSX | ... |
| Multi-statement inline handler | ... |
| Long return (> 100 lines) | ... |

### Repeated rendering patterns (candidates for shared components)
| Pattern | Files | Suggested component |
|---------|-------|-------------------|
| Percentage-width bar | SystemsTab, ActivitiesTable, ... | `<ProgressBar>` |
| Loading/empty/error cascade | NodeDetailsPanel, RelaySystemAggregate, ... | `<AsyncContent>` |
| ... | ... | ... |

### Hook calls in leaves (must be absorbed by containers)
| Component | Hook | Fields used | Target container | Becomes props |
|-----------|------|-------------|-----------------|---------------|
| ...       | ...  | ...         | ...             | ...           |

### Storage access
| Key | Readers | Writers | Risk | Owner after refactor |
|-----|---------|---------|------|---------------------|
| ... | ...     | ...     | ...  | ...                 |

### Toast call sites
| File:Line | Function | Should move to |
|-----------|----------|---------------|
| ...       | ...      | ...           |

### Cross-domain coupling
| File | Imports keys from | Reason | Should move to |
|------|-------------------|--------|---------------|
| ...  | ...               | ...    | ...           |

### Dependency graph issues
- Circular dependencies: <list or "none">
- Deepest fetch depth: <N levels>

### Migration checklist (in order)

1. [ ] Extract standalone hooks for <domain> (Phase 0)
       Files: <list>
2. [ ] Create <ContainerName> container (Phase 1)
       Absorbs: <list of hook calls>
3. [ ] Convert <ComponentName> to DDAU (Phase 2)
       Remove: <hooks>
       Add props: <list>
4. [ ] ...

### Estimated scope
- Components to convert: <N>
- useEffects to eliminate: <N>
- Hook call sites to absorb: <N>
- Providers to simplify/delete: <N>
```
