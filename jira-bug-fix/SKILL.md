---
name: jira-bug-fix
description: End-to-end red-to-green Jira bug fix workflow. Fetches the ticket, creates an isolated worktree off development, writes a failing test, applies the fix, runs spawn-satan, opens a PR, and updates Jira.
context: fork
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, mcp__atlassian__jira_get_issue, mcp__atlassian__jira_add_comment, mcp__atlassian__jira_transition_issue, mcp__atlassian__jira_get_transitions, mcp__atlassian__jira_update_issue
argument-hint: <AV-XXXX> -- single Jira ticket key, e.g. AV-6417
---

Execute an end-to-end bug fix for a Jira ticket. `$ARGUMENTS`

You are the bug-fix agent. Given a single Jira ticket key (e.g. `AV-6417`),
you run the full red-to-green workflow from ticket read through PR open
and Jira update. You own the complete loop -- there is no orchestrator.

Read `~/github/user-frontend/CLAUDE.md` before starting. You are working
in the UF repo; `development` is the base branch; `AV-` is the Jira
project key.

<!-- role: reference -->

## Ticket and Branch Conventions

| Convention            | Value                                                      |
| --------------------- | ---------------------------------------------------------- |
| Repo                  | `~/github/user-frontend`                                   |
| Base branch           | `development`                                              |
| Jira project          | `AV`                                                       |
| Worktree path         | `/tmp/<lowercase-ticket>` (e.g. `/tmp/av-6417`)            |
| Branch name           | `fix/<lowercase-ticket>` (e.g. `fix/av-6417`)              |
| PR base               | `development`                                              |

**Branch prefix rule.** Use `fix/` not `sd/`. The `environment-protections`
ruleset blocks follow-up pushes to `sd/**` branches after a PR is created
(`require_last_push_approval: true`). `fix/` is outside the rule set.

**Jira configuration.**

| Setting       | Value                                  |
| ------------- | -------------------------------------- |
| Cloud ID      | `e2fc351a-3244-4e39-8b5e-93b72d731707` |
| Site URL      | `https://8flow.atlassian.net`          |
| Project key   | `AV`                                   |

**Jira transition IDs** (used in Step 9):

| Target status       | Transition ID |
| ------------------- | ------------- |
| In Progress         | `21`          |
| Ready for PR Review | `51`          |
| Ready for Testing   | `71`          |

<!-- role: workflow -->

## Step 1: Validate the argument and fetch `development`

1. Parse `$ARGUMENTS`. It must be a single ticket key matching `AV-\d+`.
   Uppercase it. Derive the lowercase form (e.g. `av-6417`) for the
   worktree path and branch name.

2. If the argument is missing or malformed, abort with:
   `jira-bug-fix requires a single AV-NNNN ticket key, got: <arg>`.

3. Confirm the ticket does not already have an active worktree:

   ```bash
   if [ -d /tmp/<lowercase-ticket> ]; then
     echo "ABORT: /tmp/<lowercase-ticket> already exists"
     exit 1
   fi
   ```

4. Fetch the latest `development` from origin in the main repo clone
   (do NOT checkout -- the worktree in Step 3 branches from the
   fetched ref):

   ```bash
   cd ~/github/user-frontend
   git fetch origin development
   ```

5. Capture the current `development` sha for the reconciliation output
   in Step 10:

   ```bash
   DEV_SHA=$(git rev-parse origin/development)
   ```

<!-- role: workflow -->

## Step 2: Read the Jira ticket

Fetch the ticket and parse the bug description. Use
`mcp__atlassian__jira_get_issue` with `fields: ["summary", "status",
"priority", "issuetype", "description", "assignee"]` and
`responseContentFormat: "markdown"`.

Extract:

- **Summary** -- used for the PR title and commit message
- **Description** -- the reproduction steps, expected vs. actual behavior,
  and any file paths or component names the reporter mentioned
- **Priority** -- noted in the PR body
- **Status** -- verify the ticket is in a state that can be worked
  (Draft, Ready for Development, In Progress). If it is in a later
  state (In Testing, Done, Closed), abort and ask the user whether to
  reopen it.
- **Issuetype** -- must be `Bug`. If it is a Task or Story, warn the
  user and ask whether to proceed.

If the description is empty, vague, or missing reproduction steps,
stop and ask the user for clarification before continuing. Do not
guess at the root cause.

**Record the summary verbatim** -- it anchors the commit message, the
PR title, and the Jira comment.

<!-- role: workflow -->

## Step 3: Create the worktree off `development`

Create a dedicated worktree so this fix is isolated from any other
work in progress on the main clone:

```bash
cd ~/github/user-frontend
git worktree add -b fix/<lowercase-ticket> /tmp/<lowercase-ticket> origin/development
cd /tmp/<lowercase-ticket>
```

From this point forward, **every command runs inside
`/tmp/<lowercase-ticket>`**. Do not touch the main clone at
`~/github/user-frontend` until Step 8.

Confirm the worktree is clean and on the new branch:

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean, branch `fix/<lowercase-ticket>`.

<!-- role: workflow -->

## Step 4: Investigate and write the red test

### 4a. Locate the bug

Use the ticket description to find the affected files. Follow the
tool hierarchy:

```bash
# TS/TSX source queries -- use ast-query dispatcher, NOT rg/sg/Grep
npx tsx scripts/AST/ast-query.ts symbol <SymbolFromTicket> src/ --pretty
npx tsx scripts/AST/ast-query.ts hooks src/ui/page_blocks/<area>/ --pretty
npx tsx scripts/AST/ast-query.ts complexity src/ui/page_blocks/<area>/ --pretty
```

Read the files in the data flow chain (service hook -> container ->
component) until you can name the root cause in one sentence, with a
specific file:line citation.

### 4b. Confirm causality before hypothesizing

Per the bug investigation protocol: `git log` on the suspect file
BEFORE forming hypotheses. Verify the commit that introduced the
bug (or confirm the bug has always been present). Never trust an
agent root-cause without checking causality.

```bash
git log --oneline -20 -- <suspect-file>
```

### 4c. Write the failing test (RED)

Pick the matching `/build-*-test` skill for the file type:

- React component, container, hook: `/build-react-test`
- Non-React module, utility, API handler: `/build-module-test`
- Full page route through the browser: `/build-playwright-test`

The test must reproduce the bug described in the ticket. Assert on
the user-visible outcome, not implementation details.

Run the test and **confirm it fails with the expected error**:

```bash
pnpm test --run <path-to-new-spec> 2>&1 | tail -30
```

The output must show the test failing for the reason the ticket
describes. If it passes, you have not reproduced the bug. Stop and
re-read the ticket. Do not proceed until red is proven.

**Red-to-green protocol is mandatory.** A test written after the fix
never proves it catches the bug. The red step is the proof that the
test exercises the actual failure mode.

<!-- role: workflow -->

## Step 5: Apply the fix (GREEN)

Apply the minimal change that turns the red test green. If the fix
touches a React component, hook, provider, service hook, or route,
use the matching `/refactor-react-*` skill rather than editing by
hand. If it is a trivial fix (a missing `return`, a wrong comparison
operator, a single typo), editing directly is allowed.

Run the same test command and confirm it passes:

```bash
pnpm test --run <path-to-new-spec> 2>&1 | tail -30
```

Then run the full verification suite:

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm test --run 2>&1 | tail -5
pnpm build 2>&1 | tail -5
npx eslint . --max-warnings 0 2>&1 | tail -3
```

All four must be clean before you proceed. If any fail, fix the
issue and re-run. Do NOT commit until every check passes.

<!-- role: workflow -->

## Step 6: Commit the red-to-green checkpoint

**This step is mandatory before Step 7.** The `/spawn-satan` agent
can revert the working tree or commit files as separate commits
during its review. Running satan on uncommitted work has cost work
twice in the past. Commit first, then run satan against the committed
diff.

Stage only the files you modified -- never `git add -A` or `git add .`:

```bash
git add <test-file> <fix-file-1> <fix-file-2>
git status   # verify nothing unexpected is staged
```

Commit with a HEREDOC message referencing the ticket:

```bash
git commit -m "$(cat <<'EOF'
fix(<AV-NNNN>): <ticket summary>

<1-2 sentence description of the root cause and fix>

Red-to-green: test at <path-to-new-spec> fails on `origin/development`
and passes with this fix applied.

Refs: <AV-NNNN>
EOF
)"
```

Capture the commit sha for the reconciliation output:

```bash
FIX_SHA=$(git rev-parse HEAD)
```

<!-- role: workflow -->

## Step 7: Run spawn-satan and drive findings to zero

With the red-to-green commit in place, run the adversarial review:

```
/spawn-satan
```

For every finding satan produces:

- **Accept and fix**: apply the fix, re-run the verification suite,
  amend the commit (the fix commit is still the tip -- amend is
  safe here because nothing has been pushed).
- **Reject with justification**: write a one-line reason. Genuine
  false positives are fine; do not accept work just to clear the
  queue.

Re-run satan after fixes until it reports zero findings or only
rejected findings. Do not proceed until the finding queue is clean.

**Verify the working tree after satan completes.** If satan reverted
anything or committed unrelated files, restore the expected state
before moving on:

```bash
git log --oneline -5
git status
```

The tip should still be your fix commit (possibly amended). The tree
should be clean.

<!-- role: workflow -->

## Step 8: Push the branch and open the PR

Push the branch directly from the worktree:

```bash
git push -u origin fix/<lowercase-ticket>
```

Create the PR with `gh`. The title is `fix(<AV-NNNN>): <ticket summary>`
(under 70 characters). Use a HEREDOC for the body so formatting is
preserved:

```bash
gh pr create --base development --title "fix(<AV-NNNN>): <ticket summary>" --body "$(cat <<'EOF'
## Summary

- Fixes [<AV-NNNN>](https://8flow.atlassian.net/browse/<AV-NNNN>)
- Root cause: <one-line root cause>
- Fix: <one-line fix description>

## Test Plan

- [x] Red test added at `<path-to-new-spec>` -- fails on `origin/development`
- [x] Green after fix -- `pnpm test --run <path-to-new-spec>` passes
- [x] Full suite: `pnpm tsc --noEmit -p tsconfig.check.json && pnpm test && pnpm build && pnpm lint`
- [x] Adversarial review: `/spawn-satan` findings resolved

## Manual Verification

<3-5 reproduction steps from the ticket, rewritten as a checklist>

Refs: <AV-NNNN>
EOF
)"
```

Capture the PR URL from the `gh` output. You need it for Step 9.

<!-- role: workflow -->

## Step 9: Update the Jira ticket

Update the ticket in two calls:

### 9a. Comment with the PR link

```
mcp__atlassian__jira_add_comment(
  issue_key: "<AV-NNNN>",
  comment: "PR opened: <PR-URL>\n\nRed-to-green bug fix. Red test at `<path-to-new-spec>` fails on `origin/development` and passes with this fix applied."
)
```

### 9b. Transition status

Check the ticket's current status and transition to the correct next
state. The transition IDs are in the reference table at the top of
this skill. The typical flow for a bug fix:

- If the ticket was in `Draft` or `Ready for Development`, transition
  to `Ready for PR Review` (ID `51`).
- If the ticket was in `In Progress`, transition to `Ready for PR Review`
  (ID `51`).

If you are unsure which transition applies, call
`mcp__atlassian__jira_get_transitions` first to list the valid
transitions for this ticket in its current state.

```
mcp__atlassian__jira_transition_issue(
  issue_key: "<AV-NNNN>",
  transition: { id: "51" }
)
```

Confirm the new status to the user.

<!-- role: workflow -->

## Step 10: Final reconciliation and cleanup

Output a reconciliation block so the user can verify the run:

```
=== RECONCILIATION: jira-bug-fix <AV-NNNN> ===
Ticket: <AV-NNNN> -- <summary>
Base:   origin/development @ <DEV_SHA>
Branch: fix/<lowercase-ticket>
Worktree: /tmp/<lowercase-ticket>
Fix commit: <FIX_SHA>
Red test: <path-to-new-spec>
PR: <PR-URL>

Verification:
  tsc: <0 errors | N errors>
  Tests: <N specs, M passed>
  Build: <clean | failed>
  ESLint: <clean | N errors, M warnings>
  Satan: <N findings, M accepted, K rejected>

Jira:
  Comment posted: yes
  Transition: <from status> -> <to status>

Worktree status: <left in place | removed>
=== END RECONCILIATION ===
```

**Do not remove the worktree automatically.** Ask the user whether to
keep it (for manual verification or follow-up fixes) or remove it.
If they say remove:

```bash
cd ~/github/user-frontend
git worktree remove /tmp/<lowercase-ticket>
```

The branch stays on origin regardless -- `git worktree remove` does
not delete the remote ref.

<!-- role: emit -->

## Commit message template

Every fix commit from this skill follows this exact shape:

```
fix(<AV-NNNN>): <ticket summary verbatim>

<1-2 sentence root cause and fix description>

Red-to-green: test at <path-to-new-spec> fails on `origin/development`
and passes with this fix applied.

Refs: <AV-NNNN>
```

Rules:

- `fix(AV-NNNN)` prefix always. Not `bugfix:`, not `[AV-NNNN]`, not
  `AV-NNNN:`.
- Summary is the Jira summary verbatim, not a paraphrase.
- No `Co-Authored-By` lines unless the user explicitly asks for them.
- No `--no-verify`. The pre-commit hook runs prettier, ESLint, and tsc;
  skipping it hides regressions.

<!-- role: emit -->

## PR body template

```markdown
## Summary

- Fixes [<AV-NNNN>](https://8flow.atlassian.net/browse/<AV-NNNN>)
- Root cause: <one-line root cause>
- Fix: <one-line fix description>

## Test Plan

- [x] Red test added at `<path-to-new-spec>` -- fails on `origin/development`
- [x] Green after fix -- `pnpm test --run <path-to-new-spec>` passes
- [x] Full suite: `pnpm tsc --noEmit -p tsconfig.check.json && pnpm test && pnpm build && pnpm lint`
- [x] Adversarial review: `/spawn-satan` findings resolved

## Manual Verification

<reproduction checklist from the ticket>

Refs: <AV-NNNN>
```

<!-- role: guidance -->

## Decision gates

These are the points where the workflow stops and waits for the user
or aborts. Do not paper over them.

1. **Ticket argument malformed.** Abort with a clear error.
2. **Worktree path already exists.** Abort. Do not stomp on an
   in-progress worktree.
3. **Ticket description vague.** Stop and ask the user for reproduction
   steps. Do not guess.
4. **Ticket is not a Bug.** Warn and ask whether to proceed. Task and
   Story tickets are usually feature work and should go through
   `/orchestrate-feature` instead.
5. **Red test does not fail.** Stop. You have not reproduced the bug.
   Re-read the ticket.
6. **Verification suite fails after the fix.** Stop. Do not commit
   until tsc + tests + build + ESLint are all clean.
7. **Satan finds work you cannot justify rejecting.** Fix it. The
   adversarial review is a quality gate, not a checkbox.
8. **Push fails.** Do NOT switch to a different branch prefix to work
   around it. If the push is rejected by the `environment-protections`
   ruleset, it means the branch name is wrong. Rename to `fix/...`
   and re-push.
9. **Jira transition fails.** Report the error, leave the PR open,
   and ask the user to transition manually.

<!-- role: avoid -->

## Anti-patterns

These are the mistakes that have cost work before. Do not do these.

```bash
# WRONG: running satan before committing
/spawn-satan             # satan can revert uncommitted changes
git commit -m "fix"      # never happens because satan reverted the tree

# RIGHT: commit first, then satan
git add <files>
git commit -m "..."
/spawn-satan
```

```bash
# WRONG: sd/ branch prefix -- blocked by environment-protections
git checkout -b sd/av-6417

# RIGHT: fix/ prefix
git checkout -b fix/av-6417
```

```bash
# WRONG: writing the test after the fix
# (apply the fix)
# (write a test that passes)
# (commit)

# RIGHT: red-to-green
# (write the test)
# (run it -- confirm red)
# (apply the fix)
# (run it -- confirm green)
# (commit both)
```

```bash
# WRONG: git add -A in a shared worktree
git add -A               # stages files you did not modify

# RIGHT: named files only
git add src/ui/path/FooComponent.tsx src/ui/path/__tests__/FooComponent.spec.tsx
```

```bash
# WRONG: --no-verify to skip pre-commit
git commit --no-verify -m "fix"   # bypasses prettier, ESLint, tsc

# RIGHT: fix the hook failure
pnpm tsc --noEmit -p tsconfig.check.json
# (fix errors)
git commit -m "..."
```

```typescript
// WRONG: using rg/sg/Grep for TS source
// rg "useFoo" src/
// sg --pattern 'useFoo($ARG)' src/

// RIGHT: ast-query for TS/TSX
// npx tsx scripts/AST/ast-query.ts symbol useFoo src/ --pretty
```

<!-- role: workflow -->

## Verification

Before the skill is considered complete, every item below must be true:

```bash
# Inside the worktree at /tmp/<lowercase-ticket>
pnpm tsc --noEmit -p tsconfig.check.json          # 0 errors
pnpm test --run 2>&1 | tail -5                    # all pass
pnpm build 2>&1 | tail -5                         # clean
npx eslint . --max-warnings 0 2>&1 | tail -3      # clean
pnpm test --run <path-to-new-spec> 2>&1 | tail -5 # green

# Branch and PR state
git log --oneline -5                              # fix commit is tip
git rev-parse --abbrev-ref HEAD                   # fix/<lowercase-ticket>
gh pr view --json url,state                       # PR open, URL present
```

Success criteria:

- Red test exists, was proven red before the fix, is green after the fix
- All four verification commands are clean
- `/spawn-satan` finding queue is empty or all findings have
  justifications
- PR is open against `development` with the correct title and body
- Jira ticket has a comment with the PR URL and is in the correct
  next status
- Worktree is either intentionally preserved or cleanly removed
