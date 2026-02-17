---
name: build-react-provider
description: Generate a new scoped context provider (XxxScopeProvider) that holds narrow, stable UI state. Validates against escape-hatch criteria before generating. No data-fetching, no toasts, no navigation.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <XxxScope> <description>
---

Generate a new scoped context provider. `$ARGUMENTS`

The first token is the scope name (e.g., `FilterScope`, `SelectionScope`).
Everything after the first whitespace is the description of what shared state
the provider holds.

## Step 1: Parse the argument

Extract the scope name. Derive:

- **ProviderName**: `XxxScopeProvider` (e.g., `FilterScopeProvider`)
- **HookName**: `useXxxScope` (e.g., `useFilterScope`)
- **ContextName**: `XxxScopeContext` (e.g., `FilterScopeContext`)
- **TypeName**: `XxxScopeValue` (e.g., `FilterScopeValue`)

## Step 2: Validate against escape-hatch criteria

Before generating anything, check whether this state belongs in the URL, then
check the five escape-hatch criteria. Stop and redirect if any check fails:

0. **Not URL-worthy**: If the description mentions filters, sort order, tab
   selection, date range, pagination, selected team, selected user, or any state
   that affects what the user sees on reload, stop: "This state is URL-worthy.
   The container should own it via nuqs `useQueryState`, not a provider. The URL
   is the state store for page-level selections."

1. **Stable**: The value changes rarely during a session. If the description
   implies per-keystroke, per-frame, or high-churn updates, stop: "This value
   changes too frequently for a scoped context. Consider lifting state to the
   container and passing via props, or use a state management library."

2. **Narrow**: One or two primitives, or a small object with a few fields. If the
   description implies a large object (user profile, full form state, query
   results), stop: "This is too broad for a scoped context. Pass individual values
   as props from the container."

3. **Deep pass-through cost**: Would require threading through 3+ components that
   do not use the value. If the description does not mention depth or intermediary
   components, ask: "How deep does this value need to travel? If fewer than 3
   pass-through levels, props are simpler."

4. **Local scope**: The provider wraps a feature subtree, not the whole app. If the
   description implies app-wide state, stop: "App-wide state belongs in an existing
   app-level provider or should use the ambient UI hook pattern instead."

5. **No orchestration**: The context holds data, not behaviors with side effects.
   If the description mentions data-fetching, toasts, navigation, storage, or
   mutations, stop and redirect to the appropriate skill:
   - Data-fetching: "Use `build-react-service-hook` for data needs."
   - Toasts/navigation/storage: "These belong in the container, not a provider."

## Step 3: Survey the codebase

- Read 1-2 existing context/provider files to match conventions: createContext
  pattern, null default, hook with guard, provider component shape.
- Grep for similar scope names or purposes to check for duplicates. If a provider
  with overlapping purpose exists, stop and report: "A provider with similar
  purpose already exists at `<path>`. Consider extending it instead."
- Identify the feature directory where this provider should be colocated.

## Step 4: Design the context value interface

Based on the description, design `XxxScopeValue`:

- Maximum 10 fields. Fewer is better.
- Each field is specifically typed (no `any`, no broad union types).
- Data fields are read-only values. Actions are callback functions only if they
  are stable and purely local (e.g., `setSelectedId`).
- The interface must NOT include:
  - Query results (UseQueryResult, data/isLoading/error bundles)
  - Mutation functions (UseMutationResult, mutate/mutateAsync)
  - Router objects (NextRouter, AppRouterInstance)
  - Toast functions
  - Storage read/write functions
  - Auth state objects

The provider receives its value as props from the container. It does not compute
or fetch its own value. This keeps the provider DDAU-compliant at its own level.

## Step 5: Generate the files

Colocate with the feature. Create the directory at
`src/ui/page_blocks/<feature>/contexts/<XxxScope>/` or alongside the feature's
existing context files if a different pattern is established.

### 5a. `XxxScopeContext.tsx`

```tsx
import { createContext, useContext, type ReactNode } from 'react';

export type XxxScopeValue = {
  // ... fields from Step 4
};

const XxxScopeContext = createContext<XxxScopeValue | null>(null);

export function useXxxScope(): XxxScopeValue {
  const value = useContext(XxxScopeContext);
  if (value === null) {
    throw new Error('useXxxScope must be used within XxxScopeProvider');
  }
  return value;
}

type XxxScopeProviderProps = XxxScopeValue & {
  children: ReactNode;
};

export function XxxScopeProvider({ children, ...value }: XxxScopeProviderProps) {
  return (
    <XxxScopeContext.Provider value={value}>
      {children}
    </XxxScopeContext.Provider>
  );
}
```

Key details:
- Context default is `null`, not a mock object
- Hook throws if used outside provider (fail-fast)
- Provider receives value fields as props (DDAU -- the container passes them in)
- Named exports only

### 5b. `index.ts`

```ts
export { XxxScopeProvider, useXxxScope } from './XxxScopeContext';
export type { XxxScopeValue } from './XxxScopeContext';
```

### 5c. `types.ts` (only if needed)

Create only if the value interface has nested types complex enough to warrant
extraction. For simple interfaces (2-5 flat fields), keep types in the context file.

### 5d. `XxxScopeContext.spec.tsx`

- Import `renderHook`, `render`, `screen` from `@testing-library/react`
- Import `describe`, `it`, `expect` from vitest (globals are enabled)
- Tests:
  - `useXxxScope` throws when used outside provider
  - Children can read provided value
  - Value updates propagate to consumers
  - `// TODO:` markers for feature-specific assertions

```tsx
describe('XxxScopeContext', () => {
  it('throws when useXxxScope is called outside provider', () => {
    // Suppress console.error for expected throw
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useXxxScope())).toThrow(
      'useXxxScope must be used within XxxScopeProvider',
    );
    spy.mockRestore();
  });

  it('provides value to children', () => {
    // render a consumer inside the provider and assert it reads the value
  });
});
```

## Step 6: Verify

Run `npx tsc --noEmit` scoped to the new files (or the whole project if scoping is
not practical). If TypeScript errors appear, fix them before finishing. Run the new
test file with `pnpm vitest run <path>`. Report the results in the summary.

After generating, output a short summary of what was created (file paths) and
whether type-checking and tests passed.
