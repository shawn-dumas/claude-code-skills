---
name: validate-plan
description: Validate an orchestration plan after pre-flight certification. Runs adversarial review, deep review (verify prompt data against codebase), and PoC gate for risky approaches. Auto-invoked by orchestrate-* skills at Step 8.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task, TodoWrite, Question
argument-hint: The plan file path (e.g., '~/plans/authz-enforcement.md')
---

<!-- role: guidance -->

# Skill: validate-plan

Validate an orchestration plan before execution. `$ARGUMENTS`

This skill runs after pre-flight audit (Step 7) and before the user
gives the "go" signal. It replaces the conditional adversarial review
(old Step 8) with a mandatory multi-layer validation that catches
prompt-level bugs the structural pre-flight audit cannot detect.

### Why this skill exists alongside /pre-flight-plan-audit

The two skills have different scopes, different inputs, and catch
different classes of problems.

`/pre-flight-plan-audit` is a **structural** check. It runs
`ast-plan-audit` (an AST tool that parses markdown) and answers: "Is
this plan well-formed?" It checks that headers exist, prompts are
linked, verification blocks are present, dependencies don't cycle,
reconciliation templates exist, standing elements are triaged. It
cannot tell you whether the content of a prompt is correct -- only
whether the required sections are present.

`/validate-plan` is a **content** check. It reads every prompt and
asks: "Will this actually work when a work agent tries to execute it?"
It verifies import paths resolve, file paths exist, line numbers match,
API signatures are current, constants have the right values, and risky
approaches are PoC'd. It also runs the adversarial review that tries
to find logical errors in the proposed transformations.

Concrete example: during the authz-enforcement plan (2026-03-18),
pre-flight CERTIFIED the plan (structurally complete). The deep review
then found that P03 used the wrong import path (`@/shared/utils/user/
roleChecks` instead of the barrel `@/shared/utils`), P04 had no
guidance on the `@/pages/*` test-only alias, and P04's server module
mocks would crash because `serverEnv` throws at import time. Pre-flight
could never catch any of those -- they are semantic errors in
structurally valid prompts.

The relationship is sequential:

- Pre-flight is fast, mechanical, pass/fail. Runs first (Step 7).
  No point validating content if the plan is missing a verification
  block.
- Validate is slow, judgment-heavy, produces findings. Runs second
  (Step 8). Catches the bugs that structural checks cannot see.

If you collapsed them into one skill, you would either make the
structural check slow or make the content check unreliable by masking
content failures with a false "CERTIFIED" signal.

### Resolve paths

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

---

<!-- role: workflow -->

## Step 0: Read the plan and extract metadata

Read the plan file at `$ARGUMENTS`. Extract:

- Blended score, D/S/Z/F/C
- Branch name
- Prompt file paths (from the prompt table)
- Target repo path

Read ALL prompt files. You need full content for every step below.

---

<!-- role: workflow -->

## Step 1: Conditional dialectic check

If the blended score >= 5.0 OR the plan introduces a new architectural
pattern (new AST tool, new module type, new test infrastructure, new
middleware pattern), check whether a dialectic was already performed.

**How to check:** Look for dialectic output in the plan file (a
`=== DIALECTIC ===` block or a reference to dialectic results in the
Context or Background section).

- If dialectic was done: note it, proceed.
- If dialectic was NOT done and should have been: warn the user.
  Ask whether to run `/dialectic` now (this would happen before
  plan generation, so the plan may need revision) or proceed without.
- If blended < 5.0 and no new architectural pattern: skip. Note "below
  threshold, skipped."

---

<!-- role: workflow -->

## Step 2: Adversarial plan review

Launch the satan plan review. This is NOT conditional on blended score
-- it runs on every plan. The authz-enforcement plan (blended 4.7)
proved that sub-5.0 plans can have real bugs in their prompts.

Use the plan-review prompt from `/spawn-satan`:

1. Read every changed/new file referenced by the plan (plan file +
   all prompt files).
2. Launch a Task sub-agent (type: general) with the plan-review
   critic prompt. Pass it the full content of the plan and all prompts.
3. The critic reviews against: correctness (will the proposed
   transformations work?), completeness (missed files, consumers,
   tests?), architectural fit (project conventions?), risk (blast
   radius?), and prompt quality (verification commands sufficient?).

Collect all findings with severity rankings.

---

<!-- role: detect -->

## Step 3: Deep review (verify prompt data against codebase)

For each prompt file, verify that concrete claims match the actual
codebase. This catches the class of bug where a prompt says "line 74"
but the code has changed, or says `import { X } from '@/foo'` but the
actual import convention is different.

**Tool hierarchy (strict).** All verification in this step MUST follow
the tool hierarchy from AGENTS.md. Use the highest-tier tool available:

| Tier | Tool                               | Use for                                        |
| ---- | ---------------------------------- | ---------------------------------------------- |
| 1    | AST tools (`scripts/AST/ast-*.ts`) | Import graph, exports, type safety, complexity |
| 2    | `sg` (ast-grep)                    | Structural patterns with no AST tool           |
| 3    | `rg` (ripgrep)                     | Text search when structure does not matter     |
| 4    | `grep`                             | Fallback only                                  |

If you use tier 2-4 for a pattern that SHOULD have an AST tool, append
an entry to `scripts/AST/GAPS.md` per the gap-flagging protocol.

### 3a. Verify import paths

For every `import` statement in prompt code examples:

1. Read `tsconfig.json` to confirm path alias resolution.
2. Use `ast-imports` to verify the named export exists at the target:
   ```bash
   npx tsx scripts/AST/ast-query.ts imports <target-file> --pretty --kind EXPORT_DECLARATION
   ```
3. Cross-reference: if a prompt uses `@/shared/utils/user/roleChecks`
   but `ast-imports` shows consumers import from the barrel
   `@/shared/utils`, flag the convention mismatch.

### 3b. Verify file paths and line numbers

For every file path referenced in a prompt:

1. Use the Read tool to verify the file exists on disk (or will be
   created by a prior prompt).
2. If a line number is cited, read the file at that offset and verify
   the content matches what the prompt claims.

### 3c. Verify API signatures

For every function call, type reference, or API usage in prompt code
examples, use AST tools to verify:

- `ast-imports` for export names and import patterns
- `ast-react-inventory` for component declarations, hook calls, prop
  fields (if the prompt references React code)
- `ast-data-layer` for query hook definitions, mutation hooks, fetch
  calls (if the prompt references service hooks)
- `ast-type-safety` for type cast patterns (if the prompt claims a
  file has no `as any` casts)

For API surface checks not covered by an AST tool (e.g., function
parameter counts, return types), use the Read tool to read the source
file directly. Do NOT use `rg` to grep for function signatures -- read
the actual file.

### 3d. Verify constants and configuration values

If the plan references constants, enum members, role groups, or
configuration values, verify they match the actual definitions:

- Use `ast-imports` to find where constants are exported
- Read the source file to verify the constant's value
- For role groups: use `ast-authz-audit` config (`ast-config.ts`) to
  verify canonical file lists and method sets

---

<!-- role: workflow -->

## Step 4: PoC gate

Review the adversarial findings from Step 2. For each finding tagged
"high" or "critical" that involves a novel approach (not just a data
error):

1. Identify the specific risk (e.g., "mock-based middleware introspection
   may not work because module caching", "serverEnv throws at import
   time")
2. Ask the user: "Should I write a throwaway PoC to validate this
   approach before execution?"

If the user says yes:

1. Write a minimal throwaway test that exercises the risky approach
2. Run it
3. If it passes: note the validated approach, delete the throwaway test
4. If it fails: diagnose the failure, update the prompt to fix the
   approach, re-run the PoC until it passes
5. Commit any prompt changes from PoC-driven fixes

If no high/critical findings involve novel approaches, skip this step.
Note "no risky approaches identified, PoC gate skipped."

---

<!-- role: workflow -->

## Step 5: Address all findings

Go through every finding from Steps 2-3, one by one. For each:

- **Accept**: fix the prompt immediately, confirm the fix
- **Reject**: state concretely why the finding is incorrect or out of
  scope

Do not skip any finding. Do not batch them.

After all findings are addressed, if any prompts were modified:

```bash
# Re-run pre-flight to ensure structural validity after edits
npx tsx scripts/AST/ast-plan-audit.ts "$PLAN_FILE" \
  --prompts "$PLANS_DIR/prompts/${PLAN_BASENAME}-*.md" --pretty
```

---

<!-- role: workflow -->

## Step 6: Prework checklist

Before declaring the plan ready for execution, verify:

### 6a. Interpreter calibration

```bash
for f in scripts/AST/ground-truth/fixtures/*/manifest.json; do
  tool=$(python3 -c "import json; print(json.load(open('$f')).get('status',''))")
  [ "$tool" = "pending" ] && echo "PENDING: $f"
done
```

If any interpreter has 3+ pending fixtures, run
`/calibrate-ast-interpreter` before proceeding.

### 6b. Debt file review

```bash
grep -i 'last reviewed' "$PLANS_DIR/KNOWN-DEBT-AND-DECISIONS.md"
```

If the last reviewed date is 4+ days old, pause and review the debt file
before proceeding (per CLAUDE.md protocol).

### 6c. Create the execution branch

```bash
git checkout -b <branch-name>
```

### 6d. Baseline verification

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm test --run
```

Both must pass. Record the baseline test count for comparison after
execution.

### 6e. Verify source data currency

For any prompt that cites specific line numbers, file contents, or
counts from the codebase, re-verify them. Code may have changed between
plan creation and execution (especially if the plan was written in a
previous session).

---

<!-- role: emit -->

## Output summary

```
=== VALIDATE: <plan-name> ===

## Dialectic
- Status: <done | below threshold, skipped | WARNING: not done, should have been>

## Adversarial review
- Findings: <N total>
- Accepted: <N> (fixed)
- Rejected: <N> (with justification)

## Deep review
- Import paths verified: <N checked, N issues>
- File paths verified: <N checked, N issues>
- API signatures verified: <N checked, N issues>
- Constants verified: <N checked, N issues>

## PoC validation
- Risky approaches identified: <N>
- PoCs run: <N>
- Results: <all passed | N required prompt changes>

## Prework
- Pending calibration fixtures: <N>
- Debt file: <current | reviewed | WARNING: stale>
- Branch: <created | already exists>
- Baseline tsc: <0 errors | N errors>
- Baseline tests: <N passed>

## Verdict: <READY FOR EXECUTION | BLOCKED: reason>

=== END VALIDATE ===
```

The plan is ready for execution only if:

- All adversarial and deep review findings are addressed
- All PoCs passed (or none were needed)
- Baseline tsc and tests pass
- No stale debt file (or it was reviewed)
- No pending calibration fixtures above threshold
