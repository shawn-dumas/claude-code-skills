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

- Import `describe`, `it`, `expect`, `vi` from vitest (globals are enabled)
- Import `render`, `screen` from `@testing-library/react`
- Import `userEvent` from `@testing-library/user-event`
- Create a `defaultProps` object with realistic mock data
- Create a `setup(overrides?)` function that renders with merged props
- Include tests:
  - Renders without crashing
  - Renders key data from props (verify specific text/elements appear)
  - Fires callback props on user interaction
  - `// TODO:` markers for behavior-specific assertions the developer should add

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test file with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths) and
whether type-checking and tests passed.
