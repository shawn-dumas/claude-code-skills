---
name: build-react-hook
description: Generate a new React custom hook (DOM utility or state utility). Not for data-fetching -- redirect to build-react-service-hook for useQuery/useMutation hooks.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <useHookName> <description>
---

Generate a new React custom hook. `$ARGUMENTS`

The first token is the hook name (e.g., `useDebounce`). Everything after the first
whitespace is the description of what the hook does.

## Step 1: Parse the argument

Extract the hook name. Validate that it starts with `use`. If the description
suggests data-fetching (fetch, get, list, query, mutate, create, update, delete,
post, put, patch), stop and redirect: "This sounds like a service hook. Use
`build-react-service-hook` instead."

Classify the hook:

- **DOM/browser utility** if it interacts with window, document, ResizeObserver,
  IntersectionObserver, matchMedia, event listeners, scroll position, focus
  management, clipboard, or similar browser APIs.
- **State utility** if it encapsulates a reusable state pattern (debounce, toggle,
  previous value, undo/redo, form field, etc.) with no browser API dependency.

## Step 2: Survey the codebase

- Read `src/shared/hooks/index.ts` (or the barrel file for shared hooks) to
  understand what hooks already exist and the export pattern.
- Read 1-2 existing hooks in `src/shared/hooks/` to match conventions: named
  export style, TypeScript generics usage, JSDoc comments, test patterns.
- Grep for the hook name and for key terms from the description to check for
  duplicates. If a similar hook already exists, stop and report: "A hook with
  similar functionality already exists at `<path>`. Consider using or extending
  it instead."

## Step 3: Design the hook interface

Based on the description, design the hook's parameters and return value:

- **Parameters**: typed explicitly. Use generics if the hook is reusable across
  different value types.
- **Return value**: the minimum surface consumers need. Prefer returning a tuple
  `[value, setter]` for simple state hooks, or a named object for hooks with
  multiple return values.
- The hook must NOT:
  - Call useQuery or useMutation
  - Call context consumer hooks (useInsightsContext, useTeams, etc.)
  - Call useRouter or navigate
  - Read/write localStorage/sessionStorage (unless the hook's explicit purpose is
    storage abstraction, in which case document that the container is the intended
    consumer)
  - Fire toasts
  - Import query keys

## Step 4: Generate the files

Create `src/shared/hooks/<useHookName>/` if it does not exist.

### 4a. `<useHookName>.ts`

- Named export
- Typed parameters and return value explicitly
- For DOM hooks: proper cleanup in useEffect return (removeEventListener,
  disconnect observer, etc.)
- For state hooks: no useEffect unless it falls into the "keep" categories
  (external subscription, unmount cleanup)
- JSDoc comment describing purpose, parameters, and return value
- No default export

### 4b. `index.ts`

```ts
export { useHookName } from './useHookName';
```

### 4c. `<useHookName>.spec.ts`

- Import `renderHook`, `act`, `waitFor` from `@testing-library/react`
- Import `describe`, `it`, `expect`, `vi` from vitest (globals are enabled)
- For DOM hooks:
  - Mock the relevant browser API (window.matchMedia, ResizeObserver, etc.)
  - Test that the hook subscribes on mount and cleans up on unmount
  - Test that the hook updates when the browser API fires
- For state hooks:
  - Test initial state
  - Test state transitions via returned setters/actions
  - Test edge cases (rapid updates, same-value sets)
- `// TODO:` markers for behavior-specific assertions

### 4d. Update barrel export

Add the new hook's export to `src/shared/hooks/index.ts`:

```ts
export { useHookName } from './<useHookName>';
```

If the barrel file uses a different pattern, match it.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test file with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths) and
whether type-checking and tests passed.
