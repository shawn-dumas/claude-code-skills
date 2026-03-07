---
name: orchestrate-migration
description: Orchestrate a multi-phase migration. Inventories the current state, plans migration phases, generates prompts, and coordinates work agents to execute them.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task
argument-hint: <migration description>
---

Orchestrate a migration. `$ARGUMENTS`

You are now the orchestrator. You coordinate work agents but do NOT write
production code yourself. Read the Orchestration Protocol section of
`~/.claude/CLAUDE.md` before proceeding -- it defines the rules you must follow.

## Step 1: Parse the migration description

Extract from the argument:
- What is being migrated (pattern, library, architecture, test strategy)
- What the target state looks like
- Any scope constraints (specific directories, specific files)

If the description is vague, ask clarifying questions before proceeding.

## Step 2: Inventory the current state

Read `~/github/user-frontend/CLAUDE.md` for project conventions.

Then build a complete inventory:

1. **Find all instances of the old pattern.** Use grep/glob to locate
   every file that uses the thing being migrated. Count them.

2. **Classify instances by complexity.** Some migrations are mechanical
   (find-and-replace). Others require understanding context (e.g.,
   migrating a localStorage call requires knowing what schema to use).

3. **Map dependencies.** If the migration has a "foundation" phase (e.g.,
   create the new utility before migrating consumers), identify it.

4. **Identify blockers.** Are there files where the migration is not
   straightforward? Files that need special handling?

5. **Group by domain.** Migrations that touch the same feature directory
   go in the same prompt. Cross-cutting migrations (shared utils,
   infrastructure) go first.

## Step 3: Decide whether to orchestrate

If the migration touches fewer than 5 files, all mechanical, do NOT
orchestrate. Do it in a single prompt.

If the migration spans 5+ files across multiple domains, or has phased
dependencies, proceed with orchestration.

## Step 4: Assess integration test scope

Determine whether the migration touches code exercised by Playwright
integration tests. Read the integration test scope rules in
`~/.claude/CLAUDE.md` (Orchestration Protocol > Integration test scope).

- If the migration creates/modifies files in `integration/` (specs,
  POMs, fixtures, constants, mock handler), scope is `per-prompt`.
- If the migration modifies production UI code (components, containers,
  hooks, providers, page blocks, navigation, URL params), scope is
  `final-only`.
- If the migration is types-only, unit test infrastructure, or
  documentation, scope is `none`.

Record the scope in the master plan header. Reference it when generating
prompt verification sections and the orchestrator verification loop.

## Step 5: Generate the master plan

NOTE: Include the integration test scope in the master plan header, e.g.:
`> Integration scope: per-prompt | final-only | none`

Create `~/plans/<migration-name>.md` with:

```markdown
# Migration: <title>

> <what is being migrated and why>
> Created: <date>

## Current State

<description of the old pattern>

\`\`\`bash
# How to find remaining instances
<grep command>
# Current count: <N>
\`\`\`

## Target State

<description of the new pattern>

\`\`\`bash
# After migration, the above grep should return:
# <0 hits | only-in-specific-exempt-files>
\`\`\`

## Inventory

| # | File | Domain | Complexity | Prompt | Status |
|---|------|--------|-----------|--------|--------|
| 1 | <path> | <domain> | mechanical | 01 | pending |
| 2 | <path> | <domain> | contextual | 02 | pending |
| ... | | | | | |

## Migration Phases

| # | Phase | Prompt | What | Files | Status |
|---|-------|--------|------|-------|--------|
| 1 | Infrastructure | <name> | <create new utility/pattern> | <N> | pending |
| 2 | Shared layer | <name> | <migrate shared code> | <N> | pending |
| 3 | Domain: <name> | <name> | <migrate domain-specific code> | <N> | pending |
| 4 | Domain: <name> | <name> | <migrate domain-specific code> | <N> | pending |
| 5 | Cleanup | <name> | <delete old pattern, verify zero remaining> | <N> | pending |

## Dependency Graph

\`\`\`
Phase 1 (infrastructure)
     |
     v
Phase 2 (shared layer)
     |
     +---+---+---+
     |   |   |   |
     v   v   v   v
Phase 3  4   5   6  (domains -- independent, can run in any order)
     |   |   |   |
     +---+---+---+
         |
         v
Phase 7 (cleanup + deletion)
\`\`\`
```

### Phase ordering rules

1. **Infrastructure first.** If the migration requires a new utility,
   wrapper, or pattern, create it before migrating consumers.
2. **Shared code second.** Shared utilities, types, and test helpers
   that multiple domains consume.
3. **Domains in parallel.** Once the shared layer is ready, domain
   migrations are independent and can run in any order.
4. **Cleanup last.** Delete the old pattern, remove the old dependency,
   verify zero remaining instances.

## Step 5: Generate prompts

Create prompt files in `~/plans/prompts/` named
`<migration-name>-NN-<phase>.md`.

Each prompt follows this structure:

```markdown
# Migration Prompt N: <phase title>

## Context

Prompt N of M in the <migration-name> sequence.

- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: ~/plans/<migration-name>.md
- Cleanup file: ~/plans/<migration-name>-cleanup.md (append to it)

Read ~/github/user-frontend/CLAUDE.md before starting.
Check ~/plans/<migration-name>-cleanup.md for issues from prior prompts.

## Prerequisite

<what must be done first, or "none">

## Goal

Migrate <N files> in <domain> from <old pattern> to <new pattern>.
After this prompt, <specific measurable outcome>.

## Current State

\`\`\`bash
# Files to migrate in this prompt:
<grep command scoped to this domain>
# Currently: <N hits>
\`\`\`

## Steps

### Step 1: <title>
<file path> -- <what to change>

<specific instructions: what the old code looks like, what the new code
should look like, what to watch out for>

### Step 2: <title>
...

## Implementation Rules

- Use matching skills where applicable (/refactor-react-service-hook,
  /refactor-react-component, etc.)
- Preserve all existing behavior -- this is a mechanical migration,
  not a behavior change
- If a file cannot be migrated mechanically (needs design decisions),
  document it in the cleanup file and skip it
- Update tests that break due to the migration (mock changes, import
  path changes)

## Commit Strategy
<one commit per logical group -- e.g., one commit per sub-domain>

## Verification

Run ALL of the following in ~/github/user-frontend:

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
# Old pattern should be gone from this domain
<grep for old pattern scoped to domain> | wc -l
# Target: 0

# New pattern should be present
<grep for new pattern scoped to domain> | wc -l
# Target: <N>

# Global remaining count
<grep for old pattern across entire src/> | wc -l
# Target: <N remaining after this prompt>
\`\`\`

## Reconciliation
<standard reconciliation block with migration-specific fields>

### Plan File Updates
- ~/plans/<migration-name>.md (update file/phase status, remaining count)
- ~/plans/<migration-name>-cleanup.md (append)
```

### Prompt generation rules

- Every prompt includes "before" and "after" grep counts for the old
  pattern, scoped to the prompt's domain AND globally
- The final cleanup prompt verifies the global count is 0 (or matches
  the documented exemptions)
- If the migration involves replacing a dependency, the deletion happens
  in the last prompt (after all consumers are migrated)
- Each step in a prompt includes a concrete example of the old code and
  the new code for that specific file

## Step 6: Create the cleanup file

Create `~/plans/<migration-name>-cleanup.md`:

```markdown
# Migration Cleanup: <title>

Items discovered during migration that are non-blocking but should
be addressed.

## Documented Exemptions

Files where the old pattern is intentionally kept:
- (none yet)
```

## Step 7: Present the plan to the user

Show the user:
- What is being migrated (old pattern -> new pattern)
- Total instance count
- Number of phases and prompts
- Dependency graph
- Any files flagged as complex or potentially blocking
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
   Plus prompt-specific verification greps. Pay special attention to
   the remaining-instance counts.

5. **Compare results** against the reconciliation.

6. **Gate.** PASS: update master plan (remaining count, phase status),
   move on. FAIL: list discrepancies.

7. **Read the cleanup file** for new items and exemptions.

## Step 9: Generate the cleanup prompt

After all planned prompts complete:

1. Read `~/plans/<migration-name>-cleanup.md` in full
2. Run the global remaining-instance grep. If count > 0 and items are
   not documented exemptions, include them in the cleanup prompt
3. Group items by domain/file proximity
4. Filter out items resolved by later prompts
5. Generate `~/plans/prompts/<migration-name>-cleanup.md`
6. Include a final verification step that confirms the old pattern count
   matches the documented exemptions exactly
7. Present to user for approval
8. Run only after user approves

## Step 10: Final verification and plan update

Run the full verification suite. When integration scope is `per-prompt`
or `final-only`, run `pnpm test:integration` as a full regression check.
Run the global remaining-instance grep one last time.

Update the master plan with:
- Final remaining count (should match exemptions)
- HEAD sha
- Test/build metrics (including integration test results if scope is not `none`)
- Summary of what was migrated

If the migration included removing an npm dependency, verify it is gone
from `package.json` and `pnpm-lock.yaml`. Report to user.
