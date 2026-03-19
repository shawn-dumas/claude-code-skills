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

<!-- role: workflow -->

## Step 0: Pre-flight — delete-or-build decision

Before generating, check whether a spec file already exists for this
production file. Look for `<basename>.spec.ts`, `<basename>.spec.tsx`,
`<basename>.test.ts`, `<basename>.test.tsx` in the same directory and in a
sibling `__tests__/` or `tests/` directory.

If a spec file exists, run the delete threshold check:

| Condition                                                                                                                                | Decision                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Production file was deleted or moved                                                                                                     | Delete the spec (orphaned)      |
| Spec scores ≤ 4/10 on the 10 principles (quick estimate)                                                                                 | Delete and rebuild from scratch |
| Spec mocks ≥ 3 own hooks or components (`vi.mock` of non-boundary targets)                                                               | Delete and rebuild              |
| Spec references ≥ 2 deleted providers/hooks (stale mocks)                                                                                | Delete and rebuild              |
| Production file changed from self-contained to DDAU (now receives all data via props, but spec still wraps in providers and mocks hooks) | Delete and rebuild              |
| Spec is a copy-paste of another spec (describe block names a different component)                                                        | Delete and rebuild              |

If the threshold is met: delete the old spec, report what was deleted and
why, then continue to generate fresh. If the existing spec is close to
compliant (scores 7+/10), report that and suggest using a future
`refactor-react-test` skill instead of rebuilding.

<!-- role: workflow -->

## Step 0b: Run AST analysis on the production file

```bash
npx tsx scripts/AST/ast-react-inventory.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-data-layer.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-ownership.ts $ARGUMENTS --pretty
```

Use react-inventory to extract component and hook observations (props,
hook calls, effects). Use data-layer to identify service hook definitions
and fetchApi calls. Use ast-interpret-ownership to classify the production
file as `CONTAINER`, `DDAU_COMPONENT`, or `LEAF_VIOLATION`:

- `CONTAINER` -- owns data orchestration, needs integration test strategy
- `DDAU_COMPONENT` -- receives all data via props, needs unit test strategy
- `LEAF_VIOLATION` -- calls hooks it should not, needs investigation before testing

The ownership assessments directly inform the test strategy decision in Step 2.

<!-- role: workflow -->

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

<!-- role: workflow -->

## Step 2: Classify and select strategy

Use the ownership assessment from Step 0b to determine the test strategy:

| Ownership Assessment | Criteria                                                                   | Strategy                                  |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| **DDAU_COMPONENT**   | Receives all data via props, no service hooks, no context hooks, no router | **Unit test**                             |
| **CONTAINER**        | Calls service hooks, context hooks, useRouter, or wires data to children   | **Integration test**                      |
| **LEAF_VIOLATION**   | Component with prop evidence but disallowed hooks                          | Investigate -- may need refactoring first |
| **AMBIGUOUS**        | Mixed signals                                                              | Use data layer observations to decide     |

For non-component files (hooks, utilities), check the data layer observations:

| Data Layer Observation     | Classification    | Strategy                                     |
| -------------------------- | ----------------- | -------------------------------------------- |
| `QUERY_HOOK_DEFINITION`    | Service hook      | **Hook unit test** (mock fetchApi)           |
| `MUTATION_HOOK_DEFINITION` | Service hook      | **Hook unit test** (mock fetchApi)           |
| No data layer observations | Utility hook/func | **Hook unit test** or **Function unit test** |

For providers, use **Integration test** strategy with consumer components.

If the user forced a strategy via the second argument, use that instead.

<!-- role: workflow -->

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

<!-- role: workflow -->

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

<!-- role: workflow -->

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

<!-- role: emit -->

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

For container tests: mock at the fetchApi/fetchMock boundary, not at the
hook layer. Service hooks are own-project code. The HTTP layer is the
external boundary.

Asserting on `fetchMock` call arguments (URL, headers) IS acceptable --
`fetchApi` is a boundary. Asserting on service hook call arguments is NOT
acceptable -- those are internal implementation details.

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
- No `as any`. Type hierarchy for test data (use the first that works):

  1. **Fixture builder**: `teamFixtures.build({ name: 'Ops' })` -- preferred,
     always type-safe, produces complete objects
  2. **`satisfies`**: `{ id: '1', name: 'Ops' } satisfies Team` -- for inline
     literals where a fixture builder does not exist
  3. **Explicit type annotation**: `const team: Team = { ... }` -- same as
     `satisfies` but for `const` bindings
  4. **`as unknown as WrongType`**: ONLY for intentionally invalid data when
     testing error paths (e.g., passing a malformed object to verify the
     component handles it). Must include a comment explaining the intent.
     Never use this to silence a type error on valid test data -- fix the
     data instead.

  If you find yourself reaching for `as unknown as` on valid data, the
  fixture builder almost certainly has an `overrides` parameter that
  handles it: `build({ category: 'unclassified' })`. Check before casting.

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

#### Scenario A: Verify a query is called with correct params from URL state

When a container derives query params from URL state (nuqs, router), the
test verifies the HTTP request URL rather than hook call arguments:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { systemFixtures } from '@/fixtures';
import { SystemsContainer } from './SystemsContainer';

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
  return render(
    <QueryClientProvider client={queryClient}>
      <SystemsContainer />
    </QueryClientProvider>,
  );
}

describe('SystemsContainer', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('fetches systems overview with team params from URL', async () => {
    const systems = systemFixtures.buildMany(2);
    fetchMock.mockResponseOnce(JSON.stringify(systems));

    // Set URL params before render (via nuqs test utils or window.history)
    window.history.replaceState({}, '', '?teams=1,2');

    setup();

    await waitFor(() => {
      expect(screen.getByText(systems[0].name)).toBeVisible();
    });

    // Assert on fetchMock URL (boundary assertion -- acceptable)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/systems/overview?teams=1,2'),
      expect.any(Object),
    );
  });
});
```

#### Scenario B: Verify a query is disabled when URL params are missing

When a container requires URL params to enable a query, the test verifies
the fetch was NOT made and the empty state is rendered:

```typescript
it('does not fetch when no teams are selected', async () => {
  window.history.replaceState({}, '', '?');

  setup();

  // Verify the empty state renders
  expect(screen.getByText('Select a team to view data')).toBeVisible();

  // Verify no fetch was made for this endpoint
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/systems/overview'), expect.any(Object));
});
```

**Why this works:** Service hooks internally call `fetchApi`, which calls
`fetch`. `vitest-fetch-mock` intercepts `fetch` globally. By asserting on
`fetchMock` URL strings, we verify the container wired query params
correctly WITHOUT mocking own hooks. The rendered output confirms the data
flows through the component tree correctly.

#### "Nothing happened" assertions (no setTimeout)

Never use `await new Promise(resolve => setTimeout(resolve, N))` to assert
that something did NOT happen. This pattern is fragile (timing-dependent)
and slow.

For disabled queries or "nothing should render" checks, assert the state
synchronously or use `waitFor` with a negative assertion:

```typescript
// WRONG: setTimeout to "wait and check nothing changed"
setup();
await new Promise(resolve => setTimeout(resolve, 50));
expect(fetchMock).not.toHaveBeenCalled();

// RIGHT: assert synchronously -- if the query is disabled, no fetch fires
setup();
expect(fetchMock).not.toHaveBeenCalled();
expect(screen.getByText('Select a team to view data')).toBeVisible();

// RIGHT: if you need to wait for an initial render cycle
setup();
await waitFor(() => {
  expect(screen.getByText('Select a team to view data')).toBeVisible();
});
expect(fetchMock).not.toHaveBeenCalled();
```

The principle: assert on the visible state (empty state, placeholder, or
absence of data), not on the passage of time. If the component renders an
empty state when the query is disabled, assert on that. The `fetchMock`
assertion is a secondary check confirming no request was made.

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

  it('does not fetch when teamId is undefined (query disabled)', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useMyQuery({ teamId: undefined }), { wrapper });

    // Assert synchronously -- disabled queries never call fetch
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

**Disabled query testing:** When a service hook has `enabled: !!teamId`
(or similar), the "query disabled" test should assert synchronously that
`fetchMock` was not called. No `setTimeout`, no `waitFor` -- a disabled
query never fires, so there is nothing to wait for. The assertion is
immediate.

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

<!-- role: workflow -->

## Step 7: Verify

1. Run `npx tsc --noEmit -p tsconfig.check.json` — fix any type errors in the new spec file.
2. Run `npx tsx scripts/AST/ast-complexity.ts <path-to-new-spec> --pretty`.
   Every function must have cyclomatic complexity <= 10. Test setup
   functions can be complex — if any exceed 10, decompose them before
   proceeding.
3. Run `npx tsx scripts/AST/ast-type-safety.ts <path-to-new-spec> --pretty`.
   Zero `as any` casts. Zero `as unknown as` casts on valid test data.
   Every `as unknown as` must have a comment explaining why the data is
   intentionally invalid (error-path testing). If the cast exists because
   the fixture builder does not support the needed override, fix the
   fixture builder or use `satisfies` instead.
   Non-null assertions are acceptable only with a comment explaining why
   the value is guaranteed non-null.
4. Run `pnpm vitest run <path-to-new-spec>` — all tests must pass.
5. If tests fail because the component needs providers or context that the
   unit test does not supply:
   - If the component is DDAU (props only), the test is correct and the
     component has a hidden dependency — report it.
   - If the component is a container, switch to integration strategy.
6. Run `/audit-react-test <path-to-new-spec>` mentally against the 10
   principles. Every principle should score clean. If not, fix before
   finishing.

Report: file path, test count, pass/fail, and whether any principle
violations remain.

<!-- role: avoid -->

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
- Do not use `await new Promise(resolve => setTimeout(resolve, N))` to
  assert nothing happened. Assert the visible empty state instead.
- Do not use `as unknown as` to silence type errors on valid test data.
  Use fixture `build(overrides)` or `satisfies` instead. Reserve
  `as unknown as` for intentionally invalid data in error-path tests.
- Do not mock service hooks in container tests and assert on their call arguments.

  ```typescript
  // WRONG: mocking the hook and asserting on call args
  vi.mock('@/services/hooks/queries/insights', () => ({
    useSystemsOverviewQuery: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  }));
  expect(useSystemsOverviewQuery).toHaveBeenCalledWith(
    expect.objectContaining({ teams: [1, 2] }),
    expect.objectContaining({ enabled: true }),
  );

  // RIGHT: use fetchMock at the HTTP boundary
  fetchMock.mockResponseOnce(JSON.stringify(systemFixtures.buildMany(2)));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/systems/overview?teams=1,2'),
    expect.any(Object),
  );
  expect(screen.getByText('System Name')).toBeInTheDocument();
  ```

<!-- role: workflow -->

## Interpreter Calibration Gate

If any interpreter classification is wrong and the misclassification
affected a decision in this skill's workflow:

1. Confirm you investigated and the interpreter is genuinely wrong.
2. Run `/create-feedback-fixture --tool <name> --file <path> --expected <correct-kind> --actual <wrong-kind>`.
3. Note the fixture in the summary output.

Do NOT create a fixture if you are unsure or the error did not affect
a decision.
