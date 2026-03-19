---
name: refactor-skill
description: Add role annotations to an existing SKILL.md file. Reads the skill content, classifies each section by its dominant content type, and inserts HTML comment annotations. Preserves all content -- only adds annotations.
context: fork
allowed-tools: Read, Edit, Grep, Glob, Bash
argument-hint: <path/to/skill-directory-or-SKILL.md>
---

Add role annotations to the skill file at `$ARGUMENTS`. This skill adds
`<!-- role: X -->` HTML comments before each top-level heading based on
the section's content. It does not rewrite prose, restructure headings,
or change any existing content.

If the argument is a directory, refactor the `SKILL.md` file in that
directory. If it is a file path, refactor that file directly.

<!-- role: guidance -->

## Prerequisite

Run the audit skill first to see the current state:

```
/audit-skill $ARGUMENTS
```

If the skill already scores 100/100 with full role coverage, there is
nothing to refactor.

<!-- role: workflow -->

## Step 0: Run AST analysis tools

```bash
# Current state -- observation layer
npx tsx scripts/AST/ast-skill-analysis.ts $ARGUMENTS --pretty

# Current state -- quality scoring
npx tsx scripts/AST/ast-interpret-skill-quality.ts $ARGUMENTS --pretty
```

Record the current score and missing role count before making changes.

<!-- role: workflow -->

## Step 1: Read and inventory the skill

1. Read the entire SKILL.md file
2. Identify the skill's category from its directory name prefix
   (`build-*` -> build, `audit-*` -> audit, `refactor-*` -> refactor,
   `orchestrate-*` -> orchestrate, everything else -> other)
3. List every `##` heading with its line number
4. For each heading, note whether it already has a `<!-- role: X -->`
   annotation on the preceding line
5. Skip headings that already have annotations

<!-- role: detect -->

## Step 2: Classify each section

For each unannotated `##` heading, read the section content (from the
heading to the next `##` heading or end of file) and classify its dominant
content type into a role.

### Classification rules

Use these heuristics in priority order. The first matching rule wins.

**`emit`** -- the section contains code templates that agents should
generate. Indicators:

- Code blocks with template placeholders (`[Name]`, `$ARGUMENTS`, etc.)
- Instructions like "generate," "create," "produce," "write," "output"
- File content templates (barrel exports, component skeletons, test files)
- Report format templates (the output the agent produces)
- Summary/output sections describing what to report back

**`avoid`** -- the section shows anti-patterns. Indicators:

- "Do NOT," "WRONG," "anti-pattern," "never," before/after pairs
- Code blocks prefixed with comments like `// WRONG:` or `// BAD:`
- Sections titled "Anti-patterns," "Common mistakes," "What not to do"

**`detect`** -- the section describes audit criteria or what to look for.
Indicators:

- "Check for," "look for," "flag," "violation," "finding," "score"
- Scoring rules and severity classifications
- Principle-to-signal mapping tables
- Sections titled with "Audit," "Detect," "Check," "Score," "Principle"

**`guidance`** -- the section contains rules and conventions. Indicators:

- Imperative instructions ("must," "always," "never" without code examples)
- Principle statements, design rules, architectural constraints
- Prerequisites and preconditions
- Sections titled "Rules," "Conventions," "Prerequisites," "Guidelines"

**`reference`** -- the section contains factual data. Indicators:

- File path listings, type definitions, config values
- Background context that informs but does not instruct
- Tables mapping tool names to outputs, or types to locations
- Sections titled "Background," "Context," "File map," "Type touchpoints"

**`workflow`** -- the section contains process steps or verification.
Indicators:

- Numbered step-by-step instructions
- Bash commands to run (verification, AST tools, tsc, tests)
- Decision gates, conditional flows, "if X then Y"
- Sections titled "Step N:," "Verify," "Process"

**`cleanup`** -- the section contains test infrastructure patterns.
Indicators:

- `afterEach` cleanup code, mock restoration, storage clearing
- Trigger/cleanup tables
- Only applies to test-related skills

### Role distribution reference

Use this as a sanity check. These are the expected role distributions
by category from investigation of the existing 55 skills:

| Role      | build | audit | refactor | orchestrate |
| --------- | ----- | ----- | -------- | ----------- |
| workflow  | ~36%  | ~12%  | ~25%     | ~45%        |
| emit      | ~55%  | ~4%   | ~12%     | ~35%        |
| detect    | 0%    | ~62%  | ~37%     | 0%          |
| guidance  | 0%    | ~12%  | ~12%     | ~15%        |
| reference | ~9%   | ~8%   | ~4%      | ~5%         |
| avoid     | 0%    | 0%    | ~21%     | 0%          |
| cleanup   | 0%    | ~4%   | 0%       | 0%          |

If your classification diverges significantly from these distributions,
re-read the section content.

<!-- role: emit -->

## Step 3: Insert annotations

For each classified heading, insert `<!-- role: X -->` on the line
immediately preceding the `##` heading. Use the Edit tool for each
insertion.

**Format requirements:**

- Exactly `<!-- role: <name> -->` with a single space after `role:`
- On the line immediately preceding the heading (no blank line between)
- One of the seven valid roles: `emit`, `avoid`, `detect`, `guidance`,
  `reference`, `workflow`, `cleanup`

**Subheading rules:**

- `###` and deeper headings inherit the parent `##` role by default
- Only add an annotation to a subheading if its content has a DIFFERENT
  role from its parent (e.g., a `reference` subsection under an `emit`
  section)
- Do not annotate subheadings that match their parent's role -- that is
  noise

**H1 heading (`#`):**

- The title heading does not need a role annotation. It is metadata, not
  content. The interpreter does not flag H1 headings.

<!-- role: avoid -->

## Common mistakes

**Over-annotating subheadings.** If every `###` under a `## detect`
section is also `detect`, the annotations are redundant. Only annotate
subheadings that override the parent.

**Misclassifying report templates as `reference`.** A report format that
the agent produces is `emit`, not `reference`. Reference is for input
data, not output format.

**Misclassifying verification commands as `emit`.** Bash commands the
agent runs for verification are `workflow`, not `emit`. The agent runs
these commands, it does not generate them as output.

**Classifying "Step N:" headings by their title alone.** The title says
"Step" (workflow), but the content might be detection criteria (detect)
or code generation (emit). Always read the content.

<!-- role: workflow -->

## Step 4: Verify

```bash
# Re-run the interpreter to check the score
npx tsx scripts/AST/ast-interpret-skill-quality.ts $ARGUMENTS --pretty

# Verify no score decrease
# The score should be >= the pre-refactor score

# Verify tsc is clean (the SKILL.md is not TypeScript, but ensure no
# accidental edits to other files)
pnpm tsc --noEmit -p tsconfig.check.json
```

**Success criteria:**

- Score is 100/100
- Zero `MISSING_SECTION_ROLE` assessments
- All required roles for the category are present (`ROLE_REQUIREMENT_MET`)
- No new `CONVENTION_DRIFT` assessments introduced

If the score dropped, the annotation inserted a blank line or disrupted
the heading structure. Check the edit and fix.

<!-- role: emit -->

## Step 5: Summary

Report what was changed:

- Skill name and category
- Annotations added (count, with line numbers and roles)
- Score before and after
- Any subheading overrides added
- Any findings that need manual attention (content-role mismatches)
