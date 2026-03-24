---
name: spawn-satan
description: Adversarial code review. Gathers the recent diff and changed files, launches a ruthless critic sub-agent, then addresses every finding (accept and fix, or reject with justification).
context: fork
allowed-tools: Read, Bash, Task
argument-hint: [<commit-range>] [--stash]
---

Run an adversarial code review of specified changes.

You are the Coordinator. You gather context, dispatch a critic sub-agent,
and then address every finding the critic raises. You do NOT perform the
critique yourself -- that is the sub-agent's job. Your job is to collect
the diff, launch the critic, and respond to its output.

<!-- role: workflow -->

## Step 1: Determine review scope

Parse the argument string to determine which diff to review. Three modes
are supported, and they can be combined:

### Mode A: Commit range (argument is a SHA or range)

If the argument contains a commit-like token (40-char or abbreviated SHA,
or a `..` range), use it directly:

- **Single SHA** (e.g., `abc123`): review that one commit.
  ```bash
  git diff abc123~1..abc123
  ```
- **Range** (e.g., `abc123..def456`): review all commits in the range.
  ```bash
  git diff abc123..def456
  ```
- **Multiple SHAs** (e.g., `abc123 def456 ghi789`): compute the
  bounding range (earliest~1..latest) from the listed commits.
  ```bash
  # Find the oldest and newest by topological order
  git log --format='%H' --reverse abc123 def456 ghi789 | head -1  # oldest
  git log --format='%H' abc123 def456 ghi789 | head -1             # newest
  git diff <oldest>~1..<newest>
  ```

After computing the diff, verify the scope is correct by listing the
commits that fall within the range:

```bash
git log --oneline <range>
```

If the commit list includes commits you do not recognize (e.g., from a
concurrent agent), **warn the user** and list the unexpected commits.
Proceed with the review but note in the output which commits were
reviewed and which were unexpected.

### Mode B: Stash (`--stash`)

If the argument contains `--stash`:

```bash
git stash show -p
```

This reviews the top stash entry. The diff is read-only -- fixes from
Step 3 cannot be applied directly (the stash must be popped first).
If the critic finds issues, list them but note that the stash must be
popped before fixes can be applied. If `--stash` is combined with a
commit range, review both diffs (stash first, then range).

### Mode C: No arguments (default -- current behavior)

If no arguments are provided:

```bash
git status
git diff HEAD
```

- If there are uncommitted changes, use `git diff HEAD` as the diff.
- If the working tree is clean, diff the last commit against its parent:
  `git diff HEAD~1..HEAD`.

**Shared-worktree warning.** In mode C, if the working tree is clean
and the last commit's author does not match the current `user.name` or
contains "Claude" in the author/co-author, warn: "Reviewing the most
recent commit, which may not be your work. Use a commit range to scope
precisely." This catches the exact failure mode we observed: another
agent commits on top of your work, and satan silently reviews their
commit instead.

<!-- role: workflow -->

## Step 2: Gather changed files

Regardless of mode, extract the list of changed files from the diff:

```bash
# For commit range:
git diff --name-only <range>
# For stash:
git stash show --name-only
# For default:
git diff --name-only HEAD  # or HEAD~1..HEAD
```

Read every changed file **in full** using the Read tool. Do not truncate
or summarize -- the critic needs complete file content to assess context
around each change.

Skip deleted files (they appear in the diff but have no content to read).
For renamed files, read the new path.

Collect:

1. The full diff
2. The full content of every file that appears in the diff
3. The review mode used and the exact range/scope

<!-- role: emit -->

## Step 3: Launch the critic

Launch a single Task sub-agent (type: `general`) with a prompt that
includes both the full diff and the full content of every changed file.

Use this prompt template, substituting the actual diff and file contents:

```
You are a ruthless code critic. Review the following changes against
the project's architectural principles as documented in CLAUDE.md and
AGENTS.md (DDAU, general code principles, testing philosophy, naming
conventions, and any other rules the project defines).

Review scope: <mode used and range/SHA>

Focus on:
- Correctness bugs (wrong logic, wrong types, missing edge cases)
- Contract violations (breaking the project's documented conventions)
- Missed edge cases (null, empty, boundary conditions)
- Logical errors in the actual change

Do NOT flag:
- Style preferences (formatting, naming opinions beyond documented rules)
- Aspirational improvements ("this could also do X")
- Issues outside the scope of the diff (pre-existing problems)
- Suggestions that would be nice but are not wrong

For each finding, state:
1. **File** and **line(s)**
2. **What** is wrong (concrete, not vague)
3. **Why** it matters (bug? contract violation? edge case?)
4. **Severity**: bug > contract violation > edge case > minor

Rank findings by severity, most severe first.

If you find zero issues, say so explicitly. Do not invent findings to
appear thorough.

## Diff

<paste full diff here>

## Changed files (full content)

<paste full content of each changed file here, with file path headers>
```

<!-- role: workflow -->

## Step 4: Address every finding

When the critic responds, go through **every** finding one by one.
For each finding, do exactly one of:

- **Accept**: Fix the issue immediately (edit the file), then confirm
  the fix with a brief note: "Fixed: [what was changed]"
- **Reject**: State concretely why the criticism is incorrect, out of
  scope, or does not apply. Cite specific code or documentation.

Rules:

- Do not silently skip any finding.
- Do not batch multiple findings into a vague "addressed several items."
- If a fix introduces a new concern, note it.
- **Stash mode caveat**: If reviewing a stash, you cannot edit files
  directly. List all accepted findings as "Accept (stash -- apply after
  pop)" with the specific fix described. The user must pop the stash
  and apply fixes manually, or re-run satan after popping.
- After all findings are addressed, run `pnpm tsc --noEmit -p tsconfig.check.json` and
  `pnpm test --run` to verify nothing broke. Report the results.

<!-- role: emit -->

## Output format

After addressing all findings, output a summary:

```
=== SATAN REVIEW ===
Scope: <mode and range, e.g., "commit range 3e637c1a..bb26abf9 (8 commits)" or "stash@{0}" or "last commit abc123">
Findings: <N total>
Accepted: <N> (fixed)
Rejected: <N> (with justification)
tsc: <0 errors | N errors>
Tests: <pass summary>
=== END SATAN REVIEW ===
```
