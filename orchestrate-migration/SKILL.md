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

### Resolve $PLANS_DIR

Before any file operations, determine the plans directory:

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

Use `$PLANS_DIR` for all plan/prompt/cleanup file paths below. Create the
directory (and `$PLANS_DIR/prompts/`) if it does not exist.

## Step 1: Parse the migration description

Extract from the argument:

- What is being migrated (pattern, library, architecture, test strategy)
- What the target state looks like
- Any scope constraints (specific directories, specific files)

If the description is vague, ask clarifying questions before proceeding.

## Step 2: Inventory the current state

Read `~/github/user-frontend/CLAUDE.md` for project conventions.

Then build a complete inventory:

1. **Find all instances of the old pattern.** Use AST tools or `sg`
   (ast-grep) to locate every file that uses the thing being migrated.
   Fall back to `rg` only for non-code patterns. Count them.

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

6. **Check Playwright route intercepts.** If the migration changes API
   response shapes (Zod schemas, response types, wire format), search
   `integration/tests/` for `page.route()` intercepts matching the
   affected endpoint paths. These intercepts serve fixture data in the
   current shape -- changing the response shape without updating the
   intercepts will cause silent failures (Zod rejects the intercepted
   data at runtime, not compile time). Count the intercepts and include
   them in the inventory. Also check `integration/fixtures/` for fixture
   builders that produce the old response shape.

7. **Check mock route data sources.** If mock routes serve data from
   `buildStandardScenario()`, note which scenario fields are affected.
   Changing the scenario type has high blast radius (all mock route
   consumers). Prefer inline mapping in the mock route over changing
   the `StandardScenario` type.

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

**Response-shape migrations are a special case.** If the migration
changes API response Zod schemas or wire format, `page.route()`
intercepts in Playwright specs that serve fixture data for the affected
endpoints need CODE CHANGES (not just a regression run). This is
different from `final-only` scope -- the PW tests won't just fail,
they'll fail because the test code is wrong, not because production
code regressed. Add a dedicated Playwright prompt after all
schema/handler changes complete. Record this as a separate scope line
in the master plan header (e.g., `Playwright scope: dedicated prompt`).

Record the scope in the master plan header. Reference it when generating
prompt verification sections and the orchestrator verification loop.

## Step 5: Generate the master plan

NOTE: Include the integration test scope in the master plan header, e.g.:
`> Integration scope: per-prompt | final-only | none`

Create `$PLANS_DIR/<migration-name>.md` with:

```markdown
# Migration: <title>

> <what is being migrated and why>
> Created: <date>

## Current State

<description of the old pattern>

\`\`\`bash

# How to find remaining instances (use AST tool or sg, not grep)

<sg or AST tool command>
# Current count: <N>
\`\`\`

## Target State

<description of the new pattern>

\`\`\`bash

# After migration, the above search should return:

# <0 hits | only-in-specific-exempt-files>

\`\`\`

## Inventory

| #   | File   | Domain   | Complexity | Prompt | Status  |
| --- | ------ | -------- | ---------- | ------ | ------- |
| 1   | <path> | <domain> | mechanical | 01     | pending |
| 2   | <path> | <domain> | contextual | 02     | pending |
| ... |        |          |            |        |         |

## Migration Phases

| #   | Phase          | Prompt | What                                        | Files | Status  |
| --- | -------------- | ------ | ------------------------------------------- | ----- | ------- |
| 1   | Infrastructure | <name> | <create new utility/pattern>                | <N>   | pending |
| 2   | Shared layer   | <name> | <migrate shared code>                       | <N>   | pending |
| 3   | Domain: <name> | <name> | <migrate domain-specific code>              | <N>   | pending |
| 4   | Domain: <name> | <name> | <migrate domain-specific code>              | <N>   | pending |
| 5   | Cleanup        | <name> | <delete old pattern, verify zero remaining> | <N>   | pending |

## Dependency Graph

\`\`\`
Phase 1 (infrastructure)
|
v
Phase 2 (shared layer)
|
+---+---+---+
| | | |
v v v v
Phase 3 4 5 6 (domains -- independent, can run in any order)
| | | |
+---+---+---+
|
v
Phase 7 (cleanup + deletion)
\`\`\`

## Verification Checklist

<if integration scope is per-prompt or final-only, include this table>

| #   | Agent Ran PW? | Orchestrator Ran PW? | Results Match? | PASS/FAIL |
| --- | ------------- | -------------------- | -------------- | --------- |
| 1   |               |                      |                |           |
| 2   |               |                      |                |           |
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

Create prompt files in `$PLANS_DIR/prompts/` named
`<migration-name>-NN-<phase>.md`.

Each prompt follows this structure:

```markdown
# Migration Prompt N: <phase title>

## Context

Prompt N of M in the <migration-name> sequence.

- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: $PLANS_DIR/<migration-name>.md
- Cleanup file: $PLANS_DIR/<migration-name>-cleanup.md (append to it)

Read ~/github/user-frontend/CLAUDE.md before starting.
Check $PLANS_DIR/<migration-name>-cleanup.md for issues from prior prompts.

## Prerequisite

<what must be done first, or "none">

## Goal

Migrate <N files> in <domain> from <old pattern> to <new pattern>.
After this prompt, <specific measurable outcome>.

## Current State

\`\`\`bash

# Files to migrate in this prompt (use AST tool or sg, not grep):

<sg or AST tool command scoped to this domain>
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
pnpm tsc --noEmit -p tsconfig.check.json
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

<search command (AST tool --count, sg, or rg per tool hierarchy) scoped to domain>

# Target: 0

# New pattern should be present

<search command (AST tool --count, sg, or rg per tool hierarchy) scoped to domain>

# Target: <N>

# Global remaining count

<search command (AST tool --count, sg, or rg per tool hierarchy) across entire src/>

# Target: <N remaining after this prompt>

\`\`\`

## Reconciliation

\`\`\`
=== RECONCILIATION: <NN-phase-name> ===
HEAD: <git sha>
Commits: <count> (<first_sha>..<last_sha>)
tsc: <0 errors | N errors>
Tests: <N specs, M passed, K todo>
Build: <clean | failed>
ESLint: <clean | N errors, M warnings>
Integration: <N passed, M failed (Xm) | not run | skipped (scope: none)>

Prompt-Specific:
<verification results from the prompt's search/check commands>
<migration-specific counts: old pattern remaining, new pattern count>

Behavioral Changes:
<1-3 lines describing what changed in user-visible terms>

Cleanup Items Added: <0 | N items>
Subsequent Prompts Modified: <none | list>
Deviations: <none | list>
Work Left Undone: <none | list>
=== END RECONCILIATION ===
\`\`\`

### Plan File Updates

- $PLANS_DIR/<migration-name>.md (update file/phase status, remaining count)
- $PLANS_DIR/<migration-name>-cleanup.md (append)
```

### Prompt generation rules

- Every prompt includes "before" and "after" verification counts for the
  old pattern, scoped to the prompt's domain AND globally
- The final cleanup prompt verifies the global count is 0 (or matches
  the documented exemptions)
- If the migration involves replacing a dependency, the deletion happens
  in the last prompt (after all consumers are migrated)
- Each step in a prompt includes a concrete example of the old code and
  the new code for that specific file

## Step 6: Create the cleanup file

Create `$PLANS_DIR/<migration-name>-cleanup.md`:

```markdown
# Migration Cleanup: <title>

Items discovered during migration that are non-blocking but should
be addressed.

## Documented Exemptions

Files where the old pattern is intentionally kept:

- (none yet)
```

## Step 7: Pre-flight audit (MANDATORY)

Run immediately after generating plan + prompts + cleanup file. Do NOT
defer to execution time.

Launch `/pre-flight-plan-audit` as a sub-agent on the plan file. Wait
for it to complete.

- **CERTIFIED** or **CONDITIONAL**: proceed to Step 8.
- **BLOCKED**: fix the blocker findings, re-run pre-flight. Do not
  present a BLOCKED plan to the user.

**Calibration check.** If this plan's prompts run audit, refactor, or
build skills that consume AST interpreter output, count pending
calibration fixtures:

```bash
for f in scripts/AST/ground-truth/fixtures/*/manifest.json; do
  status=$(python3 -c "import json; print(json.load(open('$f')).get('status',''))")
  [ "$status" = "pending" ] && echo "PENDING: $f"
done
```

If any tool has 3+ pending fixtures, run `/calibrate-ast-interpreter
--tool <name>` before proceeding.

## Step 8: Validate the plan (MANDATORY)

Launch `/validate-plan` on the plan file. This replaces the previous
conditional adversarial review with a mandatory multi-layer validation:

1. Conditional dialectic check (blended >= 5.0 or new architecture)
2. Adversarial plan review (always runs, not conditional on score)
3. Deep review (verify import paths, file paths, API signatures, and
   constants in every prompt against the actual codebase)
4. PoC gate (adversarial review surfaces risky approaches; user decides
   whether to validate with a throwaway test)
5. Prework checklist (calibration fixtures, debt file, branch creation,
   baseline tsc + tests)

The skill produces a verdict: READY FOR EXECUTION or BLOCKED. Do not
proceed to Step 9 until the verdict is READY.

If /validate-plan modifies any prompt files (fixing accepted findings),
it re-runs pre-flight automatically to maintain structural certification.

## Step 9: Present the plan to the user

Show the user:

- What is being migrated (old pattern -> new pattern)
- Total instance count
- Number of phases and prompts
- Dependency graph
- Any files flagged as complex or potentially blocking
- Pre-flight verdict and finding count
- Adversarial review summary (if run): findings count, accepted/rejected
- For each prompt, note whether it looks mechanical (good for auto/Task
  tool) or complex (better run manually in a full conversation)
- Ask: "Ready to start?"

Wait for the user's go-ahead.

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

3. **Manual mode:** Output the prompt contents. Wait for the user to
   paste the reconciliation output.

4. **Verify independently.** Run in `~/github/user-frontend`:

   ```
   git log --oneline -10
   pnpm tsc --noEmit -p tsconfig.check.json
   pnpm test --run 2>&1 | tail -5
   pnpm build 2>&1 | tail -5
   npx eslint . --max-warnings 0 2>&1 | tail -3
   ```

   When integration scope is `per-prompt`, also run:

   ```
   pnpm test:integration 2>&1 | tail -5
   ```

   Plus prompt-specific verification searches. Pay special attention to
   the remaining-instance counts.

   **Independent verification rule.** When integration scope is
   `per-prompt` or `final-only`, the orchestrator independently runs
   the same integration tests the work agent was asked to run. Do not
   trust the agent's self-reported Playwright results. Run the specs
   yourself, compare the output, and fill in the verification checklist
   in the master plan. A prompt is not PASS until the orchestrator's
   row is filled in.

5. **Compare results** against the reconciliation.

6. **Gate.** PASS: update master plan (remaining count, phase status),
   move on. FAIL: list discrepancies.

   **Cannot-run gate.** If integration scope is `per-prompt` and the
   work agent's reconciliation reports integration tests as "not run"
   or "cannot run," this is NOT a PASS. Mark the prompt PARTIAL. Before
   dispatching the next prompt, either fix the environment (start the
   Firebase emulator and dev/prod server) and re-verify, or insert a
   verification-only prompt that runs the affected specs. Do not
   proceed with unverified integration test changes.

   For auto prompts: if the Task agent reports Playwright as "not run"
   or "cannot run," escalate to manual immediately.

7. **Read the cleanup file** for new items and exemptions. If integration
   tests could not be independently verified, append an integration
   verification item: `- [ ] INTEGRATION VERIFY: Prompt N -- <specs
not verified, reason>`. The cleanup prompt must resolve all such
   items before the plan is marked complete.

## Step 10: Generate the cleanup prompt

After all planned prompts complete:

1. Read `$PLANS_DIR/<migration-name>-cleanup.md` in full
2. Run the global remaining-instance search. If count > 0 and items are
   not documented exemptions, include them in the cleanup prompt
3. Group items by domain/file proximity
4. Filter out items resolved by later prompts
5. Generate `$PLANS_DIR/prompts/<migration-name>-cleanup.md`
6. Include a final verification step that confirms the old pattern count
   matches the documented exemptions exactly
7. Present to user for approval
8. Run only after user approves

## Step 11: Final verification and plan update

Run the full verification suite. When integration scope is `per-prompt`
or `final-only`, run `pnpm test:integration` as a full regression check.
Run the global remaining-instance search one last time.

Update the master plan with:

- Final remaining count (should match exemptions)
- HEAD sha
- Test/build metrics (including integration test results if scope is not `none`)
- Summary of what was migrated

If the migration included removing an npm dependency, verify it is gone
from `package.json` and `pnpm-lock.yaml`. Report to user.

### Doc audit

After the migration is complete, search `docs/` and `CLAUDE.md` for
references to the old pattern, API, or library (text search -- docs are
not code). Update any documentation that now describes the pre-migration
state. Stale docs are a recurring source of agent confusion in subsequent
work sessions.

## Step 12: Archive the plan

After the user confirms the plan is complete, launch `/archive-plan`
on the plan file. This skill handles all post-plan protocol steps:

1. Collect execution metrics (git + session DB)
2. Post-execution calibration (compare predicted F/C against actuals)
3. Handle cleanup file items (move to backlog or KNOWN-DEBT)
4. Archive files (move plan + cleanup, gzip prompts)
5. Update historical-reference.md (scoring table, execution metrics,
   reasoning entry, F/C anchor tables)
6. Update active plans table
7. Cross-repo updates (if applicable)
8. Commit and push

Do not skip this step. Do not perform these steps manually. The skill
exists to prevent the protocol drift that occurs when agents do archival
from memory instead of following the documented procedure.
