---
name: orchestrate-bug-fix
description: Orchestrate a multi-file bug fix. Investigates the codebase, generates targeted fix prompts with verification commands, and coordinates work agents to execute them in sequence.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task
argument-hint: <bug description>
---

Orchestrate a bug fix. `$ARGUMENTS`

You are now the orchestrator. You coordinate work agents but do NOT write
production code yourself. Read the Orchestration Protocol section of
`~/.claude/CLAUDE.md` before proceeding -- it defines the rules you must follow.

### Resolve $PLANS_DIR

Before any file operations, determine the plans directory:

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

Use `$PLANS_DIR` for all plan/prompt/cleanup file paths below. Create the
directory (and `$PLANS_DIR/prompts/`) if it does not exist.

## Step 1: Parse the bug description

Extract from the argument:
- What is broken (the symptom)
- Where the user observed it (page, route, interaction)
- Any file paths or component names mentioned

If the description is vague, ask clarifying questions before proceeding.

## Step 2: Investigate the codebase

Read `~/github/user-frontend/CLAUDE.md` for project conventions.

Then investigate the bug:

1. **Locate the symptom.** Search for the component, route, or feature
   mentioned in the bug description. Read the relevant files.

2. **Trace the data flow.** Follow the data from the service hook through
   the container to the component where the bug manifests. Identify every
   file in the chain.

3. **Identify the root cause.** Determine what is actually wrong -- stale
   state, missing sync, wrong prop threading, race condition, schema
   mismatch, etc.

4. **Map the blast radius.** Find all files that need to change to fix the
   bug properly. Check for related patterns in other files that might have
   the same issue.

5. **Check for existing tests.** Read any specs covering the affected code.
   Note which behaviors are already tested and which are not.

## Step 3: Decide whether to orchestrate

If the fix touches fewer than 3 files in the same domain, do NOT
orchestrate. Tell the user: "This is a single-prompt fix. Run it directly
instead of orchestrating." Then output the fix as a single prompt.

If the fix spans 3+ files across different domains, or requires phased
implementation, proceed with orchestration.

## Step 4: Assess integration test scope

Determine whether the bug fix touches code exercised by Playwright
integration tests. Read the integration test scope rules in
`~/.claude/CLAUDE.md` (Orchestration Protocol > Integration test scope).

- If the fix modifies files in `integration/` (specs, POMs, fixtures,
  constants, mock handler), scope is `per-prompt`.
- If the fix modifies production UI code (components, containers, hooks,
  providers, page blocks, navigation, URL params), scope is `final-only`.
- If the fix is types-only, unit test infrastructure, or documentation,
  scope is `none`.

Record the scope in the master plan header. Reference it when generating
prompt verification sections and the orchestrator verification loop.

## Step 5: Generate the master plan

Create `$PLANS_DIR/<bug-name>-fix.md` with:

```markdown
# Bug Fix: <title>

> <one-line description of the bug>

## Root Cause

<what is actually wrong, with file paths and line numbers>

## Affected Files

| File | Role | What changes |
|------|------|-------------|
| <path> | <container/component/hook/etc.> | <what needs to change> |

## Fix Strategy

<how the fix is structured, why this ordering>

## Prompt Sequence

| # | Prompt | What | Status |
|---|--------|------|--------|
| 1 | <name> | <summary> | pending |
| 2 | <name> | <summary> | pending |

## Verification

<what should be true after all prompts complete>

## Verification Checklist

<if integration scope is per-prompt or final-only, include this table>

| # | Agent Ran PW? | Orchestrator Ran PW? | Results Match? | PASS/FAIL |
|---|---------------|----------------------|----------------|-----------|
| 1 | | | | |
| 2 | | | | |
```

## Step 5: Generate the master plan

NOTE: Include the integration test scope in the master plan header, e.g.:
`> Integration scope: per-prompt | final-only | none`

## Step 6: Generate fix prompts

Create prompt files in `$PLANS_DIR/prompts/` named `<bug-name>-fix-NN.md`.

Each prompt follows this structure:

```markdown
# Fix Prompt: <title>

## Context
- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: $PLANS_DIR/<bug-name>-fix.md
- Cleanup file: $PLANS_DIR/<bug-name>-fix-cleanup.md (append to it)

Read ~/github/user-frontend/CLAUDE.md before starting.

## Fixes

### Fix N: <title>
<file path and line> -- <what is wrong>.

<what to do to fix it>

<if this changes observable behavior>
This fix changes observable behavior. Write a failing test BEFORE applying
the fix. Confirm it fails (red), apply the fix, confirm it passes (green).
Use /build-react-test or /build-module-test as appropriate.

<if structural only>
No test needed (<reason>).

## Commit Strategy
<how many commits, what goes in each>

## Verification

Run ALL of the following in ~/github/user-frontend and paste the output:

\`\`\`bash
pnpm tsc --noEmit
pnpm test --run
pnpm build
npx eslint . --max-warnings 0
\`\`\`

<if integration scope is per-prompt and this prompt touches integration files>
\`\`\`bash
pnpm test:integration
\`\`\`
<if integration scope is final-only and this is the last prompt>
\`\`\`bash
pnpm test:integration
\`\`\`

Prompt-specific checks:

\`\`\`bash
# <description of what this verification checks>
<search command (AST tool --count, sg, or rg per tool hierarchy) that should return 0 hits after the fix>
\`\`\`

## Reconciliation

When all fixes are applied and all verification passes, output this block
exactly:

\`\`\`
=== RECONCILIATION: <Prompt Name> ===
HEAD: <sha>
Commits: <count> (<sha>..<sha>)
tsc: <0 errors | N errors>
Tests: <N specs, M passed, K todo>
Build: <clean | failed>
ESLint: <clean | N errors, M warnings>
Integration: <N passed, M failed (Xm) | not run | skipped (scope: none)>

Prompt-Specific:
  <each verification result>

Behavioral Changes:
  <1-3 lines describing what changed in user-visible terms>

Cleanup Items Added: <N items>
Subsequent Prompts Modified: <none | list>
Deviations: <none | list>
Work Left Undone: <none | list>
=== END RECONCILIATION ===
\`\`\`
```

### Prompt generation rules

- Every fix that changes observable behavior (bug fix, guard addition,
  error handling change) MUST require a failing test before the fix
- Every fix includes verification commands (AST tool `--count` preferred, or `rg` for text patterns) that verify the fix is applied
- Fixes are grouped by domain -- one prompt per domain when possible
- Each prompt must independently pass tsc + tests + build + eslint
- Include the work agent rules from CLAUDE.md: stay on task, document
  discovered issues in cleanup file, use skills where required

## Step 6: Create the cleanup file

Create `$PLANS_DIR/<bug-name>-fix-cleanup.md`:

```markdown
# Bug Fix Cleanup: <title>

Items discovered during fix prompts that are non-blocking but should
be addressed.
```

## Step 7: Present the plan to the user

Show the user:
- The root cause analysis
- The number of prompts
- The prompt sequence with summaries
- For each prompt, note whether it looks mechanical (good for auto/Task
  tool) or complex (better run manually in a full conversation)
- Ask: "Ready to start?"

Wait for the user's go-ahead.

## Step 8: Pre-flight gate check (MANDATORY)

Check the plan file's `> Pre-flight:` header line.

- **CERTIFIED** or **CONDITIONAL**: proceed to Step 9.
- **Missing** or **BLOCKED**: launch `/pre-flight-plan-audit` as a
  sub-agent on the plan file. Wait for it to complete.
  - If the verdict is CERTIFIED or CONDITIONAL: proceed to Step 9.
  - If the verdict is BLOCKED: report the blocker findings to the user
    and **stop**. Do not execute a plan that has not passed pre-flight.

Do not skip this step. A plan that has not been pre-flighted may contain
structural issues (missing verification commands, dependency cycles,
convention mismatches) that waste execution time.

## Step 9: Execute the orchestrator loop

Prompts run strictly one at a time. Run one, verify, confirm PASS, then
move to the next. Never run prompts in parallel -- earlier prompts change
the codebase and later prompts may need updating.

For each prompt:

0. **Re-read the prompt file.** A prior work agent may have modified it
   (noted in its reconciliation under "Subsequent Prompts Modified").
   Do not hand off a stale version.

1. **Decide auto or manual.** The Task tool works for mechanical,
   well-scoped prompts (pattern replacement, dead code, import fixes).
   For prompts that require judgment, touch many files, or involve
   complex refactoring, the user will typically run the work agent
   manually in a separate conversation where it has a full context
   window and can ask follow-up questions. When in doubt, ask.

2. **Auto mode:** Launch a work agent via the Task tool. Pass the full
   prompt file contents. The task prompt must begin with: "You are a
   work agent. Execute the following prompt exactly. Read
   ~/github/user-frontend/CLAUDE.md first."

3. **Manual mode:** Output the prompt file contents. Wait for the user
   to paste the reconciliation output.

4. **Verify independently.** Run in `~/github/user-frontend`:
    ```
    git log --oneline -10
    pnpm tsc --noEmit
    pnpm test --run 2>&1 | tail -5
    pnpm build 2>&1 | tail -5
    npx eslint . --max-warnings 0 2>&1 | tail -3
    ```
    When integration scope is `per-prompt`, also run:
    ```
    pnpm test:integration 2>&1 | tail -5
    ```
    Plus the prompt-specific verification searches.

    **Independent verification rule.** When integration scope is
    `per-prompt` or `final-only`, the orchestrator independently runs
    the same integration tests the work agent was asked to run. Do not
    trust the agent's self-reported Playwright results. Run the specs
    yourself, compare the output, and fill in the verification checklist
    in the master plan. A prompt is not PASS until the orchestrator's
    row is filled in.

5. **Compare results.** Check the work agent's reconciliation against
    your own verification. Every field must match.

6. **Gate.** If all checks pass: update the master plan, report PASS,
    move to the next prompt. If any check fails: report FAIL, list every
    discrepancy, recommend a fix (re-run the prompt, or apply a targeted
    fix).

    **Cannot-run gate.** If integration scope is `per-prompt` and the
    work agent's reconciliation reports integration tests as "not run"
    or "cannot run," this is NOT a PASS. Mark the prompt PARTIAL. Before
    dispatching the next prompt, either fix the environment (start the
    Firebase emulator and dev/prod server) and re-verify, or insert a
    verification-only prompt that runs the affected specs. Do not
    proceed with unverified integration test changes.

    For auto prompts: if the Task agent reports Playwright as "not run"
    or "cannot run," escalate to manual immediately.

7. **Read the cleanup file** after each prompt to track accumulated items.
    If integration tests could not be independently verified, append an
    integration verification item: `- [ ] INTEGRATION VERIFY: Prompt N
    -- <specs not verified, reason>`. The cleanup prompt must resolve
    all such items before the plan is marked complete.

## Step 10: Generate the cleanup prompt

After all planned prompts complete:

1. Read `$PLANS_DIR/<bug-name>-fix-cleanup.md` in full
2. If no items were accumulated, skip to Step 11
3. Group items by domain/file proximity
4. Filter out items already resolved by later prompts
5. Generate `$PLANS_DIR/prompts/<bug-name>-fix-cleanup.md` with the standard
   prompt structure, containing all remaining cleanup items as fixes
6. Present to the user: "Here is the cleanup prompt with N items. Review
   and approve, or edit before I run it."
7. Run only after the user approves

## Step 11: Final verification and plan update

Run the full verification suite one final time. When integration scope is
`per-prompt` or `final-only`, run `pnpm test:integration` as a full
regression check.

Update the master plan with final status, HEAD sha, and test/build
metrics (including integration test results if scope is not `none`).

Then present a Manual Verification section. This is optional -- the user
may skip it entirely. It does not gate the prompt sequence or the cleanup
prompt. It is a convenience for the user to confirm the fix in the
browser before merging.

Generate 3-5 concrete reproduction steps based on the original bug
description and root cause analysis. Example:

```
## Manual Verification (optional)

If you want to confirm the fix in the browser:

1. Open /insights/workstream-analysis
2. Select two workstreams via checkbox
3. Navigate away, then press browser back button
4. Confirm: row checkboxes match the workstreams in the URL

Skip this if the automated checks are sufficient.
```

Report the final result to the user.
