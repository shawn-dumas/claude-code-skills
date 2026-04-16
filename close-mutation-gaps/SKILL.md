---
name: close-mutation-gaps
description: Close stryker mutation survivors in a single target file by adding targeted tests to the existing spec. Parses reports/mutation/mutation.json, classifies each survivor cluster as killable or equivalent, writes tests for killable mutants, and annotates confirmed equivalents with stryker-disable comments.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/production-file.ts>
---

Close mutation survivors in `$ARGUMENTS` by adding targeted tests to the existing spec file.

**Primary mode: sub-agent dispatch, one file per agent.** This skill is shaped for parallel execution -- each invocation is a bounded per-file task with a clear done signal (the Step 7 report). An orchestrator dispatches one agent per file in batches of 3-4. Solo use works for a single small file but does not scale; use dispatch for 3+ files.

<!-- role: workflow -->

## Preconditions

- A stryker run has already produced `reports/mutation/mutation.json` at the repo root. To produce one for the target file: `npx tsx scripts/run-mutation.ts $ARGUMENTS`.
- The target file has at least one Survived or NoCoverage mutant in that report.
- The existing spec file for the target is in `__tests__/<basename>.spec.ts` (same directory) or `__tests__/<basename>.spec.tsx`.
- Tests are currently passing (`pnpm vitest run <spec>` exits 0 before you begin).

If any precondition fails, stop and report which one.

<!-- role: workflow -->

## Step 1: Enumerate survivors

```bash
npx tsx scripts/mutation-survivors.ts $ARGUMENTS
```

This prints a human-readable report of every survivor cluster in the file, grouped by line, with ±3 lines of source context. Read the full output.

For machine-parseable access (to quote in your notes):

```bash
npx tsx scripts/mutation-survivors.ts $ARGUMENTS --json
```

<!-- role: workflow -->

## Step 2: Read the source and spec

- Read the full production file at `$ARGUMENTS`.
- Locate the corresponding spec in `__tests__/<basename>.spec.ts` and read it in full.
- Note the existing test style: how do they construct fixtures, what boundaries are mocked, how are imports wired.

<!-- role: workflow -->

## Step 3: Classify each survivor cluster

For every cluster from Step 1, decide one of two outcomes:

### A. Killable (write a test)

Most survivors are killable. A mutation is killable when it changes observable behavior: a different return value, a different thrown error, a different side effect (toast, navigation, storage write, fetch call, analytics event). Write a test that asserts the behavior the mutation would change.

Common killable patterns and the test that kills them:

| Mutation kind | Example | Test that kills it |
|---|---|---|
| `ConditionalExpression -> false` on an if-guard | `if (x === null) return` -> `if (false) return` | Assert the early-return case actually returns |
| `LogicalOperator && <-> \|\|` | `if (a \|\| b) return` -> `if (a && b) return` | Assert each side independently triggers the branch |
| `StringLiteral -> "Stryker was here!"` | `if (s === '') return null` -> `if (s === "Stryker was here!") ...` | Assert the original literal value triggers the branch |
| `BooleanLiteral true <-> false` | `const enabled = true` -> `const enabled = false` | Assert the behavior that depends on the truth value |
| `ArithmeticOperator + <-> -` | `timeout + 100` -> `timeout - 100` | Assert the exact numerical outcome |
| `ArrayDeclaration -> []` | `return [id]` -> `return []` | Assert array length or first element |
| `ObjectLiteral -> {}` | `return { a, b }` -> `return {}` | Assert object property exists |
| `OptionalChaining` mutation | `obj?.prop` -> `obj.prop` | Assert the nullish path doesn't throw |
| `MethodExpression` mutation | `.filter(x => x > 0)` -> `.filter(() => true)` | Assert the filter actually discards |
| `BlockStatement -> {}` | function body replaced with empty | Assert the function produces its expected output |

For each killable cluster, write ONE test per distinct observable behavior -- not one per mutation. A single assertion often kills 5-10 mutations at once (see the url-params.ts:40 example: one "returns null for null" test + one "returns null for empty string" test kills all 5 survivors on that line).

### B. Equivalent mutant (annotate the source)

A mutation is equivalent when it produces behavior observationally identical to the original. Common equivalent patterns:

- **Log messages** that aren't asserted on: `console.log('[fsm hook error] point=' + label)` -> mutations on the string template do not change user-visible behavior.
- **Order-independent array operations** that stryker mutates: `.sort((a,b) => a-b)` -> `.sort((a,b) => b-a)` when the output is only asserted to `contain` elements, not to be in order.
- **Convergent fall-through paths**: an early-return and a fall-through that produce the same output (e.g., `parseFloat(null)=NaN` causing `return tz` to return null, same as the original null early-return).

**Patterns that LOOK equivalent but usually aren't:**

- ~~"Defensive no-op guards"~~ -- these are often reachable via crafted input (passthrough page keys, SSR environments where `typeof window === 'undefined'`). Test them or refactor to fail-loud.
- ~~"Jsdom-unreachable branches"~~ -- jsdom-testing-mocks can mock `typeof window`; these are test gaps, not equivalents.
- ~~"Empty-array function-call no-ops"~~ -- `fn([])` may be behaviorally a no-op but the CALL is observable via a spy. Assert the spy was NOT called.
- ~~"Redundant nested guards"~~ -- dispatch crafted inconsistent state (e.g., outer-guard-valid, inner-guard-invalid) and assert the side effect does NOT fire.

When you confirm equivalence, add a stryker-disable comment to the SOURCE FILE at the mutation line. **Stryker syntax (NOT eslint syntax):**

```ts
// Stryker disable next-line <MutatorName>: <one-line reason>
```

Capital `S`, spaces between words, colon before reason. NOT `// stryker-disable-next-line` (eslint convention -- stryker ignores it silently). Multiple mutators: `// Stryker disable next-line ConditionalExpression,EqualityOperator: reason`.

Only use `// Stryker disable all` (file-level, top) when an entire file is dominated by log strings or similar -- extremely rare. Default to per-line annotations.

**If you are not confident a mutation is equivalent, write a test.** A test is cheap; a stale stryker-disable is a lie in the codebase.

<!-- role: workflow -->

## Step 3C: Falsifiability check (required before any annotation)

Before annotating ANY mutation as equivalent, write out the test that WOULD kill it, in the report you produce at Step 7. Format:

```
candidate equivalent: <file>:<line> <MutatorName>
falsifying test (hypothetical): <one-sentence description of the test that would kill this mutation>
why it cannot be written: <the specific constraint that makes the falsifying test impossible>
```

Examples:

**Valid equivalent (falsifying test cannot be written):**
```
candidate equivalent: url-params.ts:40 ConditionalExpression (tz === null -> false)
falsifying test: call migrateNumericTz with an input that distinguishes early-return from fall-through
why it cannot be written: parseFloat(null)=NaN causes fall-through to "return tz" which returns null -- the same output as the early-return. No input distinguishes the two paths at the function boundary.
```

**Invalid equivalent claim (falsifying test CAN be written; write it instead):**
```
candidate equivalent: urlStateController.ts:338 EqualityOperator (notifications.length > 0 -> >= 0)
falsifying test: spy fireNotifications; dispatch an event where the broadcast hook returns no notifications; assert fireNotifications was NOT called.
why it cannot be written: <cannot answer -- the test is writable>
```

If the "why it cannot be written" field is empty, weak, or speculative, the mutation is NOT equivalent. Write the falsifying test.

**The falsifying-test enumeration is the gate.** An annotation without a documented failed attempt at falsification is incorrect. Reviewers will apply this check and any annotation that fails it becomes a test to add.

<!-- role: workflow -->

## Step 4: Write the tests

Add tests to the EXISTING spec file. Do not create a new spec. The new tests must:

- Follow the file's existing test style (fixture use, mock patterns, describe/it structure).
- Assert on observable output -- return values, thrown errors, side effects on mocked boundaries.
- Not touch internal state or private exports.
- Not mock internal collaborators the existing tests don't mock.
- Sit near related tests (e.g., if the target is a conditional branch in `fooHandler`, place the new test inside the `fooHandler` describe block if one exists).

If the spec uses a fixture builder, use it. If it uses `buildStandardScenario`, use it. Match the file's patterns.

<!-- role: workflow -->

## Step 5: Verify tests pass

```bash
pnpm vitest run <path/to/spec>
```

All tests must pass. If a new test fails, either:
- The production code has a bug (the test is revealing it -- stop and report).
- The test is wrong (the assertion doesn't match the actual behavior -- fix the test).

Do not commit failing tests.

<!-- role: workflow -->

## Step 6: Run targeted stryker to verify kill rate (optional but recommended)

If time permits, re-run stryker against just this file and confirm the kill rate improved:

```bash
npx tsx scripts/run-mutation.ts $ARGUMENTS
```

This invokes stryker with `--mutate $ARGUMENTS` so no config edits are needed. The final verification is the full rerun in Step 8 (after all files are closed).

<!-- role: workflow -->

## Step 7: Report

Output a summary in this exact format:

```
close-mutation-gaps report -- <target-file>

before: N survived, M no-cov
tests added: K
stryker-disable annotations: J (each with reason)
remaining unkilled: L (with justification)

tests added:
  - <test name 1>: kills mutants [<ids>]
  - <test name 2>: kills mutants [<ids>]
  ...

annotations added:
  - line X: <MutatorName> -- <reason>
  ...

remaining:
  - line Y, mutator Z: <why you left it>
  ...
```

<!-- role: workflow -->

## Step 8: Do NOT run the full stryker suite from this skill

The full rerun is driven by the orchestrator after every file is closed. Running it here wastes ~10 minutes per file invocation.

<!-- role: notes -->

## Notes for the orchestrator

- This skill is idempotent per file: running it a second time after a new stryker report picks up any remaining survivors.
- The skill does NOT modify stryker.config.json.
- The skill does NOT commit or push; the caller handles git.
- The skill's output is the summary in Step 7; use that to reconcile kill totals across files.
