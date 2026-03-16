---
name: orchestrate-feature
description: Orchestrate phased implementation of a new feature. Designs implementation phases, identifies dependencies, generates prompts in topological order, and coordinates work agents.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task
argument-hint: <feature description>
---

Orchestrate a new feature. `$ARGUMENTS`

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

## Step 1: Parse the feature description

Extract from the argument:
- What the feature does (user-visible behavior)
- Which pages/routes it affects
- Any technical constraints or preferences mentioned

If the description is vague, ask clarifying questions before proceeding.

## Step 2: Investigate the codebase

Read `~/github/user-frontend/CLAUDE.md` for project conventions.

Then investigate the implementation surface:

1. **Identify affected domains.** Which service hooks, containers,
   components, and providers need to change or be created?

2. **Survey existing patterns.** Read 2-3 files in each affected domain
   to understand current conventions, directory structure, and naming.

3. **Map the dependency graph.** What depends on what? Which pieces must
   exist before others can be built? Service hooks before containers.
   Containers before components. Types before everything.

4. **Identify reuse opportunities.** Are there existing shared components,
   hooks, or utilities that the feature can use? Are there patterns in the
   codebase that this feature should follow?

5. **Check for conflicts.** Will the feature touch files being modified by
   other in-progress work? Check git status, recent branches.

## Step 3: Decide whether to orchestrate

If the feature can be implemented in a single prompt (one domain, 3 or
fewer files), do NOT orchestrate. Tell the user and output a single prompt.

If the feature requires phased implementation across multiple domains,
proceed with orchestration.

## Step 4: Assess integration test scope

Determine whether the feature touches code exercised by Playwright
integration tests. Read the integration test scope rules in
`~/.claude/CLAUDE.md` (Orchestration Protocol > Integration test scope).

- If the feature creates/modifies files in `integration/` (specs, POMs,
  fixtures, constants, mock handler), scope is `per-prompt`.
- If the feature modifies production UI code (components, containers,
  hooks, providers, page blocks, navigation, URL params), scope is
  `final-only`.
- If the feature is types-only, unit test infrastructure, or
  documentation, scope is `none`.

Record the scope in the master plan header. Reference it when generating
prompt verification sections and the orchestrator verification loop.

## Step 5: Generate the master plan

NOTE: Include the integration test scope in the master plan header, e.g.:
`> Integration scope: per-prompt | final-only | none`

Create `$PLANS_DIR/<feature-name>.md` with:

```markdown
# Feature: <title>

> <one-line description>

## Design

<what the feature does, how it fits into the existing architecture>

### New Files

| File | Type | Purpose |
|------|------|---------|
| <path> | <service hook/container/component/etc.> | <what it does> |

### Modified Files

| File | What changes |
|------|-------------|
| <path> | <summary of changes> |

### Types

<new types needed, which shared type files to update>

## Implementation Phases

The phases follow the dependency graph. Each phase unblocks the next.

| # | Phase | Prompt | What | Depends on | Status |
|---|-------|--------|------|-----------|--------|
| 1 | Types | <name> | <summary> | none | pending |
| 2 | Service hooks | <name> | <summary> | Phase 1 | pending |
| 3 | Container | <name> | <summary> | Phase 2 | pending |
| 4 | Components | <name> | <summary> | Phase 3 | pending |
| 5 | Integration | <name> | <summary> | Phase 4 | pending |

## Verification

<what should be true after all phases complete>

## Verification Checklist

<if integration scope is per-prompt or final-only, include this table>

| # | Agent Ran PW? | Orchestrator Ran PW? | Results Match? | PASS/FAIL |
|---|---------------|----------------------|----------------|-----------|
| 1 | | | | |
| 2 | | | | |
```

### Phase ordering

Follow the standard topological order from the codebase conventions:

1. **Types and schemas** -- Zod schemas, shared types, branded types
2. **Service hooks** -- useQuery/useMutation hooks for new data needs
3. **Providers** -- only if the feature needs shared UI state (most do not)
4. **Containers** -- route containers or section containers
5. **Components** -- DDAU leaf components
6. **Integration** -- wiring, route registration, navigation updates
7. **Tests** -- fill coverage gaps (each earlier phase generates tests
   alongside production code, but this phase catches anything missed)

Not every feature needs all phases. Skip phases that have no work.

## Step 5: Generate prompts

Create prompt files in `$PLANS_DIR/prompts/` named `<feature-name>-NN-<phase>.md`.

Each prompt follows this structure:

```markdown
# Feature Prompt N: <phase title>

## Context
- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: $PLANS_DIR/<feature-name>.md
- Cleanup file: $PLANS_DIR/<feature-name>-cleanup.md (append to it)

Read ~/github/user-frontend/CLAUDE.md before starting.

## Prerequisite

<what must be done before this prompt -- reference prior prompt or "none">

## Goal

<what this prompt achieves, in terms the work agent can verify>

## Steps

### Step 1: <title>
<detailed instructions with file paths>

### Step 2: <title>
<detailed instructions>

## Implementation Rules

- Run /audit-react-feature on target directories BEFORE any write work
- Use matching skills: /build-react-service-hook for new hooks,
  /build-react-component for new components, /build-react-route for
  new routes, etc.
- Every new file gets a test (use the matching /build-react-test or
  /build-module-test skill)
- Preserve existing behavior in modified files unless the feature
  intentionally changes it

## Commit Strategy
<how many commits, what goes in each -- one logical unit per commit>

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
# <description>
<verification command (AST tool --count, sg, or rg per tool hierarchy)>
\`\`\`

## Reconciliation

<standard reconciliation block -- see CLAUDE.md>
```

### Prompt generation rules

- Each prompt must reference which skills to use (build-react-*, audit-*)
- Each prompt independently passes tsc + tests + build + eslint
- New production files require tests in the same prompt, not deferred
- Prompts are sequenced by dependency -- types before hooks before
  containers before components
- Include verification commands. Use `ast-imports --kind EXPORT_DECLARATION`
  to verify barrel wiring. Use `rg` or `ls` to verify new files exist

## Step 6: Create the cleanup file

Create `$PLANS_DIR/<feature-name>-cleanup.md`:

```markdown
# Feature Cleanup: <title>

Items discovered during implementation that are non-blocking but should
be addressed.
```

## Step 7: Present the plan to the user

Show the user:
- The feature design summary
- New files to be created
- The phase sequence with dependencies
- Number of prompts
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
    your own verification.

6. **Gate.** PASS: update master plan, move to next prompt. FAIL: list
    discrepancies, recommend fix.

    **Cannot-run gate.** If integration scope is `per-prompt` and the
    work agent's reconciliation reports integration tests as "not run"
    or "cannot run," this is NOT a PASS. Mark the prompt PARTIAL. Before
    dispatching the next prompt, either fix the environment (start the
    Firebase emulator and dev/prod server) and re-verify, or insert a
    verification-only prompt that runs the affected specs. Do not
    proceed with unverified integration test changes.

    For auto prompts: if the Task agent reports Playwright as "not run"
    or "cannot run," escalate to manual immediately.

7. **Read the cleanup file** after each prompt. If integration tests
    could not be independently verified, append an integration
    verification item: `- [ ] INTEGRATION VERIFY: Prompt N -- <specs
    not verified, reason>`. The cleanup prompt must resolve all such
    items before the plan is marked complete.

## Step 10: Generate the cleanup prompt

After all planned prompts complete:

1. Read `$PLANS_DIR/<feature-name>-cleanup.md` in full
2. If no items, skip to Step 11
3. Group items by domain/file proximity
4. Filter out items already resolved by later prompts
5. Generate `$PLANS_DIR/prompts/<feature-name>-cleanup.md`
6. Present to user for approval
7. Run only after the user approves

## Step 11: Final verification and plan update

Run the full verification suite. When integration scope is `per-prompt`
or `final-only`, run `pnpm test:integration` as a full regression check.

Update the master plan with final status, HEAD sha, test/build metrics
(including integration test results if scope is not `none`), and new file
counts. Report to user.
