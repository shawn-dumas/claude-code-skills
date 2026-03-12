---
name: orchestrate-backlog
description: Orchestrate cleanup of a backlog of accumulated items. Prioritizes, identifies dependencies, sequences prompts, and coordinates work agents to execute them.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task
argument-hint: <backlog file path or description of items>
---

Orchestrate a backlog cleanup. `$ARGUMENTS`

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

## Step 1: Parse the argument

Determine the input:

- **Backlog file path** (e.g., `$PLANS_DIR/uf-backlog.md`): Read the file.
  It contains a list of items to address.

- **Description of items** (e.g., "clean up all the test infrastructure
  debt"): Investigate the codebase to build an inventory.

If the input is a file, read it completely. If it is a description,
investigate the codebase to enumerate specific items.

## Step 2: Inventory and classify items

For each backlog item:

1. **Verify it is still relevant.** Check the current state of the file
   or code mentioned. Items from old audits may have been fixed already.

2. **Classify the work type:**
   - Structural dedup (merging near-identical code)
   - Migration (replacing one pattern with another across files)
   - Test improvement (coverage gaps, mock migration, infrastructure)
   - Dead code deletion
   - Bug fix
   - Dependency update
   - Documentation

3. **Estimate scope.** How many files? How complex is each change?

4. **Identify dependencies.** Which items must happen before others?
   Which items are independent and could be parallelized?

5. **Group into prompts.** Items of the same type in the same domain
   go together. A single prompt should be completable in one work session
   (roughly: under 15 fixes, under 30 files changed).

## Step 3: Decide whether to orchestrate

If there are fewer than 3 items, all independent, do NOT orchestrate.
Output them as a single prompt or do them directly.

If items number 3+ or have dependencies between them, proceed.

## Step 4: Assess integration test scope

Determine whether the backlog items touch code exercised by Playwright
integration tests. Read the integration test scope rules in
`~/.claude/CLAUDE.md` (Orchestration Protocol > Integration test scope).

- If items create/modify files in `integration/` (specs, POMs, fixtures,
  constants, mock handler), scope is `per-prompt`.
- If items modify production UI code (components, containers, hooks,
  providers, page blocks, navigation, URL params), scope is `final-only`.
- If items are pure unit test infrastructure, types-only, or
  documentation, scope is `none`.

Record the scope in the master plan header. Reference it when generating
prompt verification sections and the orchestrator verification loop.

## Step 5: Generate the master plan

NOTE: Include the integration test scope in the master plan header, e.g.:
`> Integration scope: per-prompt | final-only | none`

Create `$PLANS_DIR/<backlog-name>.md` (or update the existing backlog file)
with:

```markdown
# Backlog: <title>

> Created: <date>

## Items

| # | Item | Type | Files | Effort | Prompt | Status |
|---|------|------|-------|--------|--------|--------|
| B1 | <description> | structural | ~5 | medium | 01 | pending |
| B2 | <description> | migration | ~20 | large | 02 | pending |
| ... | | | | | | |

## Dependency Graph

\`\`\`
Prompt 1 (independent)
Prompt 2 (independent)
     |
     v
Prompt 3 (depends on 2)
     |
     v
Prompt 4 (depends on 3)
     |
     v
Prompt 5 (final validation)
\`\`\`

<explanation of why this ordering>

## Prompt Sequence

| # | Prompt | Items | Prerequisite | Status |
|---|--------|-------|-------------|--------|
| 1 | <name> | B1, B3 | none | pending |
| 2 | <name> | B2 | none | pending |
| 3 | <name> | B4, B5 | Prompt 2 | pending |

## Verification Checklist

<if integration scope is per-prompt or final-only, include this table>

| # | Agent Ran PW? | Orchestrator Ran PW? | Results Match? | PASS/FAIL |
|---|---------------|----------------------|----------------|-----------|
| 1 | | | | |
| 2 | | | | |
```

### Sequencing rules

1. Independent items can run in any order (or parallel if disjoint)
2. Items that modify the same files must be in the same prompt or
   strictly ordered
3. Infrastructure changes (test setup, mock strategy, tooling) come
   before items that depend on that infrastructure
4. The last prompt should be a validation/integration prompt that
   verifies the cumulative effect of all prior prompts

## Step 5: Generate prompts

Create prompt files in `$PLANS_DIR/prompts/` named
`<backlog-name>-NN-<topic>.md`.

Each prompt follows this structure:

```markdown
# Backlog Prompt N: <title>

## Context

Prompt N of M in the <backlog-name> sequence.

- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: $PLANS_DIR/<backlog-name>.md
- Cleanup file: $PLANS_DIR/<backlog-name>-cleanup.md (append to it)

Read ~/github/user-frontend/CLAUDE.md before starting.
Check $PLANS_DIR/<backlog-name>-cleanup.md for issues from prior prompts.

## Prerequisite

<what must be done first, or "none">

## Goal

<what this prompt achieves -- specific, measurable>

## Steps

### Step 1 / Part A: <title>
<detailed instructions>

### Step 2 / Part B: <title>
<detailed instructions>

## Implementation Rules

- <which skills to use>
- <behavior constraints>
- Do NOT modify production code outside the scope of this prompt
  (exception: if a structural change requires updating import paths)

## Commit Strategy
<one commit per logical unit of work>

## Cleanup Protocol

Append to $PLANS_DIR/<backlog-name>-cleanup.md:

\`\`\`markdown
## Prompt N: <title>
- [ ] (list any discovered issues)
\`\`\`

## Verification
<standard verification + prompt-specific greps>

## Reconciliation
<standard reconciliation block>

### Plan File Updates
- $PLANS_DIR/<backlog-name>.md (update item status)
- $PLANS_DIR/<backlog-name>-cleanup.md (append)
```

### Prompt generation rules

- Each prompt references the specific backlog items it addresses (B1, B2,
  etc.) so the master plan can be updated
- For large items, break them into numbered steps within the prompt
- Include "before" measurements (line counts, grep hit counts) that the
  verification section checks against
- If an item involves replacing a pattern across many files, include the
  grep command that finds remaining instances (target: 0)

## Step 6: Create the cleanup file

Create `$PLANS_DIR/<backlog-name>-cleanup.md`:

```markdown
# Backlog Cleanup: <title>

Items discovered during backlog prompts that are non-blocking but should
be addressed.
```

## Step 7: Present the plan to the user

Show the user:
- Number of backlog items, grouped by type
- Items that were already resolved (removed from scope)
- Dependency graph
- Number of prompts with sequence
- For each prompt, note whether it looks mechanical (good for auto/Task
  tool) or complex (better run manually in a full conversation)
- Ask: "Ready to start?"

Wait for the user's go-ahead.

## Step 8: Execute the orchestrator loop

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

3. **Manual mode:** Output the prompt contents. Wait for the user to
   paste the reconciliation output.

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
    Plus prompt-specific verification greps.

    **Independent verification rule.** When integration scope is
    `per-prompt` or `final-only`, the orchestrator independently runs
    the same integration tests the work agent was asked to run. Do not
    trust the agent's self-reported Playwright results. Run the specs
    yourself, compare the output, and fill in the verification checklist
    in the master plan. A prompt is not PASS until the orchestrator's
    row is filled in.

5. **Compare results** against the reconciliation.

6. **Gate.** PASS: update master plan, move on. FAIL: list discrepancies.

    **Cannot-run gate.** If integration scope is `per-prompt` and the
    work agent's reconciliation reports integration tests as "not run"
    or "cannot run," this is NOT a PASS. Mark the prompt PARTIAL. Before
    dispatching the next prompt, either fix the environment (start the
    Firebase emulator and dev/prod server) and re-verify, or insert a
    verification-only prompt that runs the affected specs. Do not
    proceed with unverified integration test changes.

    For auto prompts: if the Task agent reports Playwright as "not run"
    or "cannot run," escalate to manual immediately.

7. **Read the cleanup file** for new items. If integration tests could
    not be independently verified, append an integration verification
    item: `- [ ] INTEGRATION VERIFY: Prompt N -- <specs not verified,
    reason>`. The cleanup prompt must resolve all such items before the
    plan is marked complete.

8. **Check if the work agent modified subsequent prompts.** If so, read
    the modified prompt files and verify the changes make sense.

## Step 9: Generate the cleanup prompt

After all planned prompts complete:

1. Read `$PLANS_DIR/<backlog-name>-cleanup.md` in full
2. If no items, skip to Step 10
3. Group items by domain/file proximity
4. Filter out items resolved by later prompts
5. Generate `$PLANS_DIR/prompts/<backlog-name>-cleanup.md`
6. Present to user for approval
7. Run only after user approves

## Step 10: Final verification and plan update

Run the full verification suite. When integration scope is `per-prompt`
or `final-only`, run `pnpm test:integration` as a full regression check.

Update the master plan: mark all items DONE or document carry-forward
items. Update HEAD sha, test/build metrics (including integration test
results if scope is not `none`). Report to user with a summary of what
was accomplished.
