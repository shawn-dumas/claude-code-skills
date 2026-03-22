---
name: build-skill
description: Generate a new SKILL.md from a category template. Copies the matching template, fills placeholders, adjusts sections to the domain, and verifies with the skill quality interpreter.
context: fork
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
argument-hint: <skill-name> <category> <one-sentence-description>
---

Generate a new skill file at `.claude/skills/$SKILL_NAME/SKILL.md`.

Parse `$ARGUMENTS` to extract:

- **Skill name** -- the directory name (e.g., `build-react-modal`,
  `audit-api-cache`, `refactor-store`)
- **Category** -- one of: `build`, `audit`, `refactor`, `orchestrate`,
  `other`
- **Description** -- one-sentence summary for the YAML frontmatter

If the category is not provided, infer it from the skill name prefix
(`build-*` -> build, `audit-*` -> audit, `refactor-*` -> refactor,
`orchestrate-*` -> orchestrate). If it cannot be inferred, ask the user.

<!-- role: workflow -->

## Step 1: Validate inputs

1. Verify the skill name does not conflict with an existing skill:
   ```bash
   ls .claude/skills/ | grep "^$SKILL_NAME$"
   ```
2. Verify the category is valid: `build`, `audit`, `refactor`,
   `orchestrate`, or `other`
3. If the skill directory already exists, abort with an error message

<!-- role: workflow -->

## Step 2: Copy the template

Read the matching template from `.claude/skills/templates/`:

| Category      | Template file                                      |
| ------------- | -------------------------------------------------- |
| `build`       | `.claude/skills/templates/TEMPLATE-build.md`       |
| `audit`       | `.claude/skills/templates/TEMPLATE-audit.md`       |
| `refactor`    | `.claude/skills/templates/TEMPLATE-refactor.md`    |
| `orchestrate` | `.claude/skills/templates/TEMPLATE-orchestrate.md` |
| `other`       | `.claude/skills/templates/TEMPLATE-other.md`       |

<!-- role: guidance -->

## Conventions for the generated skill

The generated SKILL.md must follow these rules:

### YAML frontmatter

```yaml
---
name: <skill-name>
description: <one-sentence description>
context: fork
allowed-tools: <tool list based on category>
argument-hint: <argument pattern>
---
```

**`allowed-tools` by category:**

- `build`: `Read, Write, Edit, Grep, Glob, Bash`
- `audit`: `Read, Grep, Glob, Bash`
- `refactor`: `Read, Write, Edit, Grep, Glob, Bash`
- `orchestrate`: `Read, Write, Edit, Grep, Glob, Bash, Task`
- `other`: varies

### Role annotations

Every `##` heading must have a `<!-- role: X -->` annotation. The
template already has these -- preserve them and add annotations to any
new sections. Follow the structured skill format spec in
`.claude/skills/README.md`.

### AST tool references

Include relevant AST tool commands in the Step 0 / survey section. Choose
tools based on what the skill operates on:

| Domain           | Relevant AST tools                                          |
| ---------------- | ----------------------------------------------------------- |
| React components | `ast-react-inventory`, `ast-jsx-analysis`, `ast-complexity` |
| React hooks      | `ast-react-inventory`, `ast-data-layer`                     |
| Test files       | `ast-test-analysis`, `ast-type-safety`                      |
| API handlers     | `ast-complexity`, `ast-type-safety`, `ast-env-access`       |
| General modules  | `ast-complexity`, `ast-type-safety`, `ast-imports`          |
| Skills           | `ast-skill-analysis`, `ast-interpret-skill-quality`         |

### Verification section

Every skill must end with a verification workflow that includes at
minimum:

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```

Build skills should also run the generated tests. Refactor skills should
run `ast-refactor-intent` for behavioral preservation.

<!-- role: emit -->

## Step 3: Generate the skill file

1. Create the directory: `.claude/skills/$SKILL_NAME/`
2. Write `SKILL.md` with the template content, replacing all placeholders:
   - `[Name]` -> skill display name (title case)
   - `[name]` -> skill name (kebab-case)
   - `[category]` -> category
   - `$ARGUMENTS` -> keep as-is (it is a runtime variable)
   - `<target>`, `<target-path>` -> keep as-is (they are argument
     placeholders)
3. Fill in domain-specific content based on what the user described:
   - Detection criteria for audit skills
   - Code templates for build skills
   - Transformation rules for refactor skills
   - Process steps for orchestrate skills
4. Remove template instruction comments (lines starting with `[`)
5. Ensure every `##` heading has a role annotation

<!-- role: workflow -->

## Step 4: Verify

```bash
# Run the skill quality interpreter on the new skill
npx tsx scripts/AST/ast-query.ts interpret-skill .claude/skills/$SKILL_NAME/SKILL.md --pretty

# Verify score is 100/100
# If below 100, fix the issues and re-run

# Verify tsc is clean
pnpm tsc --noEmit -p tsconfig.check.json
```

**Success criteria:**

- Score is 100/100
- Zero `MISSING_SECTION_ROLE` assessments
- All required roles for the category are present
- No stale file references
- No convention drift

<!-- role: emit -->

## Step 5: Update registrations

After generating the skill, update the references:

1. Add the skill to the AGENTS.md skill table (in the appropriate
   category section)
2. If the skill references new AST tools or conventions, verify those
   exist

<!-- role: emit -->

## Step 6: Summary

Report what was generated:

- Skill path: `.claude/skills/$SKILL_NAME/SKILL.md`
- Category: [category]
- Template used: [template name]
- Quality score: [N]/100
- Role annotations: [count]
- Sections: [list of section headings with roles]
