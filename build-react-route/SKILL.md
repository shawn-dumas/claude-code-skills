---
name: build-react-route
description: Generate a new route page file with a DDAU container. Creates the thin Next.js page (default export), a container that owns all hooks, and wires them together.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <pages/path/page-name> <description>
---

Generate a new Next.js page with a DDAU container. `$ARGUMENTS`

The first token is the page path relative to `src/pages/` (e.g.,
`insights/workload-analysis`). Everything after the first whitespace is the
description of what the page does.

## Step 1: Parse the argument

Extract the page file path (relative to `src/pages/`). Derive:

- **PageName** in PascalCase from the filename (e.g., `workload-analysis` becomes
  `WorkloadAnalysis`)
- **ContainerName**: `PageNameContainer` (e.g., `WorkloadAnalysisContainer`)
- **Feature area**: the first path segment (e.g., `insights`)

## Step 2: Survey the codebase

- Read 1-2 existing page files in `src/pages/` to match conventions:
  - The `getLayout` pattern (how layouts are applied)
  - The default export convention (function declaration vs arrow)
  - Which layout component is used for similar pages
- Read the layout component used by pages in the same feature area (e.g.,
  `EightFlowDashboardLayout`) to understand what it provides
- Check if a `containers/` directory exists in the corresponding `page_blocks/`
  area. If not, it will be created.
- Read the `page_blocks/` structure for this feature area to understand how
  page-level components are organized

## Step 3: Design the container

Determine the container's responsibilities based on the description:

- **Service hooks** the container should call. If they do not exist yet, list them
  as prerequisites: "Create these service hooks first with `build-react-service-hook`:
  ..." Do not generate the container referencing hooks that do not exist.
- **Context values** the container needs (from existing providers)
- **Router params** the container reads (useRouter for navigation callbacks)
- **URL state params** the container owns via nuqs (`useQueryState` /
  `useQueryStates`). Any state that affects what the user sees on reload belongs
  here: filters, sort, tab selection, date range, pagination, selected team/user.
  The container reads URL params and passes values + setter callbacks as props.
  Children never call `useQueryState`, `useSearchParams`, or read `router.query`.
- **State** the container manages (loading orchestration, form state, selections
  that are NOT URL-worthy)
- **Callbacks** the container provides to children (mutation triggers, navigation,
  URL param setters, toast feedback)
- **Storage** the container reads/writes (localStorage/sessionStorage). Note: if a
  localStorage key stores URL-worthy state, prefer nuqs over localStorage -- the
  URL replaces localStorage as the persistence mechanism for that value.
- **Cross-domain invalidation** the container handles in mutation onSuccess

The container is the single orchestration boundary. All hooks, context, routing,
storage, toasts, and cross-domain invalidation live here. Children receive
everything via props.

## Step 4: Generate the files

### 4a. `src/pages/<path>.tsx` -- The page file

This file is thin. Its only job is to mount the container and configure the layout.

```ts
import { type ReactNode } from 'react';
import { LayoutComponent } from '@/components/...';
import { PageNameContainer } from '@/page_blocks/<feature>/containers/PageNameContainer';

export default function PageName() {
  return <PageNameContainer />;
}

PageName.getLayout = (page: ReactNode) => (
  <LayoutComponent>{page}</LayoutComponent>
);
```

This is the ONLY file that uses a default export (Next.js Pages Router requirement).

### 4b. Container directory

Create `src/ui/page_blocks/<feature>/containers/<ContainerName>/` if it does not
exist.

**`<ContainerName>.tsx`**:

- Named export
- Calls all service hooks for this route's data needs
- Calls context hooks and destructures needed values
- Reads router params and creates navigation callbacks
- Reads URL state via nuqs `useQueryState` / `useQueryStates` for any
  URL-worthy state (filters, sort, tab, date range, pagination, selected
  team/user). Passes values as data props and setters as callback props.
- Manages storage reads/writes via `readStorage`/`writeStorage`/`removeStorage`
  from `@/shared/utils/typedStorage` (if applicable). Never use raw
  `localStorage`/`sessionStorage`. If a key stores URL-worthy state, use nuqs
  instead -- the URL replaces storage as the persistence mechanism.
- Defines mutation onSuccess/onError callbacks with:
  - Toast feedback (toastSuccess, toastError)
  - Same-domain cache invalidation
  - Cross-domain cache invalidation (if needed)
- Passes all data down as props to child components
- Passes all callbacks down as callback props (including URL param setters)
- Does NOT render complex UI itself (that belongs in child components)
- **Template discipline:** The container's return is flat and short. All derived
  values, rendering predicates, and formatted data are named variables above the
  return. No chained ternaries, no inline transforms, no multi-statement handlers.

**`index.ts`**:

```ts
export { ContainerName } from './ContainerName';
```

**`<ContainerName>.spec.tsx`**:

The generated test must score 10/10 on `/audit-react-test`. Follow the
contract-first testing principles below.

**Strategy:** Integration test. Containers call service hooks, context hooks,
and router, so they need `QueryClientProvider` and `fetchMock` (P4).

**Imports:**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ContainerName } from './ContainerName';
```

**Test infrastructure:**

```tsx
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function setup() {
  const queryClient = createTestQueryClient();
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ContainerName />
    </QueryClientProvider>,
  );
  return { ...result, queryClient, user };
}
```

**Test data (P5 + P6):**

- Use fixture builders from `src/fixtures/domains/` for API response data.
  Check `src/fixtures/domains/` for builders before writing inline data.
- `fetchMock` is globally available (vitest-fetch-mock). Use
  `fetchMock.mockResponseOnce(JSON.stringify(fixtureData))` for API responses.
- No `as any`. Use `satisfies` for typed mock data.

**Test cases — cover the container's orchestration:**

- Renders child components with correct data after fetch completes (use
  `waitFor` + `screen.getByText`/`screen.getByRole` to verify).
- Handles fetch error state (mock fetch rejection, verify error UI).
- User interactions trigger mutations (verify via `fetchMock` call assertions).
- Navigation callbacks fire correctly (via mocked `next/router`).
- URL state changes propagate to children (if using nuqs).

**Cleanup (P10):**

```tsx
beforeEach(() => {
  fetchMock.resetMocks();
});
```

The global `vitest.setup.ts` handles `afterEach(() => vi.clearAllMocks())`.
Add file-level cleanup ONLY for:
- `vi.useFakeTimers()` → `afterEach(() => vi.useRealTimers())`
- `localStorage` → `afterEach(() => localStorage.clear())`
- `sessionStorage` → `afterEach(() => sessionStorage.clear())`

**Assertions (P8):** Use `getByRole`, `getByText`, `toBeVisible`,
`toBeInTheDocument`. Never assert on CSS classes or DOM structure.

**Mocking (P2):** Mock only at external boundaries — `fetchMock` for network,
`next/router` for navigation (already globally mocked). Do NOT mock own child
components, own hooks, or own utilities. Let real presentational children
render (P3).

**Do NOT generate:**
- `// TODO:` markers. Write real, passing tests.
- Snapshot tests.
- Tests asserting on internal state, hook call counts, or effect order.

### 4c. Child components

If the page needs child components that do not exist, note them as follow-up work:
"Create these components with `build-react-component`: ..."

Do not generate placeholder child components. The container should be complete in
its hook-calling and prop-wiring, but it is acceptable to render a simple placeholder
`<div>` where a child component will eventually go, with a comment noting what
should replace it.

## Type touchpoints

Before defining any new type or interface inline, check first:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. For new shared types, add them to the appropriate domain module in
   `src/shared/types/`, not inline in the container or page file.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test files with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths), any
prerequisite service hooks or child components that need to be created separately,
and whether type-checking and tests passed.
