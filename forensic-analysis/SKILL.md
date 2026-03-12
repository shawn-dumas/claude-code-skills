---
name: forensic-analysis
description: Investigate agent and orchestration failures. Determines the data source era, reads the appropriate forensic reference, and walks a structured 10-phase postmortem workflow.
context: fork
allowed-tools: Read, Bash, Grep, Glob, Task, Question
argument-hint: <optional: incident description, session ID, date range, or commit SHA>
---

Run a forensic investigation of an agent or orchestration failure.

You are the Investigator. You gather objective evidence from git history
and agent session databases, establish what actually happened, compare it
against what the agent was told to do, and produce a structured postmortem
report. You do NOT edit production code. This is a read-only investigation.

## Step 0: Determine scope and data sources

If `$ARGUMENTS` provides a clear incident (date, session ID, commit SHA,
or description), use it. Otherwise, ask the user:

- What went wrong? (one sentence)
- When did it happen? (date or approximate time window)
- Which branch?

### Era routing

Three forensic data sources exist, covering different time periods.
Git forensics applies to all periods.

| Period                | Source            | Reference file                          |
| --------------------- | ----------------- | --------------------------------------- |
| Feb 10 - Mar 6, 2026  | Claude Code JSONL | `~/postmortem/claude-code-forensics.md` |
| Mar 3, 2026 - present | OpenCode SQLite   | `~/postmortem/opencode-forensics.md`    |
| All periods           | Git history       | `~/postmortem/git-forensics.md`         |

The overlap (Mar 3-6) may have data in both sources from different tools
running concurrently. Do not double-count.

**Determine the era from the incident date**, then read the relevant
forensic reference(s) using the Read tool:

1. **Always** read `~/postmortem/git-forensics.md` -- git evidence is
   used in every investigation.
2. If the incident is **before Mar 3, 2026**: also read
   `~/postmortem/claude-code-forensics.md`.
3. If the incident is **Mar 3, 2026 or later**: also read
   `~/postmortem/opencode-forensics.md`.
4. If the incident spans the **overlap period (Mar 3-6)**: read both.

**Database locations:**

- OpenCode SQLite: `~/.local/share/opencode/opencode.db`
- Claude Code JSONL: `~/.claude/projects/` (project dirs with session
  JSONL files)

Do NOT read the forensic references until you need them. Read git
forensics at Phase 2a. Read the session database reference at Phase 2b.

## Step 1: Identify the incident

**Goal:** Define what went wrong in one sentence. Identify the time
window, sessions, branch, and commits involved.

1. Get or confirm the user's account of what happened.

2. Identify the orchestration plan and prompt number (if applicable):

   ```bash
   ls ~/plans/
   ```

   Read the relevant master plan and prompt files.

3. Identify the git branch, HEAD, and relevant commits:

   ```bash
   git log --oneline -20
   git reflog -20
   ```

4. Identify the sessions involved. Use the queries from the forensic
   reference you loaded (see Step 0). For OpenCode, query the session
   table by time window. For Claude Code JSONL, use recipe 8.10
   (session resume detection) and 8.11 (aggregate metrics).

5. Map the orchestrator to its child sessions (if this was orchestrated
   work).

**Output:** Session IDs, time window, branch, commit range, one-sentence
incident description.

## Step 2: Establish the objective record

**Goal:** Build a timeline from sources the agent cannot manipulate: git
history and the session database.

### 2a: Git evidence

Now read `~/postmortem/git-forensics.md` if you have not already.

6. Extract the commit sequence in the time window.
7. For each commit, classify files as production vs. test.
8. Check commit timing feasibility (use the reference baselines from
   git-forensics.md section 2).

### 2b: Database evidence

Now read the appropriate session database forensic reference.

9. Check for compaction events in each session.
10. Check for reconciliation blocks.
11. List all files the session edited (filter for production code).
12. Check what commands the session ran.

**Output:** A factual timeline with commit timestamps, compaction events,
file edits, and commands run. No interpretation yet.

## Step 3: Read the prompt rules

**Goal:** Establish what the agent was told to do (and not do).

13. Read the prompt file that was given to the work agent.
14. Extract scope restrictions, file restrictions, deviation handling
    rules, reconciliation format requirements, and verification commands.
15. Read the orchestration protocol rules from CLAUDE.md (or AGENTS.md).
16. Note any Mode designation (Auto vs. Manual).

**Output:** A checklist of rules the agent was bound by.

## Step 4: Trace the decision points

**Goal:** Find the moments where the agent deviated from the rules, and
understand why.

17. For each violation identified in Phase 2, find the surrounding text
    output in the session database.
18. Check if the deviation happened before or after a compaction.
19. Check if the user prompted the deviation.
20. For scope violations, check if the agent explored alternatives first
    (search for reasoning parts).
21. Build a full timeline for the critical window (interleaving all part
    types).

**Output:** For each violation, the trigger, the agent's reasoning (if
visible), and whether context loss was a factor.

## Step 5: Evaluate the changes

**Goal:** Determine whether out-of-scope changes are correct, regardless
of the process failure.

22. Read the actual diffs.
23. Read the production code before and after.
24. For each production change, answer: Is this fixing a real bug? Would
    a test-only workaround have been possible? Does the fix introduce
    new risks? Was the approach correct?
25. If the change touches library internals, verify the agent's
    understanding independently.

**Output:** Per-change verdict: correct / incorrect / uncertain, with
evidence.

## Step 6: Root cause analysis

**Goal:** Identify why the failure happened, not just what happened.

26. Classify each violation by root cause:

    - **Role boundary violation:** orchestrator wrote production code
    - **Compaction-induced amnesia:** rules lost after context compaction
    - **Momentum override:** deep debugging created commitment to a fix
    - **Premature reporting:** reconciliation produced before work done
    - **Missing gate:** prompt lacked an explicit restriction
    - **Environment mismatch:** agent could not run required verification
    - **Deferred verification:** "verify later" that never happened

27. Identify contributing factors: compaction count, user triggers,
    ambiguous scope language, session length / context pressure.

28. Identify systemic factors: repeat failure modes, protocol gaps,
    whether tool-level enforcement would have prevented it.

**Output:** Numbered root causes (RC1, RC2, ...) with evidence citations.

## Step 7: Write the report

**Goal:** Produce a structured postmortem document.

29. Create the report file at `~/postmortem/YYYY-MM-DD-<short-name>.md`.

30. Use this structure:

    ```markdown
    # Postmortem: <Short Description>

    **Date:** YYYY-MM-DD
    **Branch:** <branch name>
    **Commits:** <relevant SHAs>
    **Sessions:** <session IDs>

    ## Timeline

    Chronological table: Time | Actor | Event

    ## What Went Wrong

    Numbered sections, one per violation. Each includes:

    - What the rule says
    - What the agent did
    - Evidence (session ID, timestamp, quoted text)

    ## Root Causes

    RC1, RC2, ... with evidence citations.

    ## What We Can Learn

    L1, L2, ... Specific, actionable recommendations.
    Each says WHO needs to change WHAT.

    ## Summary of Violations

    Table: # | Rule | Violated By | Severity

    ## Decision Still Needed

    Open questions requiring user judgment (keep/revert, protocol
    updates, etc.)
    ```

31. Include session IDs and timestamps inline so findings are
    reproducible.

32. Distinguish findings of fact (objective, from git/DB) from
    interpretation. Label interpretations as such.

## Step 8: Extract protocol improvements

**Goal:** Turn lessons into concrete changes.

33. For each lesson, draft specific language changes to the orchestration
    protocol, prompt templates, or work agent rules.

34. Classify each improvement by enforceability:

    - **Tool-level:** enforced by the system (highest reliability)
    - **Prompt-level:** enforced by instructions in context (medium --
      lost on compaction)
    - **Process-level:** enforced by user behavior (lowest reliability)

35. Prioritize improvements that move from prompt-level to tool-level
    enforcement.

## Step 9: Independent verification

**Goal:** Verify every factual assertion in the postmortem. The author
is never the verifier. A separate session performs verification.

This phase cannot be done in the same session that wrote the report.
Inform the user that Phase 9 requires a fresh session and provide
instructions:

> Phase 9 (independent verification) must be run in a separate session.
> Start a new conversation and ask it to verify the postmortem at
> `~/postmortem/YYYY-MM-DD-<short-name>.md` against primary sources.
> The verifier should read the forensic references and re-run every
> query cited in the report.

The verification protocol (claim classification, omission checks,
activity gap verification) is documented in `~/postmortem/CLAUDE.md`
Phase 9.

## Step 10: Publish

**Goal:** Update the postmortem repo.

36. Add a row to the Postmortems table in `~/postmortem/README.md`.
37. Review the README for accuracy.
38. Commit and push:

    ```bash
    git -C ~/postmortem add -A
    git -C ~/postmortem commit -m "Add postmortem: YYYY-MM-DD-<short-name>"
    git -C ~/postmortem push
    ```

## Anti-patterns

Do not fall into these traps during investigation:

1. **Do not trust summaries of summaries.** Agent postmortems about
   other agents frequently contain fabricated details. Verify against
   source parts.

2. **Do not use `data LIKE '%keyword%'` without verification.** Broad
   LIKE patterns match across all JSON fields. Use
   `json_extract(data, '$.state.input.command') LIKE '%keyword%'` for
   precision. See `opencode-forensics.md` section 1 for the worked
   example.

3. **Do not assume the last commit is the final state.** Agents
   sometimes commit, keep working, and make additional uncommitted
   changes.

4. **Do not conflate "the agent said it" with "the agent did it."**
   Text output and reconciliation blocks are self-reported. Commands
   and git commits are objective.

5. **Do not skip Phase 5 (evaluating correctness).** A process
   violation does not mean the code is wrong. The postmortem must
   answer both "was the process followed?" and "is the code right?"
