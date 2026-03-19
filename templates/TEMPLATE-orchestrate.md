# Orchestrate: [Name]

> Category: orchestrate
> Trigger: `/orchestrate-[name] <description>`

[One-sentence description of what this skill orchestrates.]

<!-- role: workflow -->
### Resolve $PLANS_DIR

1. If `$PLANS_DIR/` exists, use it
2. Otherwise, use `./plans/` relative to the repo root
3. If neither exists, create `./plans/`

<!-- role: workflow -->
## Step 1: Parse the request

[Extract requirements from the user's description. Identify the scope,
affected domains, and constraints.]

<!-- role: workflow -->
## Step 2: Investigate the codebase

[Survey the codebase to understand current state. List AST tools to
run, files to read, patterns to check.]

```bash
# Adjust tools to the domain
npx tsx scripts/AST/ast-imports.ts <target-dir> --pretty
npx tsx scripts/AST/ast-react-inventory.ts <target-dir> --pretty
```

<!-- role: guidance -->
## Step 3: Decision gates

[Criteria for deciding whether orchestration is needed vs. a simpler
approach. Thresholds for scope, complexity, and dependencies.]

<!-- role: guidance -->
## Step 4: Assess scope

[Rules for classifying the work scope: integration test impact, domains
touched, dependency ordering.]

<!-- role: emit -->
## Step 5: Generate the master plan

Write the plan to `$PLANS_DIR/<plan-name>.md`:

```markdown
# [Plan Name]

> Created: [date]
> Branch: [branch]
> Complexity: D_ S_ Z_ = _._
> Duration: F_ C_ = _h (_-_h)

## Goal

[What this plan achieves.]

## Prompt sequence

| # | Prompt | Mode | Dependencies | Files |
| - | ------ | ---- | ------------ | ----- |
```

### File inventories

[Tables for new files and modified files.]

### Phase ordering

[Topological ordering of implementation phases. Standard order for
this project: types -> service hooks -> providers -> containers ->
components -> tests.]

<!-- role: emit -->
## Step 6: Generate prompts

Write each prompt to `$PLANS_DIR/prompts/<NN>-<name>.md`.

[Prompt structure rules, standing elements, skill references,
verification commands per prompt.]

<!-- role: emit -->
## Step 7: Create the cleanup file

Write to `$PLANS_DIR/<plan-name>-cleanup.md`:

```markdown
# Cleanup: [Plan Name]

Items discovered during execution that are out of scope for the
current prompt. Reviewed after all prompts complete.

(empty -- populated during execution)
```

<!-- role: workflow -->
## Step 8: Pre-flight audit (MANDATORY)

```
/pre-flight-plan-audit $PLANS_DIR/<plan-name>.md
```

[Gate on CERTIFIED or CONDITIONAL verdict. BLOCKED halts execution.]

<!-- role: workflow -->
## Step 9: Validate the plan (MANDATORY)

```
/validate-plan $PLANS_DIR/<plan-name>.md
```

[Multi-layer validation: adversarial review, deep review, PoC gate.]

<!-- role: workflow -->
## Step 10: Present to user

[Show the plan summary, prompt sequence, complexity scores. Wait for
approval before executing.]

<!-- role: workflow -->
## Step 11: Execute the orchestrator loop

[For each prompt in sequence:
1. Run the prompt (auto via Task tool, or manual)
2. Verify output (tsc, tests, AST checks)
3. Collect reconciliation from the work agent
4. Gate on quality before proceeding
5. Append any out-of-scope discoveries to the cleanup file]

<!-- role: workflow -->
## Step 12: Generate the cleanup prompt

[Read the cleanup file. Generate a final prompt that addresses
accumulated items. Present to user for review before executing.]

<!-- role: workflow -->
## Step 13: Final verification

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm build
pnpm test
# Domain-specific checks
```

<!-- role: workflow -->
## Step 14: Archive the plan

```
/archive-plan <plan-name>
```
