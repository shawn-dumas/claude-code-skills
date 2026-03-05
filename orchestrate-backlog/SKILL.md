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

## Step 1: Parse the argument

Determine the input:

- **Backlog file path** (e.g., `~/plans/uf-backlog.md`): Read the file.
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

## Step 4: Generate the master plan

Create `~/plans/<backlog-name>.md` (or update the existing backlog file)
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

Create prompt files in `~/plans/prompts/` named
`<backlog-name>-NN-<topic>.md`.

Each prompt follows this structure:

```markdown
# Backlog Prompt N: <title>

## Context

Prompt N of M in the <backlog-name> sequence.

- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: ~/plans/<backlog-name>.md
- Cleanup file: ~/plans/<backlog-name>-cleanup.md (append to it)

Read ~/github/user-frontend/CLAUDE.md before starting.
Check ~/plans/<backlog-name>-cleanup.md for issues from prior prompts.

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

Append to ~/plans/<backlog-name>-cleanup.md:

\`\`\`markdown
## Prompt N: <title>
- [ ] (list any discovered issues)
\`\`\`

## Verification
<standard verification + prompt-specific greps>

## Reconciliation
<standard reconciliation block>

### Plan File Updates
- ~/plans/<backlog-name>.md (update item status)
- ~/plans/<backlog-name>-cleanup.md (append)
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

Create `~/plans/<backlog-name>-cleanup.md`:

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
- Ask: "Ready to start? I'll run work agents automatically unless you
  say 'manual' for any prompt."

Wait for the user's go-ahead.

## Step 8: Execute the orchestrator loop

For each prompt in sequence:

1. **Auto mode (default):** Launch a work agent via the Task tool. Pass
   the full prompt file contents. The task prompt must begin with:
   "You are a work agent. Execute the following prompt exactly.
   Read ~/github/user-frontend/CLAUDE.md first."

2. **Manual mode (if user requested):** Output the prompt contents.
   Wait for reconciliation output.

3. **Verify independently.** Run in `~/github/user-frontend`:
   ```
   git log --oneline -10
   pnpm tsc --noEmit
   pnpm test --run 2>&1 | tail -5
   pnpm build 2>&1 | tail -5
   npx eslint . --max-warnings 0 2>&1 | tail -3
   ```
   Plus prompt-specific verification greps.

4. **Compare results** against the reconciliation.

5. **Gate.** PASS: update master plan, move on. FAIL: list discrepancies.

6. **Read the cleanup file** for new items.

7. **Check if the work agent modified subsequent prompts.** If so, read
   the modified prompt files and verify the changes make sense.

## Step 9: Generate the cleanup prompt

After all planned prompts complete:

1. Read `~/plans/<backlog-name>-cleanup.md` in full
2. If no items, skip to Step 10
3. Group items by domain/file proximity
4. Filter out items resolved by later prompts
5. Generate `~/plans/prompts/<backlog-name>-cleanup.md`
6. Present to user for approval
7. Run only after user approves

## Step 10: Final verification and plan update

Run the full verification suite. Update the master plan: mark all items
DONE or document carry-forward items. Update HEAD sha, test/build metrics.
Report to user with a summary of what was accomplished.
