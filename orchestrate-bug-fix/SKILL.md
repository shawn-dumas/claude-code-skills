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

## Step 4: Generate the master plan

Create `~/plans/<bug-name>-fix.md` with:

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
```

## Step 5: Generate fix prompts

Create prompt files in `~/plans/prompts/` named `<bug-name>-fix-NN.md`.

Each prompt follows this structure:

```markdown
# Fix Prompt: <title>

## Context
- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: ~/plans/<bug-name>-fix.md
- Cleanup file: ~/plans/<bug-name>-fix-cleanup.md (append to it)

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

Prompt-specific checks:

\`\`\`bash
# <description of what this grep checks>
<grep command that should return 0 hits after the fix>
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

Prompt-Specific:
  <each grep result>

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
- Every fix includes specific grep commands that verify the fix is applied
- Fixes are grouped by domain -- one prompt per domain when possible
- Each prompt must independently pass tsc + tests + build + eslint
- Include the work agent rules from CLAUDE.md: stay on task, document
  discovered issues in cleanup file, use skills where required

## Step 6: Create the cleanup file

Create `~/plans/<bug-name>-fix-cleanup.md`:

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
- Ask: "Ready to start? I'll run work agents automatically unless you
  say 'manual' for any prompt."

Wait for the user's go-ahead.

## Step 8: Execute the orchestrator loop

For each prompt in sequence:

1. **Auto mode (default):** Launch a work agent via the Task tool. Pass
   the full prompt file contents as the task description. The task prompt
   must begin with: "You are a work agent. Execute the following prompt
   exactly. Read ~/github/user-frontend/CLAUDE.md first."

2. **Manual mode (if user requested):** Output the prompt file contents.
   Wait for the user to paste the reconciliation output.

3. **Verify independently.** Run in `~/github/user-frontend`:
   ```
   git log --oneline -10
   pnpm tsc --noEmit
   pnpm test --run 2>&1 | tail -5
   pnpm build 2>&1 | tail -5
   npx eslint . --max-warnings 0 2>&1 | tail -3
   ```
   Plus the prompt-specific verification greps.

4. **Compare results.** Check the work agent's reconciliation against
   your own verification. Every field must match.

5. **Gate.** If all checks pass: update the master plan, report PASS,
   move to the next prompt. If any check fails: report FAIL, list every
   discrepancy, recommend a fix (re-run the prompt, or apply a targeted
   fix).

6. **Read the cleanup file** after each prompt to track accumulated items.

## Step 9: Generate the cleanup prompt

After all planned prompts complete:

1. Read `~/plans/<bug-name>-fix-cleanup.md` in full
2. If no items were accumulated, skip to Step 10
3. Group items by domain/file proximity
4. Filter out items already resolved by later prompts
5. Generate `~/plans/prompts/<bug-name>-fix-cleanup.md` with the standard
   prompt structure, containing all remaining cleanup items as fixes
6. Present to the user: "Here is the cleanup prompt with N items. Review
   and approve, or edit before I run it."
7. Run only after the user approves

## Step 10: Final verification and plan update

Run the full verification suite one final time. Update the master plan
with final status, HEAD sha, and test/build metrics. Report the result
to the user.
