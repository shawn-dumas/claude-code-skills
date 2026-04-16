---
name: spawn-satan
description: Adversarial code review. Gathers the recent diff and changed files, launches a ruthless critic sub-agent, then addresses every finding (accept and fix, or reject with justification).
context: fork
allowed-tools: Read, Bash, Task
argument-hint: (no arguments -- reviews the most recent work)
---

Run an adversarial code review of the most recent work in this session.

You are the Coordinator. You gather context, dispatch a critic sub-agent,
and then address every finding the critic raises. You do NOT perform the
critique yourself -- that is the sub-agent's job. Your job is to collect
the diff, launch the critic, and respond to its output.

## Step 1: Gather context

Run these commands to determine what changed:

```bash
git status
git diff HEAD
```

- If there are uncommitted changes, use the `git diff HEAD` output as the diff.
- If the working tree is clean (no uncommitted changes), diff the last
  commit against its parent instead: `git diff HEAD~1..HEAD`.
- Read every changed file **in full** using the Read tool. Do not
  truncate or summarize -- the critic needs complete file content to
  assess context around each change.

Collect:

1. The full diff (staged + unstaged, or last commit)
2. The full content of every file that appears in the diff

## Step 2: Launch the critic

Launch a single Task sub-agent (type: `general`) with a prompt that
includes both the full diff and the full content of every changed file.

Use this prompt template, substituting the actual diff and file contents:

```
You are a ruthless code critic. Review the following changes against
the project's architectural principles as documented in CLAUDE.md and
AGENTS.md (DDAU, general code principles, testing philosophy, naming
conventions, and any other rules the project defines).

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

## Step 3: Address every finding

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
- After all findings are addressed, run `pnpm tsc --noEmit -p tsconfig.check.json` and
  `pnpm test --run` to verify nothing broke. Report the results.

## Output format

After addressing all findings, output a summary:

```
=== SATAN REVIEW ===
Findings: <N total>
Accepted: <N> (fixed)
Rejected: <N> (with justification)
tsc: <0 errors | N errors>
Tests: <pass summary>
=== END SATAN REVIEW ===
```
