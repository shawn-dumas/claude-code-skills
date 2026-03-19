---
name: audit-skill
description: Score a SKILL.md file against the structured skill format spec. Reports role coverage, missing annotations, required role compliance, convention drift, and stale references. Read-only diagnostic.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/skill-directory-or-SKILL.md>
---

Audit the skill file at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a structured report scoring the SKILL.md against the
structured skill format specification.

If the argument is a directory, audit the `SKILL.md` file in that directory.
If it is a file path, audit that file directly. If it is a glob or the
`.claude/skills/` root, audit all matching SKILL.md files and produce a
summary table.

<!-- role: reference -->

## Background

The structured skill format is specified in `.claude/skills/README.md` under
"Structured Skill Format." Key requirements:

- Every top-level heading (`##`) must have a `<!-- role: X -->` annotation
  on the preceding line
- Seven valid roles: `emit`, `avoid`, `detect`, `guidance`, `reference`,
  `workflow`, `cleanup`
- Subheadings inherit the parent's role unless they have their own annotation
- Each skill category has required roles (see table below)
- Role annotations enable role-aware convention scanning (only `emit` sections
  are checked for superseded patterns)

### Required roles by category

| Category      | Required roles               |
| ------------- | ---------------------------- |
| `build`       | `emit`, `workflow`           |
| `audit`       | `detect`, `workflow`         |
| `refactor`    | `detect`, `emit`, `workflow` |
| `orchestrate` | `emit`, `workflow`           |
| `other`       | (none required)              |

### Category detection

The AST tool infers category from the skill directory name prefix:
`build-*` -> build, `audit-*` -> audit, `refactor-*` -> refactor,
`orchestrate-*` -> orchestrate. Everything else is `other`.

<!-- role: workflow -->

## Step 0: Run AST analysis tools

```bash
# Observation layer -- structural analysis of the SKILL.md
npx tsx scripts/AST/ast-skill-analysis.ts $ARGUMENTS --pretty

# Assessment layer -- quality scoring and role validation
npx tsx scripts/AST/ast-interpret-skill-quality.ts $ARGUMENTS --pretty
```

For batch audit of all skills:

```bash
# Summary: count of skills at 100/100
npx tsx scripts/AST/ast-interpret-skill-quality.ts .claude/skills/ --pretty \
  | grep -c "Score: 100"

# Find skills below 100
npx tsx scripts/AST/ast-interpret-skill-quality.ts .claude/skills/ --pretty \
  | grep -v "Score: 100"
```

<!-- role: reference -->

### Using observations and assessments

**Observations** from `ast-skill-analysis`:

| Observation Kind       | Evidence                                        | Audit use                       |
| ---------------------- | ----------------------------------------------- | ------------------------------- |
| `SKILL_SECTION`        | `depth`, `text`, `sectionRole`, `roleInherited` | Role coverage inventory         |
| `SKILL_SECTION_ROLE`   | `sectionRole`, `text`, `depth`                  | Explicit annotation count       |
| `SKILL_STEP`           | `stepNumber`, `text`                            | Workflow structure              |
| `SKILL_CODE_BLOCK`     | `language`, `lineCount`                         | Convention scanning targets     |
| `SKILL_COMMAND_REF`    | `command`                                       | Command staleness check         |
| `SKILL_FILE_PATH_REF`  | `filePath`, `exists`                            | Stale path detection            |
| `SKILL_CROSS_REF`      | `target`, `exists`                              | Stale cross-reference detection |
| `SKILL_DOC_REF`        | `docPath`, `exists`                             | Stale doc reference detection   |
| `SKILL_TABLE`          | `columns`, `rows`                               | Table structure                 |
| `SKILL_CHECKLIST_ITEM` | `checked`, `text`                               | Checklist structure             |

**Assessments** from `ast-interpret-skill-quality`:

| Assessment Kind            | Meaning                                 | Score impact |
| -------------------------- | --------------------------------------- | ------------ |
| `SECTION_COMPLETE`         | Required section is present             | (positive)   |
| `MISSING_SECTION`          | Required section is absent              | -3 per       |
| `STALE_FILE_PATH`          | Referenced file does not exist          | -5 per       |
| `BROKEN_CROSS_REF`         | Referenced skill does not exist         | -5 per       |
| `BROKEN_DOC_REF`           | Referenced doc does not exist           | -5 per       |
| `CONVENTION_DRIFT`         | Code block uses superseded pattern      | -10 per      |
| `MISSING_SECTION_ROLE`     | Top-level heading lacks role annotation | -2 per       |
| `ROLE_REQUIREMENT_MET`     | Required role for category is present   | (positive)   |
| `ROLE_REQUIREMENT_MISSING` | Required role for category is absent    | -3 per       |

<!-- role: detect -->

## Step 1: Role annotation coverage

Check every top-level heading (`##`) for a role annotation:

1. Run the interpreter and check for `MISSING_SECTION_ROLE` assessments
2. For each missing annotation, record the heading text and line number
3. If the skill has zero annotations total, note this as "pre-migration"
   (backward compat mode -- no role penalties apply)

**Violation:** Any `##` heading without `<!-- role: X -->` on the preceding
line (in a skill that has at least one annotation).

<!-- role: detect -->

## Step 2: Required role compliance

Check the skill's category against the required roles table:

1. Collect all distinct roles from `SKILL_SECTION_ROLE` observations
2. Compare against `requiredRoles[category]` from `ast-config.ts`
3. For each missing required role, record it as a `ROLE_REQUIREMENT_MISSING`

**Violation:** A required role for the category is not present in any
section annotation.

<!-- role: detect -->

## Step 3: Convention drift

Check code blocks in `emit` sections for superseded patterns:

1. The `scanConventions()` function in `ast-skill-analysis` handles this
   automatically -- it only checks code blocks with role `emit` (or no role
   for backward compat)
2. Each `CONVENTION_DRIFT` assessment indicates a code template that uses
   an old API instead of the current convention
3. Record the rule ID, line number, and the superseded pattern found

**Violation:** A code block in an `emit` section references a superseded
pattern (e.g., `localStorage.getItem` instead of `readStorage`).

<!-- role: detect -->

## Step 4: Stale references

Check file paths, cross-references, and doc references:

1. `STALE_FILE_REF` -- a `SKILL_FILE_PATH_REF` observation where `exists`
   is false
2. `STALE_CROSS_REF` -- a `SKILL_CROSS_REF` observation where `exists`
   is false
3. `STALE_DOC_REF` -- a `SKILL_DOC_REF` observation where `exists` is
   false

**Violation:** Any reference to a file, skill, or doc that does not exist
at the referenced path.

<!-- role: detect -->

## Step 5: Section structure

Check for required sections per the skill category:

1. `MISSING_SECTION` assessments flag absent sections (e.g., a build skill
   missing a Verify step)
2. Cross-reference with the category templates in `.claude/skills/templates/`
   for expected structure

**Violation:** A section required by the skill's category template is
absent.

<!-- role: detect -->

## Step 6: Role inheritance correctness

Verify that role inheritance follows the depth-based rules:

1. A subheading (`###`, `####`) should inherit from the nearest annotated
   ancestor heading at shallower depth
2. If a subheading has its own annotation, that overrides inheritance
3. Check for cases where a subheading's content contradicts its inherited
   role (e.g., an `emit` code template under a `detect` heading)

This requires manual review -- the AST tool handles inheritance
resolution mechanically, but content-role mismatch detection needs human
judgment.

<!-- role: emit -->

## Produce the audit report

```
## Skill Audit Report: [skill-name]

Category: [category]
Score: [N]/100
Role annotations: [count] explicit, [count] inherited, [count] missing

### Scorecard

| Dimension           | Status | Details                      |
| ------------------- | ------ | ---------------------------- |
| Role coverage       | [P/F]  | [N] of [M] headings covered |
| Required roles      | [P/F]  | [list present/missing]       |
| Convention drift    | [P/F]  | [N] superseded patterns      |
| Stale references    | [P/F]  | [N] stale paths/refs         |
| Section structure   | [P/F]  | [N] missing sections         |

### Role inventory

| Line | Heading                  | Role      | Source     |
| ---- | ------------------------ | --------- | ---------- |
| [N]  | [heading text]           | [role]    | explicit   |
| [N]  | [heading text]           | [role]    | inherited  |
| [N]  | [heading text]           | --        | MISSING    |

### Findings

[Per-finding details: line, assessment kind, severity, description]

### Migration priority

[If pre-migration (zero annotations): recommend /refactor-skill]
[If partially annotated: list missing annotations in priority order]
[If fully annotated: list convention drift and stale refs to fix]
```

<!-- role: workflow -->

## Interpreter calibration gate

If the audit reveals an assessment that appears incorrect (the interpreter
classified something wrong), create a feedback fixture:

```
/create-feedback-fixture ast-interpret-skill-quality <skill-path>
```

This records the misclassification for the next calibration cycle.
