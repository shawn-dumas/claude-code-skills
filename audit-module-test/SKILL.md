---
name: audit-module-test
description: Audit test files for non-React modules against testing principles adapted from the contract-first philosophy. Detects internal mocking, stale mocks, missing cleanup, type-unsafe mocks, and non-determinism.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/spec-file-or-directory>
---

Audit the test files at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a structured report scoring every spec file against
the 10 testing principles adapted for non-React modules.

If the argument is a directory, audit all `.spec.ts` and `.test.ts` files in
that directory and its subdirectories. If it is a single file, audit that file
only.

## Background: The 10 Principles (Module Adaptation)

These are the same contract-first principles used by `audit-react-test`, adapted
for non-React code (utilities, server processors, API handlers, data transformers).

| #   | Principle         | Module interpretation                                                                                                      |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P1  | Public API Only   | Assert on return values and thrown errors, not on how internal helpers achieved the result                                 |
| P2  | Boundary Mocking  | Mock only I/O boundaries (fs, fetch, database, env vars, timers). Never mock own pure functions or own internal helpers    |
| P3  | System Isolation  | Let real internal functions run. Do not mock modules from the same codebase unless they perform I/O                        |
| P4  | Strict Strategies | Pure functions: zero mocks. I/O functions: boundary mocks only. No mixing                                                  |
| P5  | Data Ownership    | Each test owns its data. Use fixture builders or inline data. No shared mutable constants                                  |
| P6  | Type-Safe Mocks   | No `as any` in mock data. Use `satisfies`, explicit types, or fixture builders                                             |
| P7  | Refactor Sync     | Mocks match current production signatures. No stale mock shapes                                                            |
| P8  | Output Assertions | Assert on return values, resolved/rejected promises, thrown errors. Not on console output or internal function call counts |
| P9  | Determinism       | Mock `Date`, `Math.random`, timers, faker seed. No flaky time-dependent tests                                              |
| P10 | Total Cleanup     | Pair every mock/spy/timer/storage write with cleanup in `afterEach`                                                        |

## Step 0: Run AST analysis tools and interpreters

```bash
# --- Observation-producing tools ---

# Test file analysis (emits MOCK_DECLARATION, ASSERTION_CALL, AFTER_EACH_BLOCK,
# CLEANUP_CALL, FIXTURE_IMPORT, SHARED_MUTABLE_IMPORT, TEST_SUBJECT_IMPORT observations)
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
- `AFTER_EACH_BLOCK`, `CLEANUP_CALL` observations: cleanup presence
- `FIXTURE_IMPORT`, `SHARED_MUTABLE_IMPORT` observations: data sourcing signals

**Assessments** from ast-interpret-test-quality classify these observations:

| Assessment Kind            | Maps to Principle | Meaning                                                      |
| -------------------------- | ----------------- | ------------------------------------------------------------ |
| `MOCK_BOUNDARY_COMPLIANT`  | P2                | Mock targets only I/O boundaries (OK)                        |
| `MOCK_INTERNAL_VIOLATION`  | P2                | Mocks own pure function/internal helper (violation)          |
| `MOCK_DOMAIN_BOUNDARY`     | P2                | Mocks I/O module from same codebase (review)                 |
| `ASSERTION_USER_VISIBLE`   | P8                | Asserts on return value/thrown error (OK)                    |
| `ASSERTION_IMPLEMENTATION` | P8                | Asserts on console output or internal call count (violation) |
| `DETECTED_STRATEGY`        | P4                | Records detected strategy (neutral)                          |
| `CLEANUP_COMPLETE`         | P10               | Proper afterEach + restore (OK)                              |
| `CLEANUP_INCOMPLETE`       | P10               | Missing cleanup patterns (violation)                         |
| `DATA_SOURCING_COMPLIANT`  | P5/P6             | Uses fixture system or inline data (OK)                      |
| `DATA_SOURCING_VIOLATION`  | P5/P6             | Shared mutable constants or as any (violation)               |
| `ORPHANED_TEST`            | --                | Subject file does not exist (delete)                         |
| `DELETE_CANDIDATE`         | --                | Triage: high internal-mock count (review)                    |

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
- `AS_ANY_CAST` observation -> `[AST-confirmed]`
- `ORPHANED_TEST` assessment -> `[AST-confirmed]`

### Severity bumping

`[AST-confirmed]` findings get +1 concern-level bump.

### Delete threshold (report policy)

`DELETE_CANDIDATE` assessments are emitted when a test file has >= 3
`MOCK_INTERNAL_VIOLATION` assessments. This is a triage heuristic configured
in `astConfig.testing.deleteThresholdInternalMocks`.

### P1-P10 scoring from assessments

Use assessments to populate the per-file scorecard:

- P2: Count `MOCK_INTERNAL_VIOLATION` assessments
- P4: Use `DETECTED_STRATEGY` assessment for strategy classification
- P5/P6: Use `DATA_SOURCING_VIOLATION` assessments
- P8: Count `ASSERTION_IMPLEMENTATION` assessments
- P10: Use `CLEANUP_INCOMPLETE` assessments

## Step 1: Inventory test files

Glob for all `.spec.ts`, `.test.ts` files in the target path. For each file, record:

- File path
- The production module it imports (the subject under test)
- Whether the production module still exists (if not, mark ORPHANED)
- Number of `describe` blocks, `test`/`it` blocks
- Test runner detected (Vitest or other -- check imports)

## Step 2: Check for orphaned tests

For each test file, verify the production file it imports still exists:

- If the test imports from a path that does not resolve, flag as **ORPHANED**
- Check whether any `vi.mock()` target module still exists

## Step 3: Audit P1 -- Public API Only

For each test, check whether it asserts on internal implementation details:

| Code              | Pattern                                                                  | Fix                                                                       |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| P1_INTERNAL_SPY   | `vi.spyOn` on an internal helper, asserts call count                     | Assert on the return value of the public function instead                 |
| P1_INTERNAL_STATE | Accesses module-level variables through backdoor                         | Assert on exported function behavior                                      |
| P1_CONSOLE_ASSERT | `expect(console.log).toHaveBeenCalledWith(...)` as the primary assertion | Assert on return value; console output is a side effect, not the contract |

The public API is: exported function arguments in, return value (or thrown error) out.

## Step 4: Audit P2 -- Boundary Mocking

Use `MOCK_BOUNDARY_COMPLIANT`, `MOCK_INTERNAL_VIOLATION`, and `MOCK_DOMAIN_BOUNDARY`
assessments from ast-interpret-test-quality. The interpreter classifies each
`MOCK_DECLARATION` observation:

| Assessment Kind           | Examples                                                                  | Verdict      |
| ------------------------- | ------------------------------------------------------------------------- | ------------ |
| `MOCK_BOUNDARY_COMPLIANT` | `fs`, `fs/promises`, `fetch`, `fetchApi`, database clients, `process.env` | OK           |
| `MOCK_INTERNAL_VIOLATION` | Mocking a pure utility or unexported helper from the same codebase        | P2 violation |
| `MOCK_DOMAIN_BOUNDARY`    | Mocking an I/O module from the same codebase                              | Review       |

## Step 5: Audit P3 -- System Isolation

Check whether tests mock modules from the same codebase that are pure (no I/O):

| Code                  | Pattern                                                     | Fix                            |
| --------------------- | ----------------------------------------------------------- | ------------------------------ |
| P3_MOCKED_PURE_MODULE | `vi.mock('../utils/formatDate')` where `formatDate` is pure | Remove mock, use real function |
| P3_MOCKED_SIBLING     | `vi.mock('./helperModule')` where helper has no I/O         | Remove mock, use real module   |

If the mocked sibling DOES perform I/O (file reads, API calls), the mock is acceptable.

## Step 6: Audit P4 -- Strict Strategies

Classify each test file's strategy:

| Module type                  | Expected strategy                                                       | Violation                                             |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Pure function (no I/O)       | Zero mocks, direct call + assert                                        | Mocking anything is a violation                       |
| I/O function (fs, fetch, DB) | Boundary mocks only                                                     | Mocking own pure helpers alongside I/O is a violation |
| Mixed pure+I/O module        | Separate tests: pure parts with no mocks, I/O parts with boundary mocks | Strategy mixing in the same test block                |

| Code                    | Pattern                                                                     | Fix                                          |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| P4_PURE_WITH_MOCKS      | Pure function test has `vi.mock` calls                                      | Remove all mocks                             |
| P4_IO_MOCKING_INTERNALS | I/O test mocks own pure functions instead of just I/O boundaries            | Mock only the I/O boundary                   |
| P4_MIXED_STRATEGY       | Same `describe` block has both pure and I/O tests with inconsistent mocking | Split into separate describe blocks or files |

## Step 7: Audit P5 -- Data Ownership

| Code               | Pattern                                                | Fix                               |
| ------------------ | ------------------------------------------------------ | --------------------------------- |
| P5_SHARED_MUTABLE  | Imports mutable test data from another file            | Wrap in factory or inline         |
| P5_CROSS_FILE_DATA | Test file imports data from another test file          | Move to fixture builder or inline |
| P5_STALE_MOCK_DATA | Mock data shape does not match current production type | Update to match                   |

## Step 8: Audit P6 -- Type-Safe Mocks

Use `DATA_SOURCING_VIOLATION` assessments with `asAnyCount` evidence, and
`AS_ANY_CAST` observations from ast-type-safety for precise counts.

| Pattern           | Source                               | Fix                                    |
| ----------------- | ------------------------------------ | -------------------------------------- |
| `as any`          | `AS_ANY_CAST` observation            | Add explicit type or `satisfies`       |
| `as unknown as T` | `AS_UNKNOWN_AS_CAST` observation     | Fix mock shape to match T              |
| Untyped mock      | `DATA_SOURCING_VIOLATION` assessment | Add type annotation                    |
| Partial mock      | `DATA_SOURCING_VIOLATION` assessment | Use fixture builder or complete object |

## Step 9: Audit P7 -- Refactor Sync

| Code              | Pattern                                                     | Fix                    |
| ----------------- | ----------------------------------------------------------- | ---------------------- |
| P7_DELETED_MODULE | Mock targets a module path that no longer exists            | Remove mock            |
| P7_STALE_SHAPE    | Mock return shape does not match current function signature | Update mock            |
| P7_RENAMED_EXPORT | Test calls a function that was renamed or removed           | Update to current name |

## Step 10: Audit P8 -- Output Assertions

Use `ASSERTION_IMPLEMENTATION` assessments from ast-interpret-test-quality.

| Pattern           | Assessment Kind            | Fix                                       |
| ----------------- | -------------------------- | ----------------------------------------- |
| Console-only      | `ASSERTION_IMPLEMENTATION` | Assert on return value or thrown error    |
| Internal call cnt | `ASSERTION_IMPLEMENTATION` | Assert on output instead                  |
| Large snapshot    | `ASSERTION_SNAPSHOT`       | Replace with targeted property assertions |

## Step 11: Audit P9 -- Determinism

| Code                 | Pattern                                                           | Fix                                             |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| P9_UNMOCKED_DATE     | `new Date()` or `Date.now()` in test path without fake timers     | Add `vi.useFakeTimers()` + `vi.setSystemTime()` |
| P9_UNMOCKED_RANDOM   | `Math.random()` or `crypto.randomUUID()` without mock             | Mock or seed                                    |
| P9_UNSEEDED_FAKER    | `faker.*` calls without `faker.seed()` or pool                    | Add seed                                        |
| P9_TIMER_NO_CLEANUP  | `vi.useFakeTimers()` without `vi.useRealTimers()` in cleanup      | Add cleanup                                     |
| P9_FS_PATH_DEPENDENT | Tests depend on absolute paths or `process.cwd()` without mocking | Mock `process.cwd()` or use relative paths      |

## Step 12: Audit P10 -- Total Cleanup

Use `CLEANUP_COMPLETE` and `CLEANUP_INCOMPLETE` assessments from ast-interpret-test-quality.
The interpreter analyzes `AFTER_EACH_BLOCK` and `CLEANUP_CALL` observations.

| Pattern         | Assessment Kind      | Fix                             |
| --------------- | -------------------- | ------------------------------- |
| No afterEach    | `CLEANUP_INCOMPLETE` | Add `afterEach`                 |
| Partial cleanup | `CLEANUP_INCOMPLETE` | Add missing cleanup             |
| No mock restore | `CLEANUP_INCOMPLETE` | Add to `afterEach`              |
| Env leak        | `CLEANUP_INCOMPLETE` | Save and restore in `afterEach` |
| Timer leak      | `CLEANUP_INCOMPLETE` | Add `vi.useRealTimers()`        |

## Step 13: Coverage gap analysis

For each production file in the target directory (or the production file's directory)
that has NO corresponding test file:

- Record the file path
- Classify it (utility, server processor, API handler, etc.)
- Estimate complexity (line count, function count, branching)
- Flag as UNTESTED with priority based on complexity and consumer count

## Step 14: Produce the audit report

```
## Module Test Audit: <target>

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
| 8 | Output Assertions | ... | ... |
| 9 | Determinism | ... | ... |
| 10 | Total Cleanup | ... | ... |

### Orphaned tests (delete immediately)
| Test file | Missing production file | Action |
|-----------|----------------------|--------|
| ... | ... | Delete test file |

### Per-file scorecard
| Test file | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | Score |
|-----------|----|----|----|----|----|----|----|----|----|----|-------|
| ... | OK | 2 | OK | 1 | OK | 3 | OK | OK | 1 | 1 | 5/10 |

Score = number of principles with zero violations (0-10, higher is better).

### Detailed violations
| File:Line | Principle | Code | Description | Fix |
|-----------|-----------|------|-------------|-----|
| ... | P2 | P2_OWN_PURE | Mocks formatDate utility | Remove mock, use real function |

### Coverage gaps
| Production file | Classification | Complexity | Has test? | Priority |
|----------------|---------------|-----------|-----------|----------|
| ... | server processor | 438 lines, ~25 complexity | No | HIGH |
| ... | utility | 50 lines, ~3 complexity | No | LOW |

### Migration priority (files sorted by violation count)
| # | Test file | Violations | Top violations | Action |
|---|-----------|-----------|---------------|--------|
| 1 | ... | 8 | P2 (3), P6 (3) | Rewrite (use build-module-test) |
| 2 | ... | 3 | P10 (2), P9 (1) | Fix in place |
```

## Interpreter Calibration Feedback

If `ast-interpret-test-quality` misclassifies during this audit (e.g.,
classifies a boundary-compliant mock as MOCK_INTERNAL_VIOLATION, or
classifies a return-value assertion as ASSERTION_IMPLEMENTATION), create
a calibration fixture following the **test-quality** template in
`scripts/AST/docs/ast-feedback-loop.md`.

Note the fixture in the summary: "Created calibration fixture:
`feedback-<date>-<description>`. Run `/calibrate-ast-interpreter
--tool test-quality` when 3+ pending fixtures accumulate."
