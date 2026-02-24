---
name: audit-react-test
description: Audit test files against the contract-first testing philosophy. Detects internal mocking, stale mocks, missing cleanup, type-unsafe mocks, strategy mixing, implementation-detail assertions, shared mutable fixtures, and non-determinism.
context: fork
allowed-tools: Read, Grep, Glob
argument-hint: <path/to/feature/directory-or-spec-file>
---

Audit the test files at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a structured report scoring every spec file against
the 10 contract-first testing principles.

If the argument is a directory, audit all `.spec.ts`, `.spec.tsx`, `.test.ts`,
and `.test.tsx` files in that directory and its subdirectories. If it is a single
file, audit that file only.

## Background: The 10 Principles

| # | Principle | Violation signal |
|---|-----------|-----------------|
| 1 | Public API Only | Asserts on internal state, hook call counts, effect order |
| 2 | Boundary Mocking | Mocks own hooks, components, or utilities instead of network/storage/nav |
| 3 | System Isolation | Mocks child components that are pure presentational |
| 4 | Strict Strategies | Unit test seeds QueryClient, wraps in providers, or mocks at wrong level |
| 5 | Data Ownership | Shared mutable fixture objects imported from another test file |
| 6 | Type-Safe Mocks | Mock return values use `as any`, lack `satisfies`, or have no type annotation |
| 7 | Refactor Sync | Mock references deleted provider, removed hook, or renamed prop |
| 8 | User Outcomes | Asserts on CSS classes, snapshot of large tree, internal variable, or mock call args for own code |
| 9 | Determinism | Unmocked `Date`, `Math.random`, `setTimeout`, or `setInterval` in test path |
| 10 | Total Cleanup | Missing `afterEach`, or cleanup does not reset mocks/timers/storage/MSW |

## Step 1: Inventory all test files

Glob for all `.spec.ts`, `.spec.tsx`, `.test.ts`, `.test.tsx` files in the
target path. For each file, record:

- File path
- What it imports (the production module under test)
- Whether the production module still exists (if not, mark ORPHANED)
- Test runner (Vitest, Playwright, or other -- detect from imports)
- Number of `describe` blocks, `test`/`it` blocks

## Step 2: Check for orphaned tests

For each test file, verify the production file it imports still exists:

- If the test imports from a path that does not resolve to an existing file,
  flag as **ORPHANED**. Orphaned tests cause false failures and mask true
  coverage gaps.
- Check whether any `vi.mock()` target module still exists. A mock of a
  deleted module is a stale mock even if the test file itself still compiles.

## Step 3: Audit Principle 1 — Public API Only

For each test, check whether it asserts on internal implementation details:

- **Hook call counts**: `expect(useXxx).toHaveBeenCalledTimes(N)` where
  `useXxx` is the component's own hook (not a boundary mock)
- **Internal state**: Assertions on `useState` values, `useRef.current`,
  or internal variables accessed through non-public means
- **Effect execution order**: Assertions that depend on which order effects
  ran, or that effects ran at all
- **Re-render counts**: `renderCount` or similar tracking of render cycles

For component tests, the public API is: props in, rendered output + callback
invocations out. For hook tests, it is: arguments in, return value out.

Classify each violation:

| Code | Pattern | Fix |
|------|---------|-----|
| P1_HOOK_COUNT | Asserts own hook was called N times | Assert on rendered output instead |
| P1_INTERNAL_STATE | Reads internal state/ref through test-only accessor | Assert on visible behavior |
| P1_EFFECT_ORDER | Asserts on effect execution sequence | Assert on final rendered state |
| P1_RENDER_COUNT | Tracks re-render count | Remove unless profiling test |

## Step 4: Audit Principle 2 — Boundary Mocking

Scan every `vi.mock()`, `vi.spyOn()`, and `jest.mock()` call. Classify each
mock target:

| Classification | Examples | Verdict |
|----------------|----------|---------|
| **BOUNDARY** (correct) | `fetch`, `fetchApi`, `useFetchApi`, `localStorage`, `sessionStorage`, `next/router`, `next/navigation`, `firebase/*`, MSW handlers | OK |
| **OWN_HOOK** (violation) | `vi.mock('../useMyHook')`, `vi.mock('../../hooks/useFilterStore')` — mocking a hook defined in the same codebase | P2 violation |
| **OWN_COMPONENT** (violation) | `vi.mock('../ChildComponent')` — mocking a presentational component | P2 violation |
| **OWN_UTILITY** (violation) | `vi.mock('../../utils/formatDate')` — mocking a pure utility function in the same codebase | P2 violation |
| **THIRD_PARTY** (OK) | `vi.mock('posthog-js')`, `vi.mock('echarts-for-react')` | OK (external boundary) |

For each OWN_HOOK / OWN_COMPONENT / OWN_UTILITY violation, note:
- The mock target path
- What the mock returns (to understand what the test is trying to control)
- What boundary mock would replace it (e.g., mock fetchApi instead of
  the hook that calls fetchApi)

**Exception**: Mocking a hook that crosses a domain boundary is acceptable
when testing a container in isolation. For example, a container test that
mocks a service hook to avoid network calls is a lighter alternative to MSW.
Flag these as **DOMAIN_BOUNDARY_MOCK** (review, not violation). The
preferred approach is MSW, but this is a judgment call, not an error.

## Step 5: Audit Principle 3 — System Isolation

For each `vi.mock()` that mocks a child component:

- Read the mocked component. Is it a pure presentational component (props
  only, no hooks, no side effects)?
- If yes, the mock is unnecessary — let the real component render. Flag as
  **P3_UNNECESSARY_COMPONENT_MOCK**.
- If the component has side effects (network calls, storage access),
  mocking it is acceptable.

Also check for over-isolation:
- Tests that wrap renders in `<MockedProviders>` or custom test wrappers
  that mock everything should be flagged as candidates for simplification
  once the component is DDAU (all data via props).

## Step 6: Audit Principle 4 — Strict Strategies

Classify each test file's strategy level:

| Signal | Strategy |
|--------|----------|
| Renders component with props only, no providers | Unit test |
| Renders component wrapped in providers, seeds QueryClient | Integration test |
| Uses MSW to intercept network at fetch level | Integration test |
| Uses Playwright, real browser | E2E test |
| Calls a function directly, no rendering | Unit test (pure function) |

Flag strategy mixing:

| Code | Pattern | Fix |
|------|---------|-----|
| P4_UNIT_WITH_QUERYCLIENT | Unit test seeds `QueryClient` or wraps in `QueryClientProvider` | Remove provider wrapping or reclassify as integration |
| P4_UNIT_WITH_PROVIDERS | Unit test wraps in `MockedProviders`, auth providers, etc. | Push data through props instead |
| P4_INTEGRATION_MOCKING_HOOKS | Integration test mocks hooks instead of using MSW | Use MSW or push data through props |
| P4_MIXED_SIGNALS | Same file has both pure-props renders and provider-wrapped renders | Split into separate unit and integration files |

## Step 7: Audit Principle 5 — Data Ownership

For each test file, check data sourcing:

- **Inline data** (OK): Test constructs its own objects within the test body
- **Local factory** (OK): Test calls a factory function that returns new
  objects each call (`build()`, `buildTeam()`, `create*()`)
- **Fixture system** (OK): Imports from `src/fixtures/` — designed for this
- **Shared mutable constant** (violation): Imports a `const` object from
  another file (e.g., `import { mockedData } from './mocks'`) where the
  object is not wrapped in a factory function

For shared constants, check whether the imported value is:
- A frozen/immutable object (lower risk but still a coupling smell)
- A mutable object that tests could mutate (high risk)
- An array that tests `.push()` to or `.splice()` from (high risk)

Classify:

| Code | Pattern | Fix |
|------|---------|-----|
| P5_SHARED_MUTABLE | Imports mutable test data from another file | Wrap in factory function or inline |
| P5_CROSS_FILE_DATA | Test file imports data from another test file | Move to shared factory or inline |
| P5_STALE_MOCK_DATA | Mock data shape does not match current production type | Update mock data to match type |

## Step 8: Audit Principle 6 — Type-Safe Mocks

For each mock return value and mock data object, check type safety:

| Code | Pattern | Fix |
|------|---------|-----|
| P6_AS_ANY | `as any` on mock return value or mock data | Add explicit type or `satisfies` |
| P6_AS_UNKNOWN_AS | `as unknown as T` double cast on mock | Fix the mock shape to match T |
| P6_UNTYPED_MOCK | `vi.fn().mockReturnValue({...})` with no type annotation | Add `satisfies ReturnType<typeof hook>` |
| P6_PARTIAL_MOCK | Mock provides 2 of 10 required fields, cast away the rest | Use factory that produces complete objects |
| P6_ESLINT_DISABLE_UNSAFE | `eslint-disable @typescript-eslint/no-unsafe-*` in test | Fix the type instead of suppressing |

Count total `as any` occurrences per file. Files with 5+ are high priority.

## Step 9: Audit Principle 7 — Refactor Sync

Check for stale references:

- **Deleted providers**: `vi.mock` targets or wrapper components that
  reference providers that no longer exist in the codebase. Grep for the
  provider name outside the test file.
- **Changed hook signatures**: Mock return shapes that do not match the
  current hook's return type. Read the hook and compare.
- **Renamed props**: Tests passing props that the component no longer accepts.
  Read the component's Props interface and compare.
- **Dead mock wrappers**: Test utility functions (`renderWithProviders`,
  `MockedXxx`) that wrap in providers the component no longer needs.

Classify:

| Code | Pattern | Fix |
|------|---------|-----|
| P7_DELETED_PROVIDER | Mocks/wraps in provider that no longer exists | Remove mock/wrapper |
| P7_STALE_HOOK_SHAPE | Mock return shape does not match current hook | Update mock to match current shape |
| P7_RENAMED_PROP | Test passes prop name that component no longer accepts | Update prop name |
| P7_DEAD_WRAPPER | Test utility wraps in unnecessary providers | Simplify render helper |

## Step 10: Audit Principle 8 — User Outcomes

For each assertion in each test, classify:

| Classification | Examples | Verdict |
|----------------|----------|---------|
| **USER_VISIBLE** (correct) | `getByText`, `getByRole`, `toBeVisible`, `toBeInTheDocument`, `toHaveTextContent`, `toBeDisabled`, `toHaveAttribute('aria-*)` | OK |
| **CALLBACK_FIRED** (correct) | `expect(onSubmit).toHaveBeenCalledWith(...)` where `onSubmit` is a prop callback | OK |
| **HOOK_RETURN** (correct for hook tests) | `expect(result.current.value).toBe(...)` from `renderHook` | OK |
| **IMPLEMENTATION_DETAIL** (violation) | Asserts on mock call args for own hooks, CSS class names, DOM structure depth, internal variable values | P8 violation |
| **LARGE_SNAPSHOT** (violation) | `toMatchSnapshot()` or `toMatchInlineSnapshot()` on a component with 50+ elements | P8 violation |

Flag:

| Code | Pattern | Fix |
|------|---------|-----|
| P8_CSS_CLASS | Asserts on className, classList, or specific CSS class string | Assert on visual outcome or aria attribute |
| P8_LARGE_SNAPSHOT | Snapshot of component tree with 50+ nodes | Replace with targeted assertions |
| P8_INTERNAL_MOCK_ARGS | Asserts mock was called with args, where mock is own code | Assert on rendered result of that call |
| P8_DOM_STRUCTURE | Asserts on DOM nesting depth, tag names, or node counts | Assert on visible content |

## Step 11: Audit Principle 9 — Determinism

Scan for non-deterministic patterns:

- `new Date()` without `vi.setSystemTime()` in the same describe block
- `Date.now()` without mocked timers
- `Math.random()` without seeded override
- `setTimeout` / `setInterval` in production code under test without
  `vi.useFakeTimers()`
- `faker.*` calls without `faker.seed()` in the file or an imported pool
- `crypto.randomUUID()` without mock

Also check that timer mocking is complete:
- `vi.useFakeTimers()` must pair with `vi.useRealTimers()` in cleanup
- `vi.setSystemTime()` must pair with timer restoration in cleanup

Classify:

| Code | Pattern | Fix |
|------|---------|-----|
| P9_UNMOCKED_DATE | `new Date()` or `Date.now()` without fake timers | Add `vi.useFakeTimers()` + `vi.setSystemTime()` |
| P9_UNMOCKED_RANDOM | `Math.random()` without seed | Mock or seed |
| P9_UNSEEDED_FAKER | `faker.*` without `faker.seed()` or pool | Add seed or use fixture system |
| P9_TIMER_NO_CLEANUP | `vi.useFakeTimers()` without `vi.useRealTimers()` in cleanup | Add cleanup |

## Step 12: Audit Principle 10 — Total Cleanup

For each test file, check the cleanup story:

### Required cleanup patterns

| Resource | Cleanup | Where |
|----------|---------|-------|
| `vi.mock()` | `vi.restoreAllMocks()` | `afterEach` |
| `vi.useFakeTimers()` | `vi.useRealTimers()` | `afterEach` |
| `vi.setSystemTime()` | `vi.useRealTimers()` | `afterEach` |
| `localStorage.setItem()` | `localStorage.clear()` | `afterEach` |
| `sessionStorage.setItem()` | `sessionStorage.clear()` | `afterEach` |
| MSW `server.use()` | `server.resetHandlers()` | `afterEach` |
| `document.body.innerHTML` | Reset | `afterEach` |
| Global spies (`vi.spyOn(window, ...)`) | `spy.mockRestore()` or `vi.restoreAllMocks()` | `afterEach` |
| QueryClient | `queryClient.clear()` | `afterEach` |
| DOM cleanup | `cleanup()` from testing-library (auto if using `@testing-library/react`) | Verify auto-cleanup is not disabled |

Classify:

| Code | Pattern | Fix |
|------|---------|-----|
| P10_NO_AFTEREACH | File has mocks/timers/storage but no `afterEach` | Add `afterEach` with full cleanup |
| P10_PARTIAL_CLEANUP | `afterEach` exists but does not reset all resources | Add missing cleanup calls |
| P10_INLINE_CLEANUP | Cleanup scattered inside individual tests instead of `afterEach` | Centralize in `afterEach` |
| P10_NO_MOCK_RESTORE | Mocks created but `vi.restoreAllMocks()` never called | Add to `afterEach` |
| P10_TIMER_LEAK | Fake timers set up but never restored | Add `vi.useRealTimers()` to `afterEach` |
| P10_STORAGE_LEAK | Storage written but never cleared | Add storage clear to `afterEach` |

## Step 13: Coverage gap detection

For each production file in the target directory that has NO corresponding
test file:

- Record the file path
- Classify it (component, container, hook, utility)
- Estimate complexity (line count, number of branches, number of props/args)
- Prioritize: high-complexity files without tests are the biggest gaps

For each test file, check whether it covers the component's full public API:

- List all props from the production component's Props interface
- Check whether each prop has at least one test that exercises it
- List all callbacks and check whether each has a test asserting it fires
- Flag untested props/callbacks as **COVERAGE_GAP**

## Step 14: Produce the audit report

```
## Test Audit: <target>

### Summary
- Test files audited: <N>
- Orphaned test files: <N>
- Total violations: <N>
- Files with 0 violations: <N> (<percent>%)

### Violations by principle
| # | Principle | Violations | Files affected |
|---|-----------|-----------|----------------|
| 1 | Public API Only | ... | ... |
| 2 | Boundary Mocking | ... | ... |
| 3 | System Isolation | ... | ... |
| 4 | Strict Strategies | ... | ... |
| 5 | Data Ownership | ... | ... |
| 6 | Type-Safe Mocks | ... | ... |
| 7 | Refactor Sync | ... | ... |
| 8 | User Outcomes | ... | ... |
| 9 | Determinism | ... | ... |
| 10 | Total Cleanup | ... | ... |

### Orphaned tests (delete immediately)
| Test file | Missing production file | Action |
|-----------|----------------------|--------|
| ... | ... | Delete test file |

### Per-file scorecard
| Test file | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | Score |
|-----------|----|----|----|----|----|----|----|----|----|----|-------|
| ... | OK | 2 | OK | 1 | OK | 3 | OK | OK | 1 | 1 | 2/10 |

Score = number of principles with zero violations (0-10, higher is better).

### Principle 2 detail: Boundary mocking violations
| File | Mock target | Classification | Replacement |
|------|------------|---------------|-------------|
| ... | useFilterStore | OWN_HOOK | Mock fetchApi or use MSW |
| ... | ChildComponent | OWN_COMPONENT | Let real component render |

### Principle 4 detail: Strategy mixing
| File | Current strategy | Violations | Fix |
|------|-----------------|-----------|-----|
| ... | Unit test with providers | P4_UNIT_WITH_PROVIDERS | Push data through props |

### Principle 6 detail: Type safety violations
| File | Pattern | Count | Fix |
|------|---------|-------|-----|
| ... | as any | 8 | Add satisfies or explicit type |
| ... | untyped mock | 3 | Add return type annotation |

### Principle 10 detail: Cleanup violations
| File | Resource | Cleanup present? | Fix |
|------|----------|-----------------|-----|
| ... | vi.setSystemTime | NO | Add vi.useRealTimers() to afterEach |
| ... | sessionStorage | Inline only | Centralize in afterEach |

### Coverage gaps
| Production file | Type | Complexity | Has test? | Untested API surface |
|----------------|------|-----------|-----------|---------------------|
| ... | component | 150 lines, 12 props | No | All props |
| ... | component | 80 lines, 6 props | Yes | onDelete, isDisabled |

### Fixture system adoption
| Test file | Data pattern | Recommendation |
|-----------|-------------|----------------|
| ... | Shared mutable constant | Convert to fixture builder |
| ... | Inline with as any | Use build() from fixtures |
| ... | Fixture system (build()) | Already compliant |

### Migration priority (files sorted by violation count, highest first)
| # | Test file | Violations | Top violations | Estimated effort |
|---|-----------|-----------|---------------|-----------------|
| 1 | ... | 8 | P2 (3), P6 (3), P10 (2) | Medium |
| 2 | ... | 6 | P4 (2), P2 (2), P6 (2) | Medium |
| 3 | ... | 4 | P2 (2), P10 (2) | Low |

### Estimated scope
- Orphaned tests to delete: <N>
- Files needing cleanup only (P10): <N>
- Files needing mock refactoring (P2, P3): <N>
- Files needing type safety fixes (P6): <N>
- Files needing strategy reclassification (P4): <N>
- Files needing rewrite (3+ principles violated): <N>
- Production files with no test coverage: <N>
```
