---
name: build-react-component
description: Generate a new DDAU React component that receives all data via props and fires actions via callbacks. Creates the component file, barrel export, types file (if needed), and test skeleton.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <ParentDir/ComponentName> <description>
---

Generate a new DDAU React component. `$ARGUMENTS`

The first token is the component path (e.g., `dashboard/MetricsCard` or just
`MetricsCard`). Everything after the first whitespace is the description of what
the component renders.

## Step 1: Parse the argument

Extract the `ComponentName` (the last path segment) and the `ParentDir` (everything
before the last `/`, if present). If no parent directory is given, default to
`src/ui/components/8flow/`.

## Step 2: Survey the codebase

Read 2-3 existing components near the target location to match conventions:

- Glob `<ParentDir>/*/index.ts` to find nearby component directories
- Read one component file, its `index.ts` barrel, and its `.spec.tsx` file
- Note the import alias style (`@/components/`, `@/shared/`), prop typing style
  (inline destructuring vs named interface), named export convention, and test
  setup pattern
- Check if the codebase uses HeadlessUI components that the new component might need

Match whatever conventions you find. The goal is that the new component looks like
it was written by the same person who wrote the surrounding code.

## Step 3: Design the Props interface

Based on the description, design the component's complete dependency list as props:

- Every piece of data the component displays is a prop
- Every action the component can trigger is a callback prop (`onXxx`)
- Loading and error states are props if the component displays them
- The component calls NO hooks except MAY-remain ambient hooks: `useBreakpoints`,
  `useWindowSize`, `useDropdownScrollHandler`, `useClickAway`, `useScrollCallback`,
  `usePagination`, `useSorting`, `useTheme`, `useTranslation`, and any
  `useXxxScope()` hook from a scoped context
- No `useContext`, no `useRouter`, no `useSearchParams`, no `useQueryState`,
  no `router.query`, no service hooks, no browser storage access

If the description implies data that must be fetched, the component receives the
fetched data as a prop. The container is responsible for fetching. If the container
does not exist yet, note it: "This component expects a container to provide these
props via service hooks."

If the component displays a "selected item" from a filterable list, expect the
container to pass an `effectiveSelectedX` prop (the validated/derived version) rather
than the raw selection state. The component should never need to check whether a
selected item still exists in a list -- that is the container's job via the
`effectiveX` useMemo pattern (see `refactor-react-component` Step 4b).

If the component needs to detect client-side rendering for hydration-sensitive code
(e.g., browser-only APIs, window measurements), use `useState(() => typeof window !== 'undefined')`
as a lazy initializer instead of `useState(false)` + `useEffect(() => setMounted(true), [])`.
The lazy initializer avoids an extra render cycle.

## Step 4: Generate the files

Create the directory `<ParentDir>/<ComponentName>/` if it does not exist.

### 4a. `<ComponentName>.tsx`

- Named export: `export const ComponentName = ({ ... }: Props) => { ... }`
- Props typed inline or as a local interface (match surrounding code style)
- Tailwind CSS for styling
- HeadlessUI for interactive widgets if applicable
- `data-testid` attributes on key elements for testing
- `void` prefix on async event handlers (ESLint `no-floating-promises`)
- No default export
- No useContext, useRouter, useQuery, useMutation, or browser storage access

**Template discipline (JSX least-power):**

The return statement is a flat declaration of layout. All logic lives above it.

- Compute all derived values, rendering predicates, and formatted data as named
  variables between the hooks and the return. Name each variable to document the
  decision it encodes (`showEmptyState`, `formattedRows`, `iconColor`).
- No chained ternaries in JSX. Use lookup maps (`Record<Discriminant, Value>`)
  for multi-way values. Use named booleans for rendering predicates.
- No `.filter()`, `.map()`, `.reduce()` inside the return. Use `useMemo` or
  named variables above it.
- No multi-statement inline handlers. Define named functions above the return.
- No IIFEs in JSX. Extract to named variables.
- If the return statement exceeds 50 lines, decompose into sub-components or
  extract named JSX fragments as variables.

### 4b. `index.ts`

```ts
export { ComponentName } from './ComponentName';
```

If a `types.ts` file is created, also re-export its types.

### 4c. `types.ts` (only if needed)

Create only if the component's types are complex enough to warrant a separate file
(e.g., deeply nested data structures, types shared with sibling components). For
simple prop interfaces, keep types inline in the component file.

### 4d. `<ComponentName>.spec.tsx`

The generated test must score 10/10 on `/audit-react-test`. Follow the
contract-first testing principles below — they align with the full
`build-react-test` skill.

**Strategy:** Unit test. DDAU components receive all data via props, so
render with props only — no `QueryClientProvider`, no providers, no
`MockedProviders` wrapper (P4).

**Imports:**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Import fixture builders when they exist for the prop types
import { buildTeam } from '@/fixtures';
import { ComponentName } from './ComponentName';
```

**Test data (P5 + P6):**

- Define `defaultProps` typed as `React.ComponentProps<typeof ComponentName>`
  at file scope. Each test file owns its own data.
- Use fixture builders from `src/fixtures/domains/` when they exist for a
  prop's type. Check before writing inline mock data:
  `Grep for "export function build" in src/fixtures/domains/`
- All callback props use `vi.fn()`.
- No `as any`. If testing with intentionally invalid data, use
  `as unknown as WrongType` with a comment.

**Setup helper:**

```tsx
function setup(overrides?: Partial<React.ComponentProps<typeof ComponentName>>) {
  const props = { ...defaultProps, ...overrides };
  const user = userEvent.setup();
  const result = render(<ComponentName {...props} />);
  return { ...result, props, user };
}
```

**Test cases — cover the full public API surface:**

For each **data prop**: at least one test verifying the prop's value appears
in rendered output via `screen.getByRole()` (preferred), `screen.getByText()`,
or `screen.getByTestId()` (P1, P8).

For each **callback prop**: at least one test triggering the callback via
`userEvent` interaction and asserting `toHaveBeenCalledWith(expectedArgs)` (P1).

For each **boolean/state prop**: tests for both states (e.g., `isLoading: true`
vs `false`, `isDisabled: true` vs `false`).

For **optional props**: test the default behavior when omitted.

For **edge cases**: empty arrays, null/undefined optional values, loading
states, error states, empty states.

**Assertions (P8 — User Outcomes):**
- Use `toBeVisible()`, `toBeInTheDocument()`, `toHaveTextContent()`,
  `toBeDisabled()`, `toHaveAttribute()`.
- Never assert on CSS class names, DOM structure depth, or snapshot trees.

**Cleanup (P10):**
- The global `vitest.setup.ts` already provides
  `afterEach(() => vi.clearAllMocks())`. Do NOT add redundant cleanup.
- Add file-level cleanup ONLY for resources the global setup does not cover:
  - `vi.useFakeTimers()` → add `afterEach(() => vi.useRealTimers())`
  - `localStorage` → add `afterEach(() => localStorage.clear())`
  - `sessionStorage` → add `afterEach(() => sessionStorage.clear())`

**Determinism (P9):**
- If the component displays dates/times: add `vi.useFakeTimers()` in
  `beforeEach` and `vi.useRealTimers()` in `afterEach`.
- Never rely on `Math.random()` or `new Date()` in assertions.

**Mocking (P2):**
- Do NOT mock own hooks, own child components, or own utility functions.
- Mock only external boundaries if needed (fetch, storage, nav, firebase).
- For DDAU components this is rarely needed — data arrives via props.

**Do NOT generate:**
- `// TODO:` markers. Write real, passing tests.
- Snapshot tests.
- Tests asserting on internal state, hook call counts, or effect order.

## Type touchpoints

Before defining any new type or interface inline, check first:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. For new shared types, add them to the appropriate domain module in
   `src/shared/types/`, not inline in the component file.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test file with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths) and
whether type-checking and tests passed.
