---
name: audit-react-test
description: Audit test files against the contract-first testing philosophy. Detects internal mocking, stale mocks, missing cleanup, type-unsafe mocks, strategy mixing, implementation-detail assertions, shared mutable fixtures, and non-determinism.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/feature/directory-or-spec-file>
---

Audit the test files at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a structured report scoring every spec file against
the 10 contract-first testing principles.

If the argument is a directory, audit all `.spec.ts`, `.spec.tsx`, `.test.ts`,
and `.test.tsx` files in that directory and its subdirectories. If it is a single
file, audit that file only.

## Background: The 10 Principles

| #   | Principle         | Violation signal                                                                                  |
| --- | ----------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Public API Only   | Asserts on internal state, hook call counts, effect order                                         |
| 2   | Boundary Mocking  | Mocks own hooks, components, or utilities instead of network/storage/nav                          |
| 3   | System Isolation  | Mocks child components that are pure presentational                                               |
| 4   | Strict Strategies | Unit test seeds QueryClient, wraps in providers, or mocks at wrong level                          |
| 5   | Data Ownership    | Shared mutable fixture objects imported from another test file                                    |
| 6   | Type-Safe Mocks   | Mock return values use `as any`, lack `satisfies`, or have no type annotation                     |
| 7   | Refactor Sync     | Mock references deleted provider, removed hook, or renamed prop                                   |
| 8   | User Outcomes     | Asserts on CSS classes, snapshot of large tree, internal variable, or mock call args for own code |
| 9   | Determinism       | Unmocked `Date`, `Math.random`, `setTimeout`, or `setInterval` in test path                       |
| 10  | Total Cleanup     | Missing `afterEach`, or cleanup does not reset mocks/timers/storage/MSW                           |

## Step 0: Run AST analysis tools and interpreters

```bash
# --- Observation-producing tools ---

# Test file analysis (emits MOCK_DECLARATION, ASSERTION_CALL, RENDER_CALL,
# PROVIDER_WRAPPER, AFTER_EACH_BLOCK, CLEANUP_CALL, FIXTURE_IMPORT,
# SHARED_MUTABLE_IMPORT, TEST_SUBJECT_IMPORT observations)
npx tsx scripts/AST/ast-test-analysis.ts $ARGUMENTS --pretty

# Type safety in test files (emits AS_ANY_CAST, EXPLICIT_ANY_ANNOTATION observations)
npx tsx scripts/AST/ast-type-safety.ts $ARGUMENTS --pretty

# --- Interpreters ---

# Test quality assessment (emits assessments for mock, assertion, strategy,
# cleanup, data sourcing, and triage)
npx tsx scripts/AST/ast-interpret-test-quality.ts $ARGUMENTS --pretty
```

### Using observations and assessments

**Observations** are structural facts from ast-test-analysis:

- `MOCK_DECLARATION` observations: raw mock targets
- `ASSERTION_CALL` observations: raw assertion patterns
- `RENDER_CALL`, `PROVIDER_WRAPPER` observations: strategy signals
- `AFTER_EACH_BLOCK`, `CLEANUP_CALL` observations: cleanup presence
- `FIXTURE_IMPORT`, `SHARED_MUTABLE_IMPORT` observations: data sourcing signals

**Assessments** from ast-interpret-test-quality classify these observations:

| Assessment Kind            | Maps to Principle | Meaning                                        |
| -------------------------- | ----------------- | ---------------------------------------------- |
| `MOCK_BOUNDARY_COMPLIANT`  | P2                | Mock targets only external boundaries (OK)     |
| `MOCK_INTERNAL_VIOLATION`  | P2                | Mocks own hook/component/utility (violation)   |
| `MOCK_DOMAIN_BOUNDARY`     | P2                | Mocks hook from different domain (review)      |
| `ASSERTION_USER_VISIBLE`   | P8                | Asserts on rendered output/aria (OK)           |
| `ASSERTION_IMPLEMENTATION` | P8                | Asserts on implementation details (violation)  |
| `ASSERTION_SNAPSHOT`       | P8                | Large snapshot assertion (violation)           |
| `DETECTED_STRATEGY`        | P4                | Records detected strategy (neutral)            |
| `CLEANUP_COMPLETE`         | P10               | Proper afterEach + restore (OK)                |
| `CLEANUP_INCOMPLETE`       | P10               | Missing cleanup patterns (violation)           |
| `DATA_SOURCING_COMPLIANT`  | P5/P6             | Uses fixture system (OK)                       |
| `DATA_SOURCING_VIOLATION`  | P5/P6             | Shared mutable constants or as any (violation) |
| `ORPHANED_TEST`            | --                | Subject file does not exist (delete)           |
| `DELETE_CANDIDATE`         | --                | Triage: high internal-mock count (review)      |

You still need to read files for P7 (refactor sync -- comparing mock shapes
against current production signatures) and P1 (nuanced public API violations).

## Report Policy

### AST-confirmed tagging

An assessment qualifies for `[AST-confirmed]` tagging when ALL of:

- Confidence is `high`
- `isCandidate: false`
- `requiresManualReview: false`

Examples that qualify:

- `MOCK_INTERNAL_VIOLATION` with high confidence -> `[AST-confirmed]`
- `CLEANUP_INCOMPLETE` with high confidence -> `[AST-confirmed]`
- `AS_ANY_CAST` observation (from ast-type-safety) -> `[AST-confirmed]`
- `ORPHANED_TEST` assessment -> `[AST-confirmed]`

Examples that do NOT qualify:

- `MOCK_DOMAIN_BOUNDARY` -- always `requiresManualReview: true`
- `DELETE_CANDIDATE` -- always `isCandidate: true, requiresManualReview: true`

### Severity bumping

`[AST-confirmed]` findings get +1 concern-level bump.

### Delete threshold (report policy)

`DELETE_CANDIDATE` assessments are emitted when a test file has >= 3
`MOCK_INTERNAL_VIOLATION` assessments. This is a triage heuristic: files
beyond repair should be deleted and rebuilt with `/build-react-test`
rather than refactored. The threshold is configured in `astConfig.testing.deleteThresholdInternalMocks`.

### P1-P10 scoring from assessments

Use assessments to populate the per-file scorecard:

- P2: Count `MOCK_INTERNAL_VIOLATION` assessments (was `OWN_HOOK`, `OWN_COMPONENT`, `OWN_UTILITY`)
- P4: Use `DETECTED_STRATEGY` assessment's `strategyName` evidence for strategy classification
- P5/P6: Use `DATA_SOURCING_VIOLATION` assessments
- P8: Count `ASSERTION_IMPLEMENTATION` and `ASSERTION_SNAPSHOT` assessments
- P10: Use `CLEANUP_INCOMPLETE` assessments

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

| Code              | Pattern                                             | Fix                               |
| ----------------- | --------------------------------------------------- | --------------------------------- |
| P1_HOOK_COUNT     | Asserts own hook was called N times                 | Assert on rendered output instead |
| P1_INTERNAL_STATE | Reads internal state/ref through test-only accessor | Assert on visible behavior        |
| P1_EFFECT_ORDER   | Asserts on effect execution sequence                | Assert on final rendered state    |
| P1_RENDER_COUNT   | Tracks re-render count                              | Remove unless profiling test      |

## Step 4: Audit Principle 2 -- Boundary Mocking

Use `MOCK_BOUNDARY_COMPLIANT`, `MOCK_INTERNAL_VIOLATION`, and `MOCK_DOMAIN_BOUNDARY`
assessments from ast-interpret-test-quality. The interpreter classifies each
`MOCK_DECLARATION` observation:

| Assessment Kind           | Examples                                                                                       | Verdict      |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| `MOCK_BOUNDARY_COMPLIANT` | `fetch`, `fetchApi`, `useFetchApi`, `localStorage`, `next/router`, `firebase/*`                | OK           |
| `MOCK_INTERNAL_VIOLATION` | `vi.mock('../useMyHook')`, `vi.mock('../ChildComponent')`, `vi.mock('../../utils/formatDate')` | P2 violation |
| `MOCK_DOMAIN_BOUNDARY`    | Service hook from different domain (container isolation pattern)                               | Review       |

For each `MOCK_INTERNAL_VIOLATION` assessment, the `basedOn` field references the
`MOCK_DECLARATION` observation with the mock target path and return shape.

**Exception handling**: `MOCK_DOMAIN_BOUNDARY` assessments have `requiresManualReview: true`.
These are mocking patterns that cross domain boundaries (e.g., container test mocking
a service hook). The preferred approach is MSW, but this is a judgment call. Include
these in the Manual Review section, not the violation count.

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

| Signal                                                    | Strategy                    |
| --------------------------------------------------------- | --------------------------- |
| Renders component with props only, no providers           | Unit test                   |
| Renders component wrapped in providers, seeds QueryClient | Integration test            |
| Uses MSW to intercept network at fetch level              | Integration test            |
| Uses Playwright, real browser                             | Playwright integration test |
| Calls a function directly, no rendering                   | Unit test (pure function)   |

Flag strategy mixing:

| Code                         | Pattern                                                            | Fix                                                   |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| P4_UNIT_WITH_QUERYCLIENT     | Unit test seeds `QueryClient` or wraps in `QueryClientProvider`    | Remove provider wrapping or reclassify as integration |
| P4_UNIT_WITH_PROVIDERS       | Unit test wraps in `MockedProviders`, auth providers, etc.         | Push data through props instead                       |
| P4_INTEGRATION_MOCKING_HOOKS | Integration test mocks hooks instead of using MSW                  | Use MSW or push data through props                    |
| P4_MIXED_SIGNALS             | Same file has both pure-props renders and provider-wrapped renders | Split into separate unit and integration files        |

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

| Code               | Pattern                                                | Fix                                |
| ------------------ | ------------------------------------------------------ | ---------------------------------- |
| P5_SHARED_MUTABLE  | Imports mutable test data from another file            | Wrap in factory function or inline |
| P5_CROSS_FILE_DATA | Test file imports data from another test file          | Move to shared factory or inline   |
| P5_STALE_MOCK_DATA | Mock data shape does not match current production type | Update mock data to match type     |

## Step 8: Audit Principle 6 -- Type-Safe Mocks

Use `DATA_SOURCING_VIOLATION` assessments with `asAnyCount` evidence, and
`AS_ANY_CAST` observations from ast-type-safety for precise counts.

| Pattern               | Source                               | Fix                                        |
| --------------------- | ------------------------------------ | ------------------------------------------ |
| `as any` on mock data | `AS_ANY_CAST` observation            | Add explicit type or `satisfies`           |
| `as unknown as T`     | `AS_UNKNOWN_AS_CAST` observation     | Fix mock shape to match T                  |
| Untyped mock          | `DATA_SOURCING_VIOLATION` assessment | Add `satisfies ReturnType<typeof hook>`    |
| Partial mock          | `DATA_SOURCING_VIOLATION` assessment | Use factory that produces complete objects |

### Type safety concentration (report policy)

Flag files with `AS_ANY_CAST` observation count >= 5 as high priority.
This threshold is a skill-level escalation rule configured by the skill,
not the interpreter.

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

| Code                | Pattern                                                | Fix                                |
| ------------------- | ------------------------------------------------------ | ---------------------------------- |
| P7_DELETED_PROVIDER | Mocks/wraps in provider that no longer exists          | Remove mock/wrapper                |
| P7_STALE_HOOK_SHAPE | Mock return shape does not match current hook          | Update mock to match current shape |
| P7_RENAMED_PROP     | Test passes prop name that component no longer accepts | Update prop name                   |
| P7_DEAD_WRAPPER     | Test utility wraps in unnecessary providers            | Simplify render helper             |

## Step 10: Audit Principle 8 -- User Outcomes

Use `ASSERTION_USER_VISIBLE`, `ASSERTION_IMPLEMENTATION`, and `ASSERTION_SNAPSHOT`
assessments from ast-interpret-test-quality. The interpreter classifies each
`ASSERTION_CALL` observation:

| Assessment Kind            | Examples                                                     | Verdict      |
| -------------------------- | ------------------------------------------------------------ | ------------ |
| `ASSERTION_USER_VISIBLE`   | `getByText`, `getByRole`, `toBeVisible`, `toHaveTextContent` | OK           |
| `ASSERTION_IMPLEMENTATION` | Asserts on mock call args, CSS classes, DOM depth            | P8 violation |
| `ASSERTION_SNAPSHOT`       | `toMatchSnapshot()` on large tree                            | P8 violation |

The `basedOn` field references the `ASSERTION_CALL` observation with the
matcher name and expect arg text.

| Pattern            | Assessment Kind            | Fix                                        |
| ------------------ | -------------------------- | ------------------------------------------ |
| CSS class          | `ASSERTION_IMPLEMENTATION` | Assert on visual outcome or aria attribute |
| Large snapshot     | `ASSERTION_SNAPSHOT`       | Replace with targeted assertions           |
| Internal mock args | `ASSERTION_IMPLEMENTATION` | Assert on rendered result of that call     |
| DOM structure      | `ASSERTION_IMPLEMENTATION` | Assert on visible content                  |

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

| Code                | Pattern                                                      | Fix                                             |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| P9_UNMOCKED_DATE    | `new Date()` or `Date.now()` without fake timers             | Add `vi.useFakeTimers()` + `vi.setSystemTime()` |
| P9_UNMOCKED_RANDOM  | `Math.random()` without seed                                 | Mock or seed                                    |
| P9_UNSEEDED_FAKER   | `faker.*` without `faker.seed()` or pool                     | Add seed or use fixture system                  |
| P9_TIMER_NO_CLEANUP | `vi.useFakeTimers()` without `vi.useRealTimers()` in cleanup | Add cleanup                                     |

## Step 12: Audit Principle 10 -- Total Cleanup

Use `CLEANUP_COMPLETE` and `CLEANUP_INCOMPLETE` assessments from ast-interpret-test-quality.
The interpreter analyzes `AFTER_EACH_BLOCK` and `CLEANUP_CALL` observations.

For each test file, check the cleanup story:

### Required cleanup patterns

| Resource                               | Cleanup                                                                   | Where                               |
| -------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| `vi.mock()`                            | `vi.restoreAllMocks()`                                                    | `afterEach`                         |
| `vi.useFakeTimers()`                   | `vi.useRealTimers()`                                                      | `afterEach`                         |
| `vi.setSystemTime()`                   | `vi.useRealTimers()`                                                      | `afterEach`                         |
| `localStorage.setItem()`               | `localStorage.clear()`                                                    | `afterEach`                         |
| `sessionStorage.setItem()`             | `sessionStorage.clear()`                                                  | `afterEach`                         |
| MSW `server.use()`                     | `server.resetHandlers()`                                                  | `afterEach`                         |
| `document.body.innerHTML`              | Reset                                                                     | `afterEach`                         |
| Global spies (`vi.spyOn(window, ...)`) | `spy.mockRestore()` or `vi.restoreAllMocks()`                             | `afterEach`                         |
| QueryClient                            | `queryClient.clear()`                                                     | `afterEach`                         |
| DOM cleanup                            | `cleanup()` from testing-library (auto if using `@testing-library/react`) | Verify auto-cleanup is not disabled |

Classify:

| Code                | Pattern                                                          | Fix                                     |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| P10_NO_AFTEREACH    | File has mocks/timers/storage but no `afterEach`                 | Add `afterEach` with full cleanup       |
| P10_PARTIAL_CLEANUP | `afterEach` exists but does not reset all resources              | Add missing cleanup calls               |
| P10_INLINE_CLEANUP  | Cleanup scattered inside individual tests instead of `afterEach` | Centralize in `afterEach`               |
| P10_NO_MOCK_RESTORE | Mocks created but `vi.restoreAllMocks()` never called            | Add to `afterEach`                      |
| P10_TIMER_LEAK      | Fake timers set up but never restored                            | Add `vi.useRealTimers()` to `afterEach` |
| P10_STORAGE_LEAK    | Storage written but never cleared                                | Add storage clear to `afterEach`        |

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

## Interpreter Calibration Gate

If any interpreter classification is wrong and the misclassification
affected a decision in this skill's workflow:

1. Confirm you investigated and the interpreter is genuinely wrong.
2. Run `/create-feedback-fixture --tool <name> --file <path> --expected <correct-kind> --actual <wrong-kind>`.
3. Note the fixture in the summary output.

Do NOT create a fixture if you are unsure or the error did not affect
a decision.
