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
- Manages localStorage reads/writes (if applicable). If a localStorage key
  stores URL-worthy state, use nuqs instead -- the URL replaces localStorage.
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

- Mock all service hooks and context hooks
- Test that the container renders without crashing
- Test that the container passes expected props to children
- Test that mutation callbacks trigger the right side effects
- `// TODO:` markers for integration-specific assertions

### 4c. Child components

If the page needs child components that do not exist, note them as follow-up work:
"Create these components with `build-react-component`: ..."

Do not generate placeholder child components. The container should be complete in
its hook-calling and prop-wiring, but it is acceptable to render a simple placeholder
`<div>` where a child component will eventually go, with a comment noting what
should replace it.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test files with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths), any
prerequisite service hooks or child components that need to be created separately,
and whether type-checking and tests passed.
