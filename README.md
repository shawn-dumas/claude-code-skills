# Claude Code Skills

A set of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that enforce consistent architecture across the codebase. The **audit** skills are read-only diagnostics that score code against principles and produce violation reports. The **refactor** skills fix those violations. The **build** skills generate new code that follows the same principles from the start. All write skills verify with TypeScript and tests before finishing.

These skills are opinionated. They encode a specific architectural model that prioritizes explicit data flow, clear ownership boundaries, and minimal coupling. If your codebase follows different conventions, you will want to fork and adapt them.

### Plans directory (`$PLANS_DIR`)

Orchestration artifacts (master plans, prompts, cleanup files, PRDs) are
stored in the **plans directory**. Skills reference this as `$PLANS_DIR`.

**Resolution rule (apply once at the start of every orchestration skill):**

1. If `$PLANS_DIR/` exists, use it (`$PLANS_DIR = $PLANS_DIR/`)
2. Otherwise, use `./plans/` relative to the repo root (`$PLANS_DIR = ./plans/`)
3. If neither exists, create `./plans/` and use it

The `$PLANS_DIR` variable is not a shell variable. It is a convention used
in skill instructions. When an agent reads `$PLANS_DIR/prompts/foo.md`, it
resolves the path using the rule above.

## Structured Skill Format

Every SKILL.md file uses HTML comment annotations to declare the **role**
of each section. These annotations enable role-aware convention scanning,
quality scoring, and validation by the AST tooling (`ast-skill-analysis`
and `ast-interpret-skill-quality`).

### Why structured format

Skill files mix several distinct intents: code templates to generate,
anti-patterns to avoid, audit detection criteria, conventions to follow,
test cleanup patterns, and reference data. Without explicit role
annotations, tools cannot distinguish "emit this code" from "flag this
pattern" from "do not use this." This ambiguity causes false positives
in convention drift detection and limits what can be enforced
automatically.

The structured format makes intent explicit. Each section declares what
it is for, and tools use that declaration to apply the right validation
strategy. This shifts enforcement from the LLM (which must infer intent
from context) to tooling (which reads the annotation directly).

### Annotation syntax

Place an HTML comment immediately before the heading it annotates:

```markdown
<!-- role: emit -->

## Code Templates

Code blocks in this section are what the agent generates...

<!-- role: avoid -->

## Anti-patterns

Code blocks here show what NOT to generate...
```

The comment must appear before the heading it annotates. A blank line
between the comment and heading is allowed (the MDAST parser treats
them as adjacent siblings). The format is exactly `<!-- role: <name> -->`
with a single space after `role:`.

### Role taxonomy

| Role        | Purpose                                       | Convention scanner           | Path validation |
| ----------- | --------------------------------------------- | ---------------------------- | --------------- |
| `emit`      | Code the agent should generate                | Scan for superseded patterns | No              |
| `avoid`     | Anti-patterns shown for education             | Skip                         | No              |
| `detect`    | Patterns to flag during audits                | Skip                         | No              |
| `guidance`  | Rules, conventions, principles                | Current-reference check only | No              |
| `reference` | File paths, types, config, background context | Skip                         | Yes             |
| `workflow`  | Steps, verification commands, process         | Skip                         | Yes (commands)  |
| `cleanup`   | Test infrastructure patterns                  | Skip                         | No              |

**`emit`** -- sections where code blocks contain code that agents should
produce. Templates, correct examples, output formats. This is the only
role the convention scanner checks for superseded patterns (old API usage
that should be replaced by current conventions). If a code block shows
`localStorage.getItem()` in an `emit` section, the scanner flags it. If
the same pattern appears in an `avoid` section, it does not.

**`avoid`** -- sections that show anti-patterns for educational purposes.
"Do NOT do this" examples, before/after comparisons where the "before"
is the anti-pattern. Code blocks here deliberately reference old patterns
to teach agents what to avoid. The convention scanner skips these.

**`detect`** -- sections that describe what to look for when auditing
code. Audit criteria, scoring rules, violation definitions. Code
references here name the patterns being flagged, not patterns being
produced. The convention scanner skips these.

**`guidance`** -- sections containing rules, conventions, and principles
that the agent must follow. No code templates, just instructions. The
convention scanner uses these for the "has current reference" check
(verifying the skill mentions the current convention).

**`reference`** -- sections containing file paths, type definitions,
configuration values, background context, and other factual information
the agent needs. The AST tool validates file paths and cross-references
in these sections for staleness.

**`workflow`** -- sections containing step-by-step process instructions
and verification commands. The AST tool validates commands in these
sections against the deprecated command registry.

**`cleanup`** -- sections containing test infrastructure patterns
(`afterEach` cleanup, mock restoration, storage clearing). Code blocks
here use direct APIs (like `localStorage.clear()`) that would be flagged
as convention violations in production code but are legitimate in test
cleanup. The convention scanner skips these.

### Inheritance

A role annotation applies to its heading and all content until the next
heading of equal or higher depth. Subheadings without their own
annotation inherit the parent's role.

```markdown
<!-- role: detect -->

## Step 3: Audit Principle 1

### 3a. Public API assertions (inherits detect from parent)

### 3b. Internal state leaks (inherits detect from parent)

<!-- role: emit -->

## Step 4: Produce the report (new role starts here)
```

Top-level headings (`##`) without a role annotation are flagged by the
AST quality interpreter as `MISSING_SECTION_ROLE`. Subheadings that need
a different role from their parent must have their own annotation.

### Section requirements by category

Each skill category has a minimum set of required roles. The AST quality
interpreter checks these.

| Category      | Required roles               | Notes                                                     |
| ------------- | ---------------------------- | --------------------------------------------------------- |
| `build`       | `emit`, `workflow`           | Must have code templates and verification steps           |
| `audit`       | `detect`, `workflow`         | Must have detection criteria and AST tool / process steps |
| `refactor`    | `detect`, `emit`, `workflow` | Must have audit phase, target output, and verification    |
| `orchestrate` | `emit`, `workflow`           | Must have plan/prompt templates and process steps         |
| `other`       | (none required)              | Flexible structure for non-standard skills                |

Additional roles are welcome in any category. A build skill with an
`avoid` section (anti-patterns to not generate) is more complete, not
a violation.

### Templates

Category-specific templates live in `.claude/skills/templates/`. Use the
matching template when creating a new skill with `/build-skill`. Each
template has pre-placed role annotations and placeholder sections.

| Template                  | Category    | Use for                    |
| ------------------------- | ----------- | -------------------------- |
| `TEMPLATE-build.md`       | build       | New `build-*` skills       |
| `TEMPLATE-audit.md`       | audit       | New `audit-*` skills       |
| `TEMPLATE-refactor.md`    | refactor    | New `refactor-*` skills    |
| `TEMPLATE-orchestrate.md` | orchestrate | New `orchestrate-*` skills |
| `TEMPLATE-other.md`       | other       | Non-standard skills        |

### Meta-skills

Three meta-skills operate on skill files themselves:

| Skill             | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `/audit-skill`    | Score a SKILL.md against the structured format spec |
| `/refactor-skill` | Add role annotations to an existing SKILL.md file   |
| `/build-skill`    | Generate a new SKILL.md from a category template    |

These skills use `ast-skill-analysis` and `ast-interpret-skill-quality`
for automated validation, the same way code skills use `ast-complexity`
and `ast-type-safety`.

## Principles

Full principle text lives in [CATALOG.md](CATALOG.md). Summary:

- **G1-G10 (General Code Principles):** Summarized in project CLAUDE.md.
  Full descriptions with tests and exceptions in CATALOG.md.
- **API Handler Principles:** Parse/Process/Respond, middleware composition,
  co-located schemas, error envelope. Details in CATALOG.md and in the
  `build-api-handler`, `refactor-api-handler`, `audit-api-handler` skill files.
- **React Principles:** DDAU, container boundaries, separation of concerns,
  useEffect discipline, template least-power, type safety. Summarized in
  project CLAUDE.md (DDAU section). Full text in CATALOG.md and in
  individual React skill files.

## Workflow

### Refactoring non-React code

1. **Audit first.** Run `audit-module` on the target file. Read the violation report. Note the test coverage level.
2. **If UNTESTED:** Run `build-module-test` to create a spec file before refactoring. This is your safety net.
3. **Refactor.** Run `refactor-module` on the file. It re-runs the audit internally and applies fixes.
4. **Audit tests.** If tests existed before the refactor, run `audit-module-test` to check for stale mocks. Use `refactor-module-test` to fix violations.
5. **For API handlers:** Run `audit-api-handler` on the handler file. It audits the handler and its schema together. Use `refactor-module` to fix violations.

### Refactoring React code

The ordering is not arbitrary -- it mirrors the dependency graph. You cannot convert components to DDAU until containers exist to absorb their hook calls. Containers cannot be clean until service hooks are standalone and side-effect-free. Service hooks cannot be standalone until factory indirection is eliminated. Each phase unblocks the next.

The audit skill produces a migration checklist in exactly this order, and each checklist item maps to a specific skill invocation. The output of step 1 is the script for steps 2-5.

1. **Audit first.** Run `audit-react-feature` on the feature directory. Read the report. Understand the dependency graph before changing anything.

2. **Service hooks.** Use `refactor-react-service-hook` to clean up data-fetching hooks. Strip side effects, remove factory indirection, enforce single-domain keys. This is the foundation -- containers need clean hooks to wire.

3. **Providers.** Use `refactor-react-provider` to strip data-fetching from providers, split broad contexts, and set up cleanup registration. After this step, providers hold only shared UI state.

4. **Routes/containers.** Use `refactor-react-route` to establish or complete the container boundary for each route. The container absorbs all hook calls, storage, toasts, and cross-domain invalidation.

5. **Components.** Use `refactor-react-component` on remaining self-contained components to convert them to DDAU. At this point the container exists, so the component just needs its hooks removed and its Props interface defined.

6. **Tests.** After refactoring production code, run `audit-react-test` on the affected spec files. Use `refactor-react-test` to fix violations (auto-deletes and delegates to `build-react-test` if beyond repair). Use `build-react-test` to fill coverage gaps for production files that have no spec. Every spec must score 10/10 before the refactor is considered complete.

### Building new code

The build skills follow the same topological order. Each layer depends on the one before it.

1. **Service hooks.** `build-react-service-hook` -- data layer first. The container needs hooks to call.

2. **Providers.** `build-react-provider` -- shared UI state if the feature needs a scoped context. Most features do not.

3. **Routes/containers.** `build-react-route` -- the orchestration boundary. Wires service hooks to components, owns toasts/storage/invalidation.

4. **Components.** `build-react-component` -- leaf UI that renders from props.

5. **Utility hooks.** `build-react-hook` -- DOM or state utilities that any layer might need. These can be created at any point since they have no architectural dependencies.

Each build skill generates a test file that scores 10/10 on `audit-react-test`. If you need to create a standalone test for an existing production file, use `build-react-test` directly.

## Skill Catalog

See [CATALOG.md](CATALOG.md) for descriptions of all 60+ skills organized
by category, full principle text, AST tool inventory, and installation
instructions. Skills are auto-registered from their directories; each
skill's SKILL.md contains its full documentation.
