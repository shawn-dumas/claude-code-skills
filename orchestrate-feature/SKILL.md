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

## Step 4: Generate the master plan

Create `~/plans/<feature-name>.md` with:

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

Create prompt files in `~/plans/prompts/` named `<feature-name>-NN-<phase>.md`.

Each prompt follows this structure:

```markdown
# Feature Prompt N: <phase title>

## Context
- Repo: ~/github/user-frontend
- Branch: <current branch>
- Master plan: ~/plans/<feature-name>.md
- Cleanup file: ~/plans/<feature-name>-cleanup.md (append to it)

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

Prompt-specific checks:

\`\`\`bash
# <description>
<verification grep/command>
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
- Include grep commands that verify new files exist and new exports are
  wired into barrels

## Step 6: Create the cleanup file

Create `~/plans/<feature-name>-cleanup.md`:

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
   your own verification.

5. **Gate.** PASS: update master plan, move to next prompt. FAIL: list
   discrepancies, recommend fix.

6. **Read the cleanup file** after each prompt.

## Step 9: Generate the cleanup prompt

After all planned prompts complete:

1. Read `~/plans/<feature-name>-cleanup.md` in full
2. If no items, skip to Step 10
3. Group items by domain/file proximity
4. Filter out items already resolved by later prompts
5. Generate `~/plans/prompts/<feature-name>-cleanup.md`
6. Present to user for approval
7. Run only after the user approves

## Step 10: Final verification and plan update

Run the full verification suite. Update the master plan with final status,
HEAD sha, test/build metrics, and new file counts. Report to user.
