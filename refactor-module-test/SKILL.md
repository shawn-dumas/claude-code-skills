---
name: refactor-module-test
description: Audit an existing test file for a non-React module against the 10 testing principles and the current production API, then rewrite it to comply. Applies the delete threshold -- if the file scores <= 4/10, deletes and delegates to build-module-test.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/spec-file.spec.ts>
---

Refactor the test file at `$ARGUMENTS` to comply with the contract-first testing
philosophy adapted for non-React modules. Read the spec, score it, fix or replace it.

## Step 1: Read the spec and its production file

Read the spec file completely. Identify:

- The production module it imports (the subject under test)
- All `vi.mock()` / `vi.spyOn()` targets
- All `describe` / `it` blocks and what they assert
- All `afterEach` / `beforeEach` / `afterAll` / `beforeAll` blocks
- All test data: inline, factory, shared import, fixture system

Then read the production file completely. Record:

- Current exports: function signatures (parameters, return types, async)
- Whether each export is pure or performs I/O
- What it imports (to understand boundaries)

## Step 2: Score against the 10 principles

Score the spec against each principle (OK or VIOLATION with count):

| # | Principle | Score |
|---|-----------|-------|
| 1 | Public API Only | OK / N violations |
| 2 | Boundary Mocking | OK / N violations |
| 3 | System Isolation | OK / N violations |
| 4 | Strict Strategies | OK / N violations |
| 5 | Data Ownership | OK / N violations |
| 6 | Type-Safe Mocks | OK / N violations |
| 7 | Refactor Sync | OK / N violations |
| 8 | Output Assertions | OK / N violations |
| 9 | Determinism | OK / N violations |
| 10 | Total Cleanup | OK / N violations |

Total score = number of principles with zero violations (0-10).

## Step 3: Apply the delete threshold

If ANY of these conditions are met, delete the spec and delegate to
`/build-module-test <production-file-path>`:

| Condition | Threshold |
|-----------|-----------|
| Score <= 4/10 | 6+ principles violated |
| >= 3 own-module mocks | `vi.mock` of non-boundary targets |
| >= 2 stale references | Mocks/calls to deleted functions or changed signatures |
| Strategy inversion | Pure module tested with extensive mocking |
| Copy-paste duplicate | `describe` names a different module than what is imported |

If the threshold is met:
1. Report what was scored, which condition triggered the delete
2. Delete the spec file
3. Run `/build-module-test <production-file-path>` (invoke the skill)
4. Stop -- the build skill handles everything from here

If the score is >= 7/10, proceed to Step 4 (targeted fixes).

If the score is 5-6/10, apply the gray-zone tiebreaker:
- Does the test have meaningful behavioral assertions? -> Fix
- Is > 60% of the file mock setup? -> Delete and rebuild
- Are there < 3 actual test cases? -> Delete and rebuild

## Step 4: Fix violations (targeted, in-place)

Work in this order (each fix may resolve violations in later principles):

### 4a. Fix P7 -- Refactor Sync (stale references)

Fix these first because they block other fixes:

- **Deleted module mocks**: Remove `vi.mock` calls targeting modules that no
  longer exist.
- **Stale signatures**: Update mock return values to match current function
  signatures. Read the production function, compare with the mock.
- **Renamed exports**: Update function calls to match current export names.

### 4b. Fix P2/P3 -- Boundary Mocking + System Isolation

- **Own-function mocks for pure functions**: The function is pure -- remove the
  mock and let the real function run.
- **Own-module mocks for internal helpers**: Remove the mock. The helper is an
  implementation detail.
- **If removing a mock breaks the test**: The test was asserting on mock call
  args (P8 violation). Rewrite the assertion to check the return value.
- **Keep**: Mocks of I/O boundaries (fs, fetch, database, env vars).

### 4c. Fix P4 -- Strict Strategies

- **Pure function with mocks**: Remove all `vi.mock` calls. Call the function
  directly with test data and assert the return value.
- **I/O function with internal mocks**: Keep only the I/O boundary mock. Remove
  mocks of own pure helpers.
- **Mixed file**: Separate pure and I/O tests into distinct `describe` blocks.

### 4d. Fix P6 -- Type-Safe Mocks

- Replace every `as any` with:
  - A fixture builder call
  - An explicit type annotation
  - A `satisfies` clause
- Replace every `as unknown as T` with a properly shaped object
- Use `vi.mocked()` for type-safe mock function access

### 4e. Fix P5 -- Data Ownership

- Replace shared mutable imports with inline data or fixture factory calls
- If the spec imports data from another test file, inline it or use
  `src/fixtures/` builders

### 4f. Fix P10 -- Total Cleanup

The global `vitest.setup.ts` provides `afterEach(() => vi.clearAllMocks())`.
The spec needs additional cleanup only for:

- `vi.useFakeTimers()` -> add `afterEach(() => vi.useRealTimers())`
- `process.env` mutations -> save and restore in `afterEach`
- File system state -> clean up temp files in `afterEach`

Do NOT add redundant `vi.clearAllMocks()`.

### 4g. Fix P9 -- Determinism

- Add `vi.useFakeTimers()` and `vi.setSystemTime()` for date-dependent tests
- Add `faker.seed()` if using faker directly
- Mock `process.cwd()` if tests depend on working directory
- Pair every `vi.useFakeTimers()` with `vi.useRealTimers()` in cleanup

### 4h. Fix P1/P8 -- Public API + Output Assertions

- Replace internal-spy assertions with return-value assertions
- Replace console-output assertions with return-value or thrown-error assertions
- Replace large snapshot matches with targeted property assertions
- For I/O tests: asserting on boundary call arguments (URL, path, body) IS
  acceptable -- these are part of the observable contract

## Step 5: Restructure if needed

After applying fixes, check file structure:

- **Test data at top**: Define reusable test data objects above the tests
- **One describe per export**: Group tests by exported function
- **One test per behavior**: Each `it` block tests one input-output behavior
- **Separate pure and I/O**: If the module exports both, use separate `describe`
  blocks with clear labels

## Step 6: Verify

1. Run `npx tsc --noEmit` -- fix type errors in the spec.
2. Run `pnpm vitest run <path-to-spec>` -- all tests must pass.
3. Re-score against the 10 principles. Must be 10/10.
4. If any principle still has violations after fixes, report which ones
   and why they cannot be fixed without production-code changes.

Report: original score, new score, changes made, tests passing.
