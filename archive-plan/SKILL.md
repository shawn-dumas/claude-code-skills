---
name: archive-plan
description: Archive a completed orchestration plan. Collects execution metrics, calibrates scores, gzips prompts, updates historical-reference.md, and disposes cleanup items.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task, TodoWrite
argument-hint: "The plan file name (e.g., 'authz-enforcement' or 'authz-enforcement.md')"
---

# Skill: archive-plan

Archive a completed orchestration plan. `$ARGUMENTS`

**Execute this skill yourself. Do NOT delegate to a sub-agent via Task.**
The archiving agent needs the full session context: which findings were
deferred then resolved, which cleanup items map to which backlog numbers,
what the actual execution metrics were, and what the adversarial review
found. A sub-agent starts with none of this context and will produce
inaccurate cleanup dispositions, wrong backlog item numbers, stale
finding statuses, and incorrect verification counts -- all of which the
orchestrator then has to review and fix, doubling the work.

### Resolve paths

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

Use `$PLANS_DIR` for all paths below.

---

## Step 0: Locate plan files

Parse `$ARGUMENTS` to get the plan basename (strip `.md` if present).

Locate these files (all must exist or be accounted for):

- `$PLANS_DIR/<basename>.md` -- the plan file
- `$PLANS_DIR/<basename>-cleanup.md` -- the cleanup file
- `$PLANS_DIR/prompts/<basename>-*.md` -- the prompt files

Read the plan file header to extract: D, S, Z, F, C, blended score,
duration estimate, branch name, created date.

If the plan file is already in `$PLANS_DIR/archive/`, it was moved
early. Read it from there instead.

---

## Step 1: Collect execution metrics

### 1a. Git metrics

From the repo the plan targeted (usually `~/github/user-frontend/`):

```bash
# Commit count
git log --oneline <base-branch>..<plan-branch> | wc -l

# First and last commit timestamps (wall clock)
git log --format="%ai" <base-branch>..<plan-branch> | tail -1   # first
git log --format="%ai" <base-branch>..<plan-branch> | head -1   # last

# Compute wall-clock duration from timestamps
```

### 1b. Session DB metrics

Check the Claude Code DB:

```bash
# Check if DB has data
sqlite3 ~/.local/share/Claude/Claude.db ".schema" 2>/dev/null
```

If the DB has data, query for sessions related to the plan:

```sql
SELECT id, json_extract(data, '$.title') as title,
  datetime(time_created/1000, 'unixepoch', 'localtime') as created
FROM session
WHERE json_extract(data, '$.title') LIKE '%<plan-keyword>%'
ORDER BY time_created;
```

Then count: agents (T+S), questions, user msgs, compactions,
abandoned todos, failed tools.

If the DB is empty or unavailable, record "No DB data" in notes.
Proceed with git-only metrics.

---

## Step 2: Post-execution calibration

Compare predicted scores against actual execution data.

### 2a. F (Failure exposure) calibration

Compare predicted F against actual failed-tool count:

| Predicted F | Expected failed tools | Action if divergent |
|---|---|---|
| 1-2 | 0-2 | No action |
| 3-4 | 0-49 | If actual is 0, consider F adjustment to 2 |
| 5-6 | 27-99 | Adjust if actual is far outside range |
| 7+ | 40+ | Adjust if actual is far outside range |

### 2b. C (Calendar risk) calibration

Compare predicted C against actual calendar span:

| Predicted C | Expected wall clock | Action if divergent |
|---|---|---|
| 1 | 0.3h - 4.5h | No action if within range |
| 2 | 3h - 6h | Adjust if under 2h or over 8h |
| 3-4 | 5h - 25h | Adjust if far outside range |

### 2c. D/S/Z calibration

Check for clear divergences: a Z7 plan that executed in 16 minutes,
an agent count wildly out of line with peers at the same blended score.

### 2d. Record adjustments

If any dimension diverged:

1. Update the **Adj** column in the Complexity Scoring table
2. Append adjustment rationale to the reasoning entry:
   `**Adj X.X (D/S/Z change)**: <evidence>` or
   `**F/C adj**: <evidence>`

### 2e. Feedback fixture (if plan audit interpreter was wrong)

If `ast-plan-audit` certified the plan but execution revealed structural
issues the tool should have caught, OR if the tool blocked/conditioned
the plan but the findings were invalid:

```bash
# Create a feedback fixture
/create-feedback-fixture --tool plan-audit --file <plan-file> \
  --expected <correct-verdict> --actual <tool-verdict>
```

If the plan audit was accurate, skip this step.

---

## Step 3: Handle cleanup file items

Read the cleanup file. For each item:

1. **If actionable and small**: note it for the backlog file
   (`$PLANS_DIR/backlog.md`) or `KNOWN-DEBT-AND-DECISIONS.md`
2. **If already resolved**: note as resolved, no action
3. **If superseded by another plan**: note which plan

Record the disposition of each item. Do not leave items unaccounted for.

---

## Step 4: Archive files

### 4a. Move plan + cleanup to archive

```bash
mv "$PLANS_DIR/<basename>.md" "$PLANS_DIR/archive/"
mv "$PLANS_DIR/<basename>-cleanup.md" "$PLANS_DIR/archive/"
```

### 4b. Gzip prompt files

Compress all prompt files into a single tarball, then remove originals:

```bash
cd "$PLANS_DIR/prompts"
tar czf "$PLANS_DIR/archive/<basename>-prompts.tar.gz" <basename>-*.md
rm <basename>-*.md
```

This keeps the archive compact. The tarball can be extracted later if
prompt contents need review.

### 4c. Verify archive

```bash
ls -la "$PLANS_DIR/archive/<basename>"*
# Expected: plan .md, cleanup .md, prompts .tar.gz
```

---

## Step 5: Update historical-reference.md

Read `$PLANS_DIR/historical-reference.md`. All edits go in this file.

### 5a. Add row to Complexity Scoring table

Insert a new row at the correct rank position. Rank is determined by
blended score (descending), then D (descending), then S (descending).
Within the same blended/D/S, insert after existing rows.

Assign the next available rank number (find the highest existing rank
and add 1).

Format:
```
| <rank> | <plan name> | <blended> | <adj> | <D> | <S> | <Z> | <F> | <C> | <status> |
```

Use `--` for Adj unless an adjustment was made in Step 2.

### 5b. Update header count

The first line says "NN archived plans (N NGA, N UF)." Increment the
total and the UF count (or NGA if applicable).

### 5c. Verify cross-references

After inserting the new row, check if any reasoning notes reference
rank numbers that shifted. Rank numbers are stable identifiers and
should NOT be renumbered -- but verify that no existing note references
the new rank number for a different plan.

### 5d. Add execution metrics row

Insert a new row in the Execution Metrics table (in the appropriate
section based on data source). Format:

```
| <rank> | <plan name> | <agents> | <commits> | <wall clock> | <questions> | <user msgs> | <compactions> | <abandoned todos> | <failed tools> | <notes> |
```

Use `\*` for unavailable metrics.

### 5e. Add reasoning entry

Append a numbered entry at the end of the Reasoning Notes section
(before the "Reference Documents" section). Follow the format of
existing entries. Include:

- Prompt count and brief description of each prompt
- D/S/Z/F/C justification with evidence
- Per-prompt rate (wall clock / prompts)
- Comparison to nearest neighbors
- Pre-execution overhead (if significant)
- Any adjustments from Step 2

### 5f. Feed execution data into scoring algorithm

Update the F and C anchor tables in `$PLANS_DIR/CLAUDE.md`:

1. Find the F anchor table row matching the plan's F score. If the
   actual failed-tool count falls outside the "Observed failed tools"
   range, widen the range. Add the plan as evidence.

2. Find the C anchor table row matching the plan's C score. If the
   actual wall clock falls outside the "Observed wall clock" range,
   widen the range. Add the plan as evidence.

3. Increment the `n=NN` count in both anchor tables.

4. If the plan adds a new example to an under-represented band in the
   Scoring Guide table, add it.

5. If the per-prompt rate diverges significantly from the base_rate
   calibration examples (currently 0.23-1.59 h/prompt), note it.

---

## Step 6: Update active plans table

In `$PLANS_DIR/CLAUDE.md`, find the Active Plans table. Either:

- Change the plan's status from "Not started" / "In progress" to
  "Complete"
- Or remove the row entirely if the plan is fully archived

---

## Step 7: Cross-repo updates (if applicable)

Check if the plan modified files outside the main repo:

- `~/.claude/CLAUDE.md` (AST-confirmed categories, tool hierarchy, etc.)
- `~/.claude/skills/` (skill sync needed after skill modifications)

If cross-repo changes were part of the plan's post-merge steps, verify
they were completed. If not, complete them now.

---

## Step 8: Commit and push

Commit all changes to the plans repo:

```bash
cd "$PLANS_DIR"
git add -A
git commit -m "archive: <plan-name> (D<n> S<n> Z<n> = <blended>, <wall-clock>)"
git push origin main
```

---

## Verification

After all steps:

```bash
# Plan file is in archive
ls "$PLANS_DIR/archive/<basename>.md"

# Prompts are gzipped
ls "$PLANS_DIR/archive/<basename>-prompts.tar.gz"

# No plan files left in active directory
ls "$PLANS_DIR/<basename>"* 2>/dev/null && echo "FAIL: files not archived" || echo "PASS"
ls "$PLANS_DIR/prompts/<basename>"* 2>/dev/null && echo "FAIL: prompts not archived" || echo "PASS"

# Historical reference updated
grep '<plan-name>' "$PLANS_DIR/historical-reference.md"

# Active plans table updated
grep '<plan-name>' "$PLANS_DIR/CLAUDE.md" | grep -i 'complete'
```

---

## Output summary

```
=== ARCHIVE: <plan-name> ===

## Scores
- Predicted: D<n> S<n> Z<n> = <blended>, F<n> C<n> = <estimated>h
- Actual: <wall-clock>, <failed-tools> failed tools, <commits> commits
- Adjustment: <none | Adj description>
- Per-prompt rate: <n>h/prompt

## Metrics
- Agents: <T+S>
- Commits: <n>
- Wall clock: <duration>
- Failed tools: <n>
- Notes: <any caveats>

## Cleanup disposition
- <item 1>: <moved to backlog | resolved | noted in KNOWN-DEBT>
- ...

## Files archived
- $PLANS_DIR/archive/<basename>.md
- $PLANS_DIR/archive/<basename>-cleanup.md
- $PLANS_DIR/archive/<basename>-prompts.tar.gz

## Historical reference
- Rank: #<n>
- Scoring table: updated
- Execution metrics: updated
- Reasoning notes: updated
- F/C anchor tables: <updated | no change needed>

=== END ARCHIVE ===
```
