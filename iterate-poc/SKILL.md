---
name: iterate-poc
description: Iterate on an existing PoC created via orchestrate-poc. Takes the PM's change description, reads affected artifacts, plans targeted edits, executes them, re-verifies, and updates the PRD if scope or data shape changed.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task, TodoWrite, Question
argument-hint: <feature slug> <change description>
---

Iterate on a PoC feature. `$ARGUMENTS`

You are the PoC Iterator. A PM has an existing PoC -- created via
`orchestrate-poc` -- and wants to change something. Your job is to
understand the change, read the affected code, plan the edits, execute
them (via work agents or manual handoff), verify, and update the PRD.

**You do not directly implement production code changes yourself.** You
analyze the change request, read the current code and PRD, generate
implementation prompts, and coordinate work agents (via the Task tool or
manual handoff). Read the Orchestration Protocol section of
`~/.claude/CLAUDE.md` before proceeding.

**You do NOT run a full questionnaire.** Unlike `orchestrate-poc`, this
skill assumes the PRD already captures the feature's design. The PM
describes what they want changed in the prompt. You ask clarifying
questions only when the change description is ambiguous.

### Resolve $PLANS_DIR

Before any file operations, determine the plans directory:

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

Use `$PLANS_DIR` for all plan/prompt/cleanup file paths below. Create the
directory (and `$PLANS_DIR/prompts/`) if it does not exist.

---

<!-- role: workflow -->

## Preconditions

Before proceeding, verify:

1. **The PoC was created via `orchestrate-poc`.** Look for:

   - `$PLANS_DIR/poc-<slug>-prd.md` (the PRD)
   - `$PLANS_DIR/poc-<slug>-cleanup.md` (the cleanup file)
   - Optionally: `$PLANS_DIR/poc-<slug>-bff-handoff.md`
   - Optionally: `$PLANS_DIR/poc-<slug>-plan.md` (the master plan)

   If none of these exist, try the alternate naming convention:

   - `$PLANS_DIR/poc-<slug>.md`

   If the PRD file cannot be found:

   > I cannot find the PRD for this PoC. The `iterate-poc` skill
   > requires artifacts from `orchestrate-poc`. Expected path:
   > `$PLANS_DIR/poc-<slug>-prd.md` or `$PLANS_DIR/poc-<slug>.md`.
   >
   > If this PoC was not created via `orchestrate-poc`, run
   > `orchestrate-poc` with the "Existing spike" path first to
   > generate the required artifacts.

   Stop and wait for the PM to resolve.

2. **The PRD status is not `Escalated`.** Read the PRD header. If the
   status is `Escalated` or an escalation report exists at
   `$PLANS_DIR/poc-<slug>-escalation.md`:

   > This PoC was escalated during `orchestrate-poc`. The escalation
   > report at `$PLANS_DIR/poc-<slug>-escalation.md` needs engineering
   > review before further iteration. Resolve the escalation first.

   Stop and wait for the PM to resolve.

3. **The feature branch exists and is checked out.** Read the PRD header
   for the source branch. Verify it exists and is checked out:

   ```
   git branch --show-current
   ```

   If the current branch does not match, ask:

   ```
   Question: The PRD says the source branch is "<branch>", but you are
   currently on "<current>". Should I switch to "<branch>"?
   Header: Branch
   Options:
     - "Switch to <branch>" -- Check out the PoC branch before making changes.
      - "Stay on <current>" -- The work should happen on this branch instead.
   ```

4. **The branch is not behind development.** Check for divergence:

   ```bash
   git fetch origin development 2>/dev/null
   BEHIND=$(git rev-list --count HEAD..origin/development 2>/dev/null || echo "0")
   ```

   If `$BEHIND` is greater than 0, inform the PM:

   ```
   Question: Your branch is BEHIND commits behind development. Merging
   now to pick up recent changes before starting the iteration.
   Header: Sync with development
   Options:
     - "Merge now" -- Merge development into this branch before proceeding.
     - "Skip" -- Proceed without syncing. I understand the branch may be stale.
   ```

   If "Merge now": run `git merge origin/development --no-edit`. If
   there are merge conflicts, stop:

   > Merge conflicts detected when syncing with development. This needs
   > engineering help. Do not proceed until the conflicts are resolved.

---

<!-- role: workflow -->

## Step 1: Parse the Change Request

Extract the change description from `$ARGUMENTS`. The PM may provide:

- A specific change ("add a column to the table showing total hours")
- Multiple changes ("swap the bar chart for a line chart and add a
  date range filter")
- A behavioral change ("when the user clicks a row, show a detail
  panel instead of navigating")
- A data change ("add a new metric: average response time per system")
- A removal ("remove the pie chart, it is not useful")

Acknowledge what you understood. If the change description is ambiguous
or could be interpreted multiple ways, ask ONE clarifying question using
the Question tool. Do not ask more than one question before starting
analysis.

---

<!-- role: workflow -->

## Step 2: Read Current State

Read these artifacts to understand what exists:

### 2.1 Read the PRD

Read the full PRD at `$PLANS_DIR/poc-<slug>-prd.md` (or `$PLANS_DIR/poc-<slug>.md`).
Extract:

- Section 2 (Functional Requirements) -- what the feature currently does
- Section 3 (User Experience) -- current flows and UI states
- Section 4 (Data Model) -- current types and API contracts
- Section 5 (API Contracts) -- current endpoints
- Section 7 (Permissions) -- current role gates
- Section 10 (Engineering Notes) -- key files list

### 2.2 Read the Affected Code

From the PRD's Engineering Notes (Section 10), identify the key files.
Read the files that the change request touches. Typical file categories:

| Change Type                         | Files to Read                                                  |
| ----------------------------------- | -------------------------------------------------------------- |
| UI change (column, chart, layout)   | Container, presentational components                           |
| Data change (new field, new metric) | Types, schemas, fixtures, mock routes, service hooks           |
| Interaction change (click behavior) | Container (event handlers), affected components                |
| Filter change                       | Container (nuqs state), InsightsContext types, DashboardLayout |
| Permission change                   | Container (role check), page file                              |
| Removal                             | All files that reference the removed element                   |

Read the actual source files, not just the PRD description. The PRD may
be slightly out of date if previous iterate-poc runs or manual edits
were made.

### 2.3 Read the Cleanup File

Read `$PLANS_DIR/poc-<slug>-cleanup.md`. Check if any existing cleanup
items are related to or affected by the requested change. If so, note
them -- the change may resolve existing items or create conflicts.

---

<!-- role: workflow -->

## Step 3: Impact Analysis

Based on the change request and current code, determine:

### 3.1 Affected Files

List every file that needs modification, creation, or deletion.
Classify each:

| File                                       | Action | What Changes            |
| ------------------------------------------ | ------ | ----------------------- |
| `path/to/file.tsx`                         | modify | Add new column to table |
| `src/shared/types/<domain>/index.ts`       | modify | Add new field to type   |
| `src/fixtures/domains/<domain>.fixture.ts` | modify | Generate new field      |
| ...                                        | ...    | ...                     |

### 3.1b Visual Regression Impact

If the change modifies page layout, component rendering, or data display,
check whether visual regression baselines exist for the affected pages:

```bash
ls visual/tests/__screenshots__/ | grep -i "<page-slug>"
```

If baselines exist, they will need updating after the code change. Add
`pnpm test:visual:update` to the verification section of affected
prompts. If the change adds a new page that should have visual coverage,
reference `docs/visual-testing.md` for how to add a visual spec.

### 3.2 Scope Classification

Classify the change:

- **Cosmetic** -- UI-only changes within existing components. No type
  changes, no new data, no new files. Examples: reorder columns, change
  labels, swap chart type using same data.

- **Structural** -- Changes that add/remove/reorganize components or
  modify the container's data flow, but use existing data types.
  Examples: add a detail panel, split a view into tabs, add a filter.

- **Data-extending** -- Changes that require new fields on existing
  types, new fixture builders, or new/modified mock routes. Examples:
  add a new metric, add a new data column, change aggregation.

- **Data-new** -- Changes that require entirely new types, new API
  endpoints, new fixture domains. Examples: add a secondary data
  source, build a related-but-different view.

- **Cross-boundary** -- Changes that affect files outside the feature's
  directory (shared types used by other features, providers, layout
  components, navigation). These need extra care.

### 3.3 PRD Impact

Determine which PRD sections need updates:

- Section 2 (FRs) -- if behavior changes
- Section 3 (UX Flows) -- if interaction changes
- Section 4 (Data Model) -- if types change
- Section 5 (API Contracts) -- if endpoints change
- Section 8 (Tests) -- if test coverage changes
- Section 9 (Gotchas) -- if new edge cases arise
- Section 10 (Eng Notes) -- if key files change

### 3.4 Behavioral Impact Assessment

For each file in the "modify" list from Step 3.1, determine whether the
change could affect any behavioral fingerprint item. Run `ast-behavioral`
on the affected files:

```bash
npx tsx scripts/AST/ast-query.ts behavioral <affected-file-paths> --pretty
```

Cross-reference the tool output against the 9 behavioral categories:

| # | Category | Observations found | Impacted by this change? | Preservation status |
|---|----------|--------------------|--------------------------|---------------------|
| 1 | State preservation | <from tool output> | YES/NO | preserved / changed (explain) |
| 2 | Null/empty display | <from tool output> | YES/NO | preserved / changed (explain) |
| 3 | Value caps/limits | <from tool output> | YES/NO | preserved / changed (explain) |
| 4 | Column/field parity | <from tool output> | YES/NO | preserved / changed (explain) |
| 5 | String literal parity | <from tool output> | YES/NO | preserved / changed (explain) |
| 6 | Type coercion | <from tool output> | YES/NO | preserved / changed (explain) |
| 7 | Default values | <from tool output> | YES/NO | preserved / changed (explain) |
| 8 | Conditional visibility | <from tool output> | YES/NO | preserved / changed (explain) |
| 9 | Export/download inclusion | <from tool output> | YES/NO | preserved / changed (explain) |

Rules:
- If the tool finds observations in a category AND the change modifies
  code near those observations, mark "Impacted: YES" and specify whether
  the behavior is preserved or intentionally changed.
- If the change intentionally alters a behavioral item (e.g., changing
  a render cap from 5 to 10), document the old and new values.
- If the tool finds no observations in a category, mark "N/A".
- Include this table in the impact analysis presented to the PM in
  Step 3.5.

### 3.5 Present the Analysis

Present the impact analysis to the PM:

> **Impact analysis for: "<change description>"**
>
> **Scope:** <classification> > **Files affected:** N files (N modify, N create, N delete)
> **PRD sections to update:** <list>
>
> <Table of affected files>
>
> <Any concerns or trade-offs the PM should know about>

If any behavioral items are impacted (Step 3.4), include them in the
presentation:

> **Behavioral impact:**
>
> | Category | Old value | New value | Status |
> |----------|-----------|-----------|--------|
> | <category> | <old> | <new> | preserved / changed |
>
> <N> behavioral items are preserved. <M> are intentionally changed.

If the change is **cross-boundary**, warn:

> This change affects files outside the PoC's feature directory.
> Specifically: <list files>. These changes may affect other features.
> Proceed with caution -- consider whether this should be deferred to
> an engineering review.

Ask:

```
Question: Does this impact analysis look right? Ready to proceed?
Header: Confirm scope
Options:
  - "Looks good -- proceed" -- Generate prompts and execute.
  - "Adjust scope" -- I want to change what is included. I will describe.
```

If "Adjust scope": wait for the PM's clarification, re-analyze, and
present again.

---

<!-- role: emit -->

## Step 4: Generate Implementation Prompts

Based on the scope classification, generate prompts.

### 4.1 Prompt Count Heuristic

- **Cosmetic**: Usually 1 prompt. All changes are in presentational
  components. No skill required -- direct edits.

- **Structural**: 1-2 prompts. If container changes are independent of
  component changes, split them. Use matching skills (refactor-react-component,
  refactor-react-route).

- **Data-extending**: 2-3 prompts. Typical sequence:

  1. Types + schema + fixture changes
  2. Mock route + service hook changes
  3. UI changes (container + components)

- **Data-new**: 3-5 prompts. Follows the same phase structure as
  orchestrate-poc Phase 7 (types, fixtures, mock routes, service hooks,
  UI), but scoped to the new data only.

- **Cross-boundary**: Same as above, but add a prompt for cross-boundary
  file changes and flag it for manual execution.

### 4.2 Prompt Generation Rules

Each prompt follows the standard orchestration prompt format from
`~/.claude/CLAUDE.md`. Key differences from orchestrate-poc prompts:

- **Context section** includes: "This is an iteration on an existing PoC.
  The feature was built via orchestrate-poc. The PRD is at
  `$PLANS_DIR/poc-<slug>-prd.md`. Read it for full context."

- **Scope section** is narrow: only the files identified in Step 3, not
  a full feature build.

- **Skill references** follow the same worker selection rules as
  orchestrate-poc Step 7.4:

  - Type/schema changes: manual (small changes)
  - Fixture changes: `/build-fixture` if new domain, manual if extending
  - Mock route changes: manual
  - Service hook changes: `/build-react-service-hook` if new,
    `/refactor-react-service-hook` if modifying
  - Container changes: `/refactor-react-route` (iterating, not building
    new)
  - Component changes: `/refactor-react-component` if modifying,
    `/build-react-component` if new
  - Test changes: `/refactor-react-test` if modifying,
    `/build-react-test` if new

- **Verification section** includes the standard tsc + build + eslint
  checks, plus grep commands to verify the specific changes were applied.

- **Behavioral preservation** -- If Step 3.4 identified impacted
  behavioral items, include a "Behavioral Preservation" section in
  each prompt that touches the affected files. The section lists the
  specific items and whether they must be preserved or are intentionally
  changing. Work agents must confirm each item in their reconciliation.

- **Reconciliation block** uses the standard format from
  `~/.claude/CLAUDE.md`.

- **Commit protocol.** Same as orchestrate-poc Step 7.4: every prompt
  includes a "Commit Protocol" section instructing the work agent to
  follow `docs/git-protocol.md`. Use `Phase: iteration` and the
  iteration prompt filename for the trailers.

Write prompt files to `$PLANS_DIR/prompts/poc-<slug>-iter-NN-<phase>.md`,
where NN is a zero-padded sequence number. If previous iteration prompts
exist, continue the numbering from where they left off.

### 4.3 Integration Test Scope

Follow the same integration test scope rules from `~/.claude/CLAUDE.md`.
For most PoC iterations, scope is `none` (the PoC uses fixture data and
does not touch integration specs). If the change modifies integration
fixtures, POMs, or integration specs, scope is `per-prompt`.

### 4.4 Master Plan Update

If a master plan exists at `$PLANS_DIR/poc-<slug>-plan.md`, append an
iteration section:

```markdown
## Iteration: <date> -- <change summary>

> Integration scope: <scope>

### Affected Files

| File | Action | What Changes |
| ---- | ------ | ------------ |
| ...  | ...    | ...          |

### Prompts

| #   | Phase | Prompt                 | Status  |
| --- | ----- | ---------------------- | ------- |
| 1   | ...   | poc-<slug>-iter-NN-... | pending |
```

If no master plan exists, create a lightweight one at
`$PLANS_DIR/poc-<slug>-iter-plan.md` with just the iteration section.

---

<!-- role: workflow -->

## Step 5: Execute the Orchestrator Loop

Follow the IDENTICAL orchestrator loop from `orchestrate-poc` Step 8
and `~/.claude/CLAUDE.md` (Orchestration Protocol):

0. **Re-read the prompt file.** A prior work agent may have modified it.

1. **Decide auto or manual.** Cosmetic and type-only prompts are good
   for auto. Container and component refactors may benefit from manual.

2. **Auto mode:** Launch a work agent via the Task tool. Pass the full
   prompt file contents. The task prompt must begin with: "You are a
   work agent. Execute the following prompt exactly. Read
   ~/github/user-frontend/CLAUDE.md first." followed by:

   > For any TS/TSX source query, use the ast-query dispatcher:
   > `npx tsx scripts/AST/ast-query.ts <query-type> <path>`
   > Do NOT run `npx tsx scripts/AST/ast-*.ts` directly. Do NOT use `rg`, `sg`, or the Grep tool on TS/TSX source.
   > Run `npx tsx scripts/AST/ast-query.ts --help` for available query types.
   > Examples:
   >   WRONG: `npx tsx scripts/AST/ast-imports.ts src/ --symbol Foo --pretty`
   >   RIGHT: `npx tsx scripts/AST/ast-query.ts symbol Foo src/ --pretty`
   >   WRONG: `npx tsx scripts/AST/ast-type-safety.ts src/ --kind AS_ANY_CAST --pretty`
   >   RIGHT: `npx tsx scripts/AST/ast-query.ts as-any src/ --pretty`

3. **Manual mode:** Output the prompt file contents. Wait for the user
   to paste the reconciliation output.

4. **Verify independently.** Run in `~/github/user-frontend`:

   ```
   git log --oneline -10
   # Verify commit message format (last N commits from this prompt)
   git log -5 --format="%s%n%b" | grep -c "^PoC: " || echo "WARNING: recent commits missing PoC trailer"
   pnpm tsc --noEmit -p tsconfig.check.json
   pnpm test --run 2>&1 | tail -5
   pnpm build 2>&1 | tail -5
   npx eslint . --max-warnings 0 2>&1 | tail -3
   ```

5. **Compare results** against the work agent's reconciliation.

6. **Gate.** PASS: update master plan, move to next prompt. FAIL: list
   discrepancies, recommend fix.

7. **Read the cleanup file** after each prompt. If the work agent added
   items, note them.

---

<!-- role: workflow -->

## Step 6: Update the PRD

After all prompts complete and pass verification, update the PRD.

### 6.1 Section Updates

For each PRD section identified in Step 3.3, update the content to
reflect the changes. Rules:

- **Do not rewrite sections that did not change.** Only touch sections
  affected by this iteration.
- **Preserve the PRD's voice and format.** Match the existing writing
  style, heading levels, and formatting conventions.
- **Update, do not append.** If a functional requirement changed, update
  the existing FR in place. Do not add a new FR that contradicts the old
  one.
- **If a new FR was added**, insert it in the appropriate subsection
  with the next sequential FR number.
- **If an FR was removed**, delete it and renumber subsequent FRs.

### 6.2 Changelog Entry

Append a changelog entry at the bottom of the PRD (before any appendix
sections):

```markdown
---

## Changelog

| Date   | Change                      | Sections Updated  |
| ------ | --------------------------- | ----------------- |
| <date> | <1-sentence change summary> | <section numbers> |
```

If a Changelog section already exists, add a new row to the existing
table.

### 6.3 Update Metadata

- Set `Last Updated` in the PRD header to today's date.
- If the status was `Complete`, change it to `Complete -- iterated` to
  signal that the PRD has been modified post-completion.

### 6.4 BFF Handoff Update

If the change affects API contracts (new fields, new endpoints, changed
response shapes) and a BFF handoff document exists at
`$PLANS_DIR/poc-<slug>-bff-handoff.md`:

- Update the affected endpoint definitions.
- Add a note at the top: "Updated <date>: <what changed>."
- Re-run `/document-bff-requirements` to regenerate the BFF requirements
  section in `docs/upcoming-poc-features-needing-bff-work.md` if endpoints
  were added or removed.
- If the BFF team has already started implementation, warn the PM:
  > The BFF handoff document has been updated. If the BFF team has
  > already started implementing these endpoints, coordinate with them
  > on the changes.

---

<!-- role: workflow -->

## Step 7: Final Verification and Report

1. Run the full verification suite:

   ```
   pnpm tsc --noEmit -p tsconfig.check.json
   pnpm build
   npx eslint . --max-warnings 0
   ```

2. If integration scope was `per-prompt` or `final-only`, run:

   ```
   pnpm test:integration
   ```

3. Report to the PM:

   > **Iteration complete: "<change description>"**
   >
   > **Prompts executed:** N
   > **tsc:** 0 errors
   > **Build:** clean
   > **ESLint:** clean
   >
   > **What changed:**
   >
   > - <bullet list of user-visible changes>
   >
   > **PRD updated:** Sections <list>. Changelog entry added.
   > <If BFF handoff updated: "BFF handoff document updated.">
   >
   > **Behavioral items:** <N> preserved, <M> intentionally changed, <P> not applicable
   > **Cleanup items added:** N (see $PLANS_DIR/poc-<slug>-cleanup.md)
   >
   > **To see the changes:** <how to navigate to the feature>

---

<!-- role: guidance -->

## Scope Boundaries

This skill handles iterative changes to an existing PoC. It does NOT
handle:

- **Full feature redesigns.** If the change fundamentally alters the
  feature's purpose, placement, or data model (e.g., "move this from a
  tab to a standalone page" or "replace all the data with a completely
  different dataset"), recommend re-running `orchestrate-poc` with the
  existing spike path instead.

- **PRD-only changes.** If the PM wants to update the PRD text without
  changing code (e.g., stakeholder feedback on wording, adding
  acceptance criteria), recommend `iterate-poc-prd` instead.

- **Bug fixes in the PoC.** If the PM reports a bug (something that does
  not work as the PRD describes), this skill can handle it -- but frame
  the analysis as "the code diverges from the PRD" rather than "the PM
  wants a change."

- **Post-handoff changes.** If the feature has been handed off to
  engineering (Jira tickets created via `generate-handoff-tickets`),
  changes should go through the engineering team's normal process, not
  through PoC iteration. Warn the PM if you detect that handoff tickets
  exist.

---

<!-- role: guidance -->

## Edge Cases

### Multiple changes in one request

If the PM describes multiple independent changes, generate separate
prompt sequences for each. Execute them sequentially -- do not
interleave. After each sub-sequence completes, update the PRD for that
change before starting the next.

If the changes are interdependent (e.g., "add a new column that shows
data from a new metric"), treat them as a single change with the
higher scope classification.

### Change conflicts with cleanup items

If the requested change would resolve an existing cleanup item, note it
in the impact analysis and remove the item from the cleanup file after
the change is applied.

If the requested change would conflict with an existing cleanup item
(e.g., the cleanup says "refactor X to use proper pattern" but the PM
wants to change X's behavior), resolve in favor of the PM's request
and update or remove the cleanup item.

### Change requires new dependencies

If the change requires a new npm package:

1. Ask the PM to confirm the dependency addition.
2. Add `pnpm add <package>` to the first prompt.
3. Note the dependency in the PRD's Engineering Notes.

### Change breaks existing tests

If the change would break existing tests (identified during impact
analysis by reading the test files), include test updates in the same
prompt that makes the production code change. Do not leave tests broken
between prompts.
