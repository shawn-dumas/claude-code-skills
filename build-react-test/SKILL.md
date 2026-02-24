---
name: build-react-test
description: Generate a contract-first test file for a component, container, hook, or utility. Reads the production API surface, selects the correct test strategy (unit/integration), wires fixture data, and produces a spec that scores 10/10 on audit-react-test.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/production-file.tsx> [unit|integration]
---

Generate a test file for the production module at `$ARGUMENTS`.

The first token is the path to the production file. An optional second token
forces the test strategy (`unit` or `integration`). If omitted, the skill
infers the strategy from the file's classification (see Step 2).

## Step 0: Pre-flight — delete-or-build decision

Before generating, check whether a spec file already exists for this
production file. Look for `<basename>.spec.ts`, `<basename>.spec.tsx`,
`<basename>.test.ts`, `<basename>.test.tsx` in the same directory and in a
sibling `__tests__/` or `tests/` directory.

If a spec file exists, run the delete threshold check:

| Condition | Decision |
|-----------|----------|
| Production file was deleted or moved | Delete the spec (orphaned) |
| Spec scores ≤ 4/10 on the 10 principles (quick estimate) | Delete and rebuild from scratch |
| Spec mocks ≥ 3 own hooks or components (`vi.mock` of non-boundary targets) | Delete and rebuild |
| Spec references ≥ 2 deleted providers/hooks (stale mocks) | Delete and rebuild |
| Production file changed from self-contained to DDAU (now receives all data via props, but spec still wraps in providers and mocks hooks) | Delete and rebuild |
| Spec is a copy-paste of another spec (describe block names a different component) | Delete and rebuild |

If the threshold is met: delete the old spec, report what was deleted and
why, then continue to generate fresh. If the existing spec is close to
compliant (scores 7+/10), report that and suggest using a future
`refactor-react-test` skill instead of rebuilding.

## Step 1: Read the production file

Read the target file completely. Record:

- **Exports**: Every named export (components, hooks, functions, types, constants)
- **For components**: The Props interface — every prop name, type, whether optional,
  whether a callback (`onXxx`). Check both inline props and separately-defined
  interfaces/types.
- **For hooks**: The argument signature and return type. If the return type is not
  explicit, trace it from the implementation.
- **For utilities**: The function signatures (arguments and return types).
- **Dependencies**: What does this file import? Classify each:
  - Own project imports (components, hooks, utils)
  - External library imports (react, tanstack, etc.)
  - Boundary imports (fetchApi, firebase, storage, router)

## Step 2: Classify and select strategy

| Classification | Criteria | Strategy |
|----------------|----------|----------|
| **DDAU component** | Receives all data via props, no service hooks, no context hooks, no router | **Unit test** |
| **Container** | Calls service hooks, context hooks, useRouter, or wires data to children | **Integration test** |
| **Service hook** | Calls useQuery/useMutation via useFetchApi | **Hook unit test** (mock fetchApi) |
| **Utility hook** | DOM/state hook, no data fetching | **Hook unit test** (mock browser APIs if needed) |
| **Pure function/utility** | No React, no side effects | **Function unit test** |
| **Provider** | Creates React context, holds state | **Integration test** |

If the user forced a strategy via the second argument, use that instead.

## Step 3: Survey surrounding conventions

Read 1-2 existing spec files near the target to match:

- Import style (relative vs alias paths)
- `describe`/`it` vs `describe`/`test` (this codebase uses `it`)
- Whether tests use `setup()` helper functions
- Whether tests use `screen` directly or destructure from `render`
- Assertion style (`toBeVisible` vs `toBeInTheDocument`)

Match whatever conventions you find.

Also check the global test setup:
- `vitest.setup.ts` provides global `afterEach(() => vi.clearAllMocks())`
  and `afterAll(() => { fetchMocker.disableMocks(); vi.useRealTimers(); })`
- `fetchMock` is globally available (from `vitest-fetch-mock`)
- `posthog-mock.ts` and `nextRouterMocks.ts` are pre-loaded
- Vitest globals are auto-imported (`describe`, `it`, `expect`, `vi`, etc.)
- jsdom environment is configured globally

## Step 4: Design the test plan

For each export in the production file, design test cases that cover the
public API surface.

### For DDAU components

The public API is: **props in → rendered output + callback invocations out**.

For each prop:
- **Data props**: At least one test verifying the prop's value appears in
  rendered output (via `getByText`, `getByRole`, or `getByTestId`)
- **Callback props**: At least one test triggering the callback via user
  interaction and asserting `toHaveBeenCalledWith(expectedArgs)`
- **Boolean/state props**: Tests for both states (`isLoading: true` vs `false`,
  `isDisabled: true` vs `false`)
- **Optional props**: Test the default behavior when omitted
- **Edge cases**: Empty arrays, null/undefined values, loading states, error
  states, empty states

### For containers

The public API is: **route/URL in → rendered children + side effects out**.

- Mount with MSW handlers providing fixture data
- Verify child components render with correct data
- Trigger user interactions and verify:
  - Mutation calls fire (via MSW request assertions or fetchMock)
  - Navigation occurs (via mocked router)
  - Toasts appear (if the project has toast testing utilities)
  - Query invalidation happens (via QueryClient spy)

### For service hooks

The public API is: **arguments in → query result out**.

- Verify the hook calls fetchApi with correct URL and parameters
- Verify the hook returns the expected shape
- Test `enabled: false` behavior if applicable
- Test `select` transformation if applicable
- Test error handling

### For utility hooks

The public API is: **arguments in → return value + effects out**.

- Test initial return value
- Test return value after state changes
- Test cleanup (if the hook registers listeners)

### For pure functions

The public API is: **arguments in → return value out**.

- Test with typical inputs
- Test edge cases (empty, null, boundary values)
- Test error cases

## Step 5: Check for fixture builders

Before writing inline mock data, check `src/fixtures/domains/` for an
existing builder that produces the type needed by the component's props.

```
# For a component that takes a `team: Team` prop:
# Check if teamFixtures.build() exists
Grep for "export function build" in src/fixtures/domains/
```

Use fixture builders when they exist. They produce complete, type-safe
objects and keep test data in sync with production types (Principle 6).

If no fixture exists for a needed type, use inline data with explicit type
annotations and `satisfies` to ensure type safety.

## Step 6: Generate the spec file

Create `<target-dir>/<ComponentName>.spec.tsx` (or `.spec.ts` for non-React
files).

### File structure

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Import from fixtures when available
import { teamFixtures } from '@/fixtures';
// Import the production module
import { MyComponent } from './MyComponent';
// Import types for satisfies (if needed)
import type { Props } from './MyComponent';

// ── Test data ──────────────────────────────────────────────────────────

const defaultProps: React.ComponentProps<typeof MyComponent> = {
  team: teamFixtures.build({ name: 'Engineering' }),
  onSelect: vi.fn(),
  isLoading: false,
};

// ── Helpers ────────────────────────────────────────────────────────────

function setup(overrides?: Partial<typeof defaultProps>) {
  const props = { ...defaultProps, ...overrides };
  const user = userEvent.setup();
  const result = render(<MyComponent {...props} />);
  return { ...result, props, user };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('MyComponent', () => {
  it('renders the team name', () => {
    setup();
    expect(screen.getByText('Engineering')).toBeVisible();
  });

  it('calls onSelect when clicked', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: /select/i }));
    expect(props.onSelect).toHaveBeenCalledWith(props.team.id);
  });

  it('shows loading state', () => {
    setup({ isLoading: true });
    expect(screen.queryByText('Engineering')).not.toBeInTheDocument();
  });
});
```

### Rules (the 10 principles, enforced during generation)

**P1 — Public API Only:**
- Assert on rendered output and callback invocations only
- Never assert on hook call counts, internal state, or effect order
- For hooks: assert on `result.current.*`, not on internal implementation

**P2 — Boundary Mocking:**
- Mock ONLY external boundaries: `fetchApi`/`fetchMock`, `localStorage`,
  `sessionStorage`, `next/router`, `next/navigation`, `firebase/*`
- NEVER mock own hooks, own components, or own utilities
- For containers: use `fetchMock` (already globally mocked) to intercept
  API calls. The global setup in `vitest.setup.ts` enables `vitest-fetch-mock`.
- Third-party mocks (posthog, echarts) are acceptable

**P3 — System Isolation:**
- Let pure presentational children render (do not mock them)
- Only mock children that have side effects (network, storage)

**P4 — Strict Strategies:**
- Unit tests: render with props only, no `QueryClientProvider`, no providers
- Integration tests (containers): wrap in `QueryClientProvider`, use `fetchMock`
- Never mix: no provider-wrapped renders in unit tests

For integration tests, create a fresh QueryClient per test:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function setup(overrides?: Partial<ContainerProps>) {
  const queryClient = createTestQueryClient();
  const props = { ...defaultProps, ...overrides };
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MyContainer {...props} />
    </QueryClientProvider>,
  );
  return { ...result, props, queryClient };
}
```

**P5 — Data Ownership:**
- Each test file owns its data. Define `defaultProps` at file scope.
- Use fixture builders (`build()`) for complex objects — they return new
  objects each call.
- Never import test data from another test file.
- For unique IDs across tests, use fixture builders (they auto-increment)
  or `crypto.randomUUID()` (jsdom provides it).

**P6 — Type-Safe Mocks:**
- `defaultProps` is explicitly typed: `React.ComponentProps<typeof Comp>`
- Mock return values use `satisfies` when mocking hook returns:
  ```typescript
  fetchMock.mockResponseOnce(JSON.stringify(teamFixtures.buildMany(3)));
  ```
- No `as any`. If you need to test with invalid data, use
  `as unknown as WrongType` with a comment explaining the intent.

**P7 — Refactor Sync:**
- Read the CURRENT production file. Do not copy patterns from old tests.
- If the production file's Props interface has changed since any old test
  was written, the new test uses the current interface.

**P8 — User Outcomes:**
- Use `screen.getByRole()` as the primary query (most accessible)
- Fall back to `screen.getByText()`, then `screen.getByTestId()`
- Assert on: `toBeVisible()`, `toBeInTheDocument()`, `toHaveTextContent()`,
  `toBeDisabled()`, `toHaveAttribute()`
- Assert callback invocations with `toHaveBeenCalledWith()`
- Never assert on CSS class names, DOM structure depth, or snapshot trees

**P9 — Determinism:**
- If the component displays dates or times: add `vi.useFakeTimers()` in a
  `beforeEach` and `vi.useRealTimers()` in `afterEach`
- If using faker directly (not via fixtures): call `faker.seed(12345)` at
  the top of the file
- Never rely on `Math.random()` or `new Date()` in test assertions
- The global setup already seeds `fetchMock`, but per-test timer control
  is the test file's responsibility

**P10 — Total Cleanup:**
- The global `vitest.setup.ts` already provides:
  - `afterEach(() => vi.clearAllMocks())`
  - `afterAll(() => { fetchMocker.disableMocks(); vi.useRealTimers(); })`
- Add file-level cleanup ONLY for resources the global setup does not cover:
  - `vi.useFakeTimers()` → add `afterEach(() => vi.useRealTimers())`
  - `localStorage.setItem()` → add `afterEach(() => localStorage.clear())`
  - `sessionStorage.setItem()` → add `afterEach(() => sessionStorage.clear())`
- Do NOT add redundant `vi.clearAllMocks()` (global setup handles it)
- Do NOT add `cleanup()` from testing-library (vitest auto-cleans with
  globals + jsdom)

### Container integration test: fetchMock pattern

The project uses `vitest-fetch-mock` globally. For container tests that
need to intercept API calls:

```typescript
beforeEach(() => {
  fetchMock.resetMocks();
});

it('renders data after fetch', async () => {
  const teams = teamFixtures.buildMany(3);
  fetchMock.mockResponseOnce(JSON.stringify(teams));

  setup();

  await waitFor(() => {
    expect(screen.getByText(teams[0].name)).toBeVisible();
  });
});

it('handles fetch error', async () => {
  fetchMock.mockRejectOnce(new Error('Network error'));

  setup();

  await waitFor(() => {
    expect(screen.getByText(/error/i)).toBeVisible();
  });
});
```

### Service hook test: renderHook pattern

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe('useMyQuery', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('returns data on success', async () => {
    const expected = teamFixtures.buildMany(3);
    fetchMock.mockResponseOnce(JSON.stringify(expected));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMyQuery({ teamId }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(expected);
  });

  it('passes correct URL parameters', async () => {
    fetchMock.mockResponseOnce(JSON.stringify([]));

    const { wrapper } = createWrapper();
    renderHook(() => useMyQuery({ teamId: 'team-1' }), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain('team-1');
  });
});
```

### Pure function test: minimal pattern

```typescript
import { myFunction } from './myFunction';

describe('myFunction', () => {
  it('returns expected output for typical input', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('handles empty input', () => {
    expect(myFunction('')).toBe('');
  });

  it('handles null/undefined', () => {
    expect(myFunction(null)).toBeNull();
  });
});
```

## Step 7: Verify

1. Run `npx tsc --noEmit` — fix any type errors in the new spec file.
2. Run `pnpm vitest run <path-to-new-spec>` — all tests must pass.
3. If tests fail because the component needs providers or context that the
   unit test does not supply:
   - If the component is DDAU (props only), the test is correct and the
     component has a hidden dependency — report it.
   - If the component is a container, switch to integration strategy.
4. Run `/audit-react-test <path-to-new-spec>` mentally against the 10
   principles. Every principle should score clean. If not, fix before
   finishing.

Report: file path, test count, pass/fail, and whether any principle
violations remain.

## What NOT to do

- Do not mock own hooks, own components, or own utility functions.
- Do not import test data from another test file.
- Do not wrap DDAU component renders in providers.
- Do not assert on CSS classes, internal state, or hook call counts.
- Do not use `as any` in mock data.
- Do not skip cleanup for timers or storage.
- Do not add `vi.clearAllMocks()` or `cleanup()` (global setup handles them).
- Do not generate snapshot tests.
- Do not generate tests that depend on render order or effect timing.
