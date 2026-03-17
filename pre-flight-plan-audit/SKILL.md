---
name: pre-flight-plan-audit
description: Audit an orchestration plan for structural completeness, convention alignment, and source quality before execution begins. Produces a CERTIFIED / CONDITIONAL / BLOCKED verdict.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task
argument-hint: <path to plan file>
---

Audit the plan at `$ARGUMENTS` before orchestrated execution begins.

You are the pre-flight auditor. Your job is to catch plan quality issues
that would waste execution time or produce incorrect results. You do NOT
execute the plan. You emit a verdict: CERTIFIED, CONDITIONAL, or BLOCKED.

### Resolve paths

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

Use `$PLANS_DIR` for all paths below.

---

## Step 0: Parse the plan with ast-plan-audit

Run the AST tool against the plan file and its prompt files:

```bash
# Find the plan file
PLAN_FILE="$ARGUMENTS"

# Infer prompt glob from plan file name
PLAN_BASENAME=$(basename "$PLAN_FILE" .md)
PROMPT_GLOB="$PLANS_DIR/prompts/${PLAN_BASENAME}-*.md"

# Run the audit tool
npx tsx scripts/AST/ast-plan-audit.ts "$PLAN_FILE" \
  --prompts "$PROMPT_GLOB" --pretty
```

Also run with `--count` to get a summary:

```bash
npx tsx scripts/AST/ast-plan-audit.ts "$PLAN_FILE" \
  --prompts "$PROMPT_GLOB" --count
```

Collect the observations. These feed into the verdict in Step 3.

**Blocker-tier observations** (any of these = BLOCKED):

| Observation | Why it blocks |
|---|---|
| `PLAN_HEADER_MISSING` (Complexity, Duration, Nearest, Created, Branch) | Cannot assess plan scope or find historical comparisons |
| `PLAN_HEADER_INVALID` | Scoring data is unparseable |
| `VERIFICATION_BLOCK_MISSING` | No way to verify execution results |
| `CLEANUP_FILE_MISSING` | No cleanup accumulation target |
| `PROMPT_FILE_MISSING` | Plan references prompts that don't exist |
| `PROMPT_VERIFICATION_MISSING` | Prompt has no verification commands |
| `PROMPT_DEPENDENCY_CYCLE` | Prompts cannot be executed in valid order |
| `PROMPT_MODE_UNSET` | Orchestrator cannot determine auto vs manual dispatch |
| `STANDING_ELEMENT_MISSING` (missing Yes/No/N/A value) | Standing element not triaged |
| `RECONCILIATION_TEMPLATE_MISSING` | Work agents won't produce reconciliation output |

**Warning-tier observations** (do not block, but get annotated):

| Observation | Action |
|---|---|
| `NAMING_CONVENTION_INSTRUCTION` | Cross-reference against target codebase in Step 1 |
| `CLIENT_SIDE_AGGREGATION` | Flag for BFF review |
| `DEFERRED_CLEANUP_REFERENCE` | Check if the deferred item is convention/naming (if so, escalate to blocker) |
| `FILE_PATH_REFERENCE` | Verified in Step 1 (do referenced files exist?) |
| `SKILL_REFERENCE` | Verified in Step 1 (do referenced skills exist?) |

**Informational observations** (no action needed):

| Observation | Meaning |
|---|---|
| `PRE_FLIGHT_CERTIFIED` | Plan was already certified (report date and tier) |
| `PRE_FLIGHT_MARK_MISSING` | Expected -- this tool adds the mark |

---

## Step 1: Convention alignment (target codebase)

Run existing AST tools on the target directories referenced in the plan.
Extract target directories from `FILE_PATH_REFERENCE` observations.

```bash
# Extract unique directory prefixes from file path observations
# (manual step: read the plan's "Relevant Files" or "Inventory" section
#  to identify the target directories)

# Example for a plan touching src/ui/services/hooks/ and src/pages/api/:
npx tsx scripts/AST/ast-imports.ts src/ui/services/hooks/ src/pages/api/ --pretty
npx tsx scripts/AST/ast-data-layer.ts src/ui/services/hooks/ --pretty
npx tsx scripts/AST/ast-react-inventory.ts 'src/ui/page_blocks/**/*.tsx' --pretty
```

Cross-reference the AST tool output against prompt instructions:

1. **Duplicate types**: Do prompts create types that already exist?
   Check `EXPORT_DECLARATION` observations from ast-imports for type/interface
   names mentioned in prompts.

2. **Duplicate query hooks**: Do prompts create hooks for endpoints that
   already have hooks? Check `QUERY_HOOK_DEFINITION` from ast-data-layer.

3. **Duplicate components**: Do prompts create components that duplicate
   existing ones? Check `COMPONENT_DECLARATION` from ast-react-inventory.

4. **Query key collisions**: Do prompts reference query key namespaces
   that collide with existing ones? Check `QUERY_KEY_FACTORY` from
   ast-data-layer.

5. **Naming conventions**: For each `NAMING_CONVENTION_INSTRUCTION`
   observation, check the target codebase's actual convention. If the
   prompt instructs camelCase but the target uses PascalCase (or vice
   versa), this is a **blocker**.

6. **File path validity**: For each `FILE_PATH_REFERENCE`, check if the
   path exists on disk (or will be created by a prior prompt). Missing
   paths that aren't created by prior prompts are **warnings**.

7. **Skill validity**: For each `SKILL_REFERENCE`, check if the skill
   exists in `.claude/skills/`. Missing skills are **blockers**.

8. **Deferred cleanup escalation**: For each `DEFERRED_CLEANUP_REFERENCE`,
   check if the deferred item is about naming conventions, type definitions,
   or structural patterns. If so, escalate to **blocker** -- these should
   be fixed upfront, not deferred.

Record all findings with file, line, and rationale.

---

## Step 2: Source quality pre-screen (port/migration plans only)

**Skip this step** if the plan does not reference a source codebase
(external repo, NGA, etc.). Check the plan's description and context
sections for source references.

If a source codebase IS referenced:

```bash
# Run quality tools on the source directories
npx tsx scripts/AST/ast-type-safety.ts <source-dirs> --pretty
npx tsx scripts/AST/ast-complexity.ts <source-dirs> --pretty
npx tsx scripts/AST/ast-side-effects.ts <source-dirs> --pretty
npx tsx scripts/AST/ast-imports.ts <source-dirs> --pretty
```

Flag and record:

| Condition | Severity |
|---|---|
| Source files with `AS_ANY_CAST` or `NON_NULL_ASSERTION` count > 5 | CONDITIONAL annotation on the prompt that ports those files |
| Source functions with cyclomatic complexity > 10 | CONDITIONAL annotation |
| Source files with `CONSOLE_CALL` (debug artifacts) | CONDITIONAL annotation |
| Source files with `WINDOW_MUTATION` (global side effects) | CONDITIONAL annotation |

These findings do NOT block execution. They become inline annotations
on the affected prompts so the work agent is aware of source quality
issues before porting.

---

## Step 3: Produce verdict

Tally all findings from Steps 0-2.

### BLOCKED

If any blocker-tier finding exists:

1. List every blocker finding with file, line, observation kind, and rationale.
2. Group by category (structural, convention, source quality).
3. For each blocker, suggest the fix (what to add/change in the plan or prompts).
4. Do NOT add a certification mark.
5. Report the full findings to the user.

### CONDITIONAL

If no blockers exist but warnings exist:

1. For each warning, insert an inline HTML comment annotation into the
   affected prompt file at the relevant location:
   ```
   <!-- PRE-FLIGHT: [WARNING_KIND] description of the finding -->
   ```
2. Add the certification mark to the plan file's blockquote header:
   ```
   > Pre-flight: CONDITIONAL <date> by pre-flight-plan-audit
   > Pre-flight findings: 0 blockers, N warnings (annotated in prompts)
   ```
3. Report the findings summary to the user.

### CERTIFIED

If no blockers and no warnings:

1. Add the certification mark to the plan file's blockquote header:
   ```
   > Pre-flight: CERTIFIED <date> by pre-flight-plan-audit
   > Pre-flight findings: 0 blockers, 0 warnings
   ```
2. Report "Plan is certified for execution" to the user.

### Adding the certification mark

Insert the `Pre-flight:` and `Pre-flight findings:` lines into the
plan file's blockquote header. Place them after the last existing `>`
line in the header blockquote.

### When to re-run pre-flight

The certification is invalidated when:
- The plan file is modified after certification (check git diff)
- Prompt files are added, removed, or modified after certification
- The scope of the plan changes (new domains, new prompts)

The orchestrate-* skills check for the `Pre-flight:` header line
before executing. If it is missing or says BLOCKED, they launch this
skill as a sub-agent before proceeding.

---

## Feedback on misclassifications

If the `ast-interpret-plan-audit` verdict or any specific assessment is
wrong (you investigated and confirmed the tool is incorrect), create a
feedback fixture following the plan-audit template in
`scripts/AST/docs/ast-feedback-loop.md`:

1. Create `scripts/AST/ground-truth/fixtures/feedback-<YYYY-MM-DD>-<description>/`
2. Add `plan.md`, prompt files, and `manifest.json` with `"status": "pending"`
3. Set `expectedVerdict`, `expectedScoreRange`, and
   `expectedClassifications` to the CORRECT values (what the tool should
   have produced)

Do NOT create a fixture if you are unsure whether the tool is wrong.
Only create one when the misclassification affected a decision (e.g.,
you would have certified a plan the tool blocked, or vice versa).

---

## Verification

After producing the verdict:

```bash
# Confirm the plan file was updated (CONDITIONAL/CERTIFIED only)
head -20 "$PLAN_FILE" | grep "Pre-flight:"

# Confirm prompt annotations were added (CONDITIONAL only)
grep -r "PRE-FLIGHT:" "$PLANS_DIR/prompts/${PLAN_BASENAME}-"*.md || echo "No annotations (CERTIFIED or BLOCKED)"
```
