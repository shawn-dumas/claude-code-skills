---
name: refactor-react-test
description: Audit an existing Vitest spec file against the 10 contract-first testing principles and the current production API, then rewrite it to comply. Applies the delete threshold — if the file scores ≤ 4/10, deletes and delegates to build-react-test.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/spec-file.spec.tsx>
---

Refactor the test file at `$ARGUMENTS` to comply with the contract-first
testing philosophy. Read the spec, score it, fix or replace it.

## Step 1: Read the spec and its production file

Read the spec file completely. Identify:

- The production module it imports (the "subject under test")
- All `vi.mock()` / `vi.spyOn()` targets
- All `describe` / `it` blocks and what they assert
- All `afterEach` / `beforeEach` / `afterAll` / `beforeAll` blocks
- All test data: inline, factory, shared import, fixture system

Then read the production file completely. Record:

- Current exports, Props interface, hook signatures, function signatures
- Whether the file is DDAU (props only), container, hook, or utility
- What it imports (to understand boundaries)

## Step 2: Score against the 10 principles

Quickly score the spec against each principle (OK or VIOLATION with count):

| # | Principle | Score |
|---|-----------|-------|
| 1 | Public API Only | OK / N violations |
| 2 | Boundary Mocking | OK / N violations |
| 3 | System Isolation | OK / N violations |
| 4 | Strict Strategies | OK / N violations |
| 5 | Data Ownership | OK / N violations |
| 6 | Type-Safe Mocks | OK / N violations |
| 7 | Refactor Sync | OK / N violations |
| 8 | User Outcomes | OK / N violations |
| 9 | Determinism | OK / N violations |
| 10 | Total Cleanup | OK / N violations |

Total score = number of principles with zero violations (0-10).

## Step 3: Apply the delete threshold

If ANY of these conditions are met, delete the spec and delegate to
`/build-react-test <production-file-path>`:

| Condition | Threshold |
|-----------|-----------|
| Score ≤ 4/10 | 6+ principles violated |
| ≥ 3 own-hook/component mocks | `vi.mock` of non-boundary targets |
| ≥ 2 stale provider/hook refs | Mocks/wraps providers that no longer exist |
| Architecture mismatch | Production is DDAU but spec wraps in providers + mocks hooks |
| Copy-paste duplicate | `describe` names a different component than what is imported |
| Strategy inversion | Spec is unit but production is container, or vice versa |

If the threshold is met:
1. Report what was scored, which condition triggered the delete
2. Delete the spec file
3. Run `/build-react-test <production-file-path>` (invoke the skill)
4. Stop — the build skill handles everything from here

If the score is ≥ 7/10, proceed to Step 4 (targeted fixes).

If the score is 5-6/10, apply the gray-zone tiebreaker:
- Does the test have non-trivial interaction/flow assertions? → Fix
- Is > 60% of the file mock setup? → Delete and rebuild
- Is it a thin render-and-assert? → Delete and rebuild

## Step 4: Fix violations (targeted, in-place)

For each violated principle, apply the fix patterns below. Work in this
order (each fix may resolve violations in later principles):

### 4a. Fix P7 — Refactor Sync (stale references)

Fix these first because they block other fixes:

- **Deleted provider mocks**: Remove `vi.mock` calls targeting providers
  that no longer exist. Remove wrapper components that wrap in dead providers.
- **Stale hook shapes**: Update mock return values to match the current hook
  signature. Read the hook, compare with the mock.
- **Renamed props**: Update prop names in test calls to match the current
  Props interface.
- **Dead mock wrappers**: Replace custom `renderWith*` helpers that wrap in
  unnecessary providers with direct `render()`.

### 4b. Fix P2/P3 — Boundary Mocking + System Isolation

- **Own-hook mocks in DDAU component tests**: The component now receives
  data via props. Delete the `vi.mock` and pass data as props instead.
- **Own-component mocks for presentational children**: Remove the mock, let
  the real child render. The child is pure — it adds no external deps.
- **Own-utility mocks**: Remove the mock. Use the real utility. Pure
  functions should not be mocked.
- **If removing a mock breaks the test**: The test was asserting on mock
  call args (P8 violation). Rewrite the assertion to check rendered output.

### 4c. Fix P4 — Strict Strategies

- **DDAU component wrapped in providers**: Remove all providers. Render with
  props only. If the component actually needs a provider to render (e.g.,
  it still calls a context hook), that is a production-code DDAU violation —
  report it but do not "fix" it in the test by adding providers.
- **Container without providers**: Add `QueryClientProvider` with a fresh
  `QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })`.
  Use `fetchMock` for API interception.

### 4d. Fix P6 — Type-Safe Mocks

- Replace every `as any` with:
  - A fixture builder call: `teamFixtures.build({ name: 'Test' })`
  - An explicit type: `const data: Team = { ... }`
  - A `satisfies`: `{ ... } satisfies ReturnType<typeof useMyHook>`
- Replace every `as unknown as T` with a properly shaped object
- Remove `eslint-disable` for type safety rules — fix the underlying issue

### 4e. Fix P5 — Data Ownership

- Replace shared mutable imports with inline data or factory calls
- If the spec imports data from another test file, inline it or use
  `src/fixtures/` builders

### 4f. Fix P10 — Total Cleanup

The global `vitest.setup.ts` provides `afterEach(() => vi.clearAllMocks())`.
The spec needs additional cleanup only for:

- `vi.useFakeTimers()` → add `afterEach(() => vi.useRealTimers())`
- `localStorage.setItem()` → add `afterEach(() => localStorage.clear())`
- `sessionStorage.setItem()` → add `afterEach(() => sessionStorage.clear())`
- `fetchMock` usage → add `beforeEach(() => fetchMock.resetMocks())`

Do NOT add redundant `vi.clearAllMocks()` or `cleanup()`.

### 4g. Fix P9 — Determinism

- Add `vi.useFakeTimers()` and `vi.setSystemTime()` for date-dependent tests
- Add `faker.seed()` if using faker directly (not via fixture builders)
- Pair every `vi.useFakeTimers()` with `vi.useRealTimers()` in cleanup

### 4h. Fix P1/P8 — Public API + User Outcomes

- Replace hook-call-count assertions with rendered-output assertions
- Replace CSS class assertions with `toBeVisible()` / `toHaveAttribute()`
- Replace mock-call-arg assertions (for own code) with `getByText` / `getByRole`
- Replace large snapshots with targeted assertions

## Step 5: Restructure if needed

After applying fixes, check if the file structure is sound:

- **`defaultProps` pattern**: If the spec tests a component, ensure there
  is a `defaultProps` object with complete, realistic data (from fixtures
  if available) and a `setup(overrides?)` function.
- **Test organization**: Group by feature/behavior, not by prop name.
  `describe('when loading')`, not `describe('isLoading prop')`.
- **One test per behavior**: Each `it` block should test one user-visible
  behavior, not one implementation detail.

## Step 6: Verify

1. Run `npx tsc --noEmit` — fix type errors in the spec.
2. Run `pnpm vitest run <path-to-spec>` — all tests must pass.
3. Re-score against the 10 principles. Must be 10/10.
4. If any principle still has violations after fixes, report which ones
   and why they cannot be fixed without production-code changes.

Report: original score, new score, changes made, tests passing.
