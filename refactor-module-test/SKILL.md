---
name: refactor-module-test
description: Audit an existing test file for a non-React module against the 10 testing principles and the current production API, then rewrite it to comply. Applies the delete threshold -- if the file scores <= 4/10, deletes and delegates to build-module-test.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/spec-file.spec.ts>
---

Refactor the test file at `$ARGUMENTS` to comply with the contract-first testing
philosophy adapted for non-React modules. Read the spec, score it, fix or replace it.

<!-- role: workflow -->

## Step 0: Run AST analysis tools

```bash
npx tsx scripts/AST/ast-test-analysis.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-type-safety.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-interpret-test-quality.ts $ARGUMENTS --pretty
```

Use the test quality assessments to pre-score the spec before reading
it manually. The interpreter classifies observations into assessments:

**Mock assessments (P2/P3):**

- `MOCK_BOUNDARY_COMPLIANT` -- mocks external boundaries only (OK)
- `MOCK_INTERNAL_VIOLATION` -- mocks own functions/utilities (violation)

**Assertion assessments (P8):**

- `ASSERTION_USER_VISIBLE` -- asserts on return values (OK for modules)
- `ASSERTION_IMPLEMENTATION` -- asserts on internal spy counts (violation)
- `ASSERTION_SNAPSHOT` -- large snapshot assertion (flag for review)

**Cleanup assessments (P10):**

- `CLEANUP_COMPLETE` -- proper afterEach patterns (OK)
- `CLEANUP_INCOMPLETE` -- missing cleanup (violation)

**Strategy assessment (P4):**

- `DETECTED_STRATEGY` with `subject.symbol` of `unit-pure` or `unit-render`

**Delete gate (Step 3):**

- `DELETE_CANDIDATE` assessment triggers delete-and-rebuild

<!-- role: workflow -->

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

<!-- role: detect -->

## Step 2: Score against the 10 principles

Score the spec against each principle (OK or VIOLATION with count):

| #   | Principle         | Score             |
| --- | ----------------- | ----------------- |
| 1   | Public API Only   | OK / N violations |
| 2   | Boundary Mocking  | OK / N violations |
| 3   | System Isolation  | OK / N violations |
| 4   | Strict Strategies | OK / N violations |
| 5   | Data Ownership    | OK / N violations |
| 6   | Type-Safe Mocks   | OK / N violations |
| 7   | Refactor Sync     | OK / N violations |
| 8   | Output Assertions | OK / N violations |
| 9   | Determinism       | OK / N violations |
| 10  | Total Cleanup     | OK / N violations |

Total score = number of principles with zero violations (0-10).

<!-- role: workflow -->

## Step 3: Apply the delete threshold

Check the assessments from `ast-interpret-test-quality`. If ANY of these
conditions are met, delete the spec and delegate to
`/build-module-test <production-file-path>`:

| Condition                     | Assessment Signal                                                         |
| ----------------------------- | ------------------------------------------------------------------------- |
| `DELETE_CANDIDATE` assessment | `DELETE_CANDIDATE` with `isCandidate: true`                               |
| >= 3 internal mock violations | Count `MOCK_INTERNAL_VIOLATION` assessments                               |
| Strategy inversion            | `DETECTED_STRATEGY` is `integration-providers` but subject is pure module |
| Orphaned test                 | `ORPHANED_TEST` assessment present                                        |

**Scoring from assessments:**

Count violations per principle from assessment kinds:

- P2/P3: Count `MOCK_INTERNAL_VIOLATION` assessments (each = 1 violation)
- P6: Count `AS_ANY_CAST` and `AS_UNKNOWN_AS_CAST` type safety observations
- P8: Count `ASSERTION_IMPLEMENTATION` assessments
- P10: Check for `CLEANUP_INCOMPLETE` assessment

Score = 10 - (principles with violations). Delete threshold is score <= 4.

If the threshold is met:

1. Report what was scored, which condition triggered the delete
2. Delete the spec file
3. Run `/build-module-test <production-file-path>` (invoke the skill)
4. Stop -- the build skill handles everything from here

If the score is >= 7/10, proceed to Step 4 (targeted fixes).

If the score is 5-6/10, apply the gray-zone tiebreaker:

- Does the test have meaningful behavioral assertions? -> Fix
- Is > 60% of the file mock setup (count `MOCK_DECLARATION` observations)? -> Delete and rebuild
- Are there < 3 actual test cases (count `TEST_BLOCK` observations)? -> Delete and rebuild

<!-- role: emit -->

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

<!-- role: guidance -->

## Step 5: Restructure if needed

After applying fixes, check file structure:

- **Test data at top**: Define reusable test data objects above the tests
- **One describe per export**: Group tests by exported function
- **One test per behavior**: Each `it` block tests one input-output behavior
- **Separate pure and I/O**: If the module exports both, use separate `describe`
  blocks with clear labels

<!-- role: workflow -->

## Step 6: Verify

1. Run `npx tsc --noEmit -p tsconfig.check.json` -- fix type errors in the spec.
2. Run `pnpm vitest run <path-to-spec>` -- all tests must pass.
3. Re-score against the 10 principles. Must be 10/10.
4. If any principle still has violations after fixes, report which ones
   and why they cannot be fixed without production-code changes.

### Step 6b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher on the refactored
spec file. **This step is mandatory.** Do not skip it. Do not report
success without running it and including the output in your summary.

```bash
npx tsx scripts/AST/ast-refactor-intent.ts <path-to-spec> --pretty
```

Check the output:

- **0 UNMATCHED**: proceed to summary.
- **Any UNMATCHED**: investigate. Unmatched signals mean test coverage
  was lost during the refactor.

### Step 6c: Vitest parity check (MANDATORY for spec file refactors)

Run vitest parity to verify the refactored spec preserves test coverage
relative to the original.

```bash
npx tsx scripts/AST/ast-interpret-vitest-parity.ts \
  --source <path-to-original-spec> \
  --target <path-to-refactored-spec> \
  --pretty
```

Check the output:

- **All PARITY or EXPANDED**: proceed to summary.
- **Any REDUCED**: investigate. Fewer assertions in matched tests.
- **Any NOT_PORTED**: investigate. Source tests with no target match.

Report: original score, new score, changes made, tests passing, intention
matcher results (matched/unmatched/novel counts), parity results
(matched/reduced/not-ported counts).

<!-- role: workflow -->

## Interpreter Calibration Gate

If any interpreter classification is wrong and the misclassification
affected a decision in this skill's workflow:

1. Confirm you investigated and the interpreter is genuinely wrong.
2. Run `/create-feedback-fixture --tool <name> --file <path> --expected <correct-kind> --actual <wrong-kind>`.
3. Note the fixture in the summary output.

Do NOT create a fixture if you are unsure or the error did not affect
a decision.
