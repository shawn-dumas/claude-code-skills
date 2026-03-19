---
name: create-feedback-fixture
description: Create a ground-truth feedback fixture when a consuming skill encounters an AST interpreter misclassification. Copies source files, runs the interpreter to capture ALL assessments, and builds the manifest with the corrected expected classification.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
argument-hint: --tool <effects|hooks|ownership|template|test-quality|dead-code|intent|parity|vitest-parity|plan-audit|skill-quality> --file <path> [--files <paths>] --expected <kind> --actual <kind> [--description <brief-slug>]
---

# /create-feedback-fixture

Create a calibration feedback fixture when an interpreter produces a
classification you believe is wrong. The fixture captures the source
code, runs the interpreter to record ALL assessments (not just the
wrong one), and writes a manifest with `status: "pending"`.

## Pre-conditions

Create a feedback fixture ONLY when ALL THREE conditions are met:

1. An interpreter produces a classification you believe is wrong.
2. You investigated and confirmed your classification is correct
   (not just a hunch -- you read the code and can articulate why).
3. The misclassification affected a decision in the skill's workflow
   (not a benign disagreement with no consequence).

Do NOT create a fixture for:

- A classification you are unsure about.
- A classification that was wrong but did not affect any decision.
- An ambiguous case where the interpreter might be right.

## Arguments

Required:

- `--tool <name>`: one of `effects`, `hooks`, `ownership`, `template`,
  `test-quality`, `dead-code`, `intent`, `parity`, `vitest-parity`,
  `plan-audit`, `skill-quality`
- `--file <path>`: primary source file (for entry-based tools) or the
  "before" / "source" / "plan" file
- `--expected <kind>`: what the classification SHOULD be
- `--actual <kind>`: what the interpreter actually produced

Optional:

- `--files <paths>`: additional files (space-separated) when the fixture
  needs multiple files (e.g., import graph for dead-code, after-files
  for intent, target-files for parity)
- `--description <slug>`: short kebab-case description for the directory
  name (default: derived from tool + expected kind)

## Step 1: Validate arguments

Verify:

- `--tool` is one of the 10 supported tools
- `--file` exists on disk
- `--expected` is a valid classification kind for the tool (see table below)
- `--actual` is a valid classification kind for the tool
- `--expected` != `--actual` (otherwise there is no misclassification)

### Valid classification kinds by tool

| Tool          | Valid kinds                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| effects       | DERIVED_STATE, EVENT_HANDLER_DISGUISED, TIMER_RACE, DOM_EFFECT, EXTERNAL_SUBSCRIPTION, NECESSARY                                                                                                                                                                                                                                                                                                                        |
| hooks         | LIKELY_SERVICE_HOOK, LIKELY_CONTEXT_HOOK, LIKELY_AMBIENT_HOOK, LIKELY_STATE_HOOK, UNKNOWN_HOOK                                                                                                                                                                                                                                                                                                                          |
| ownership     | CONTAINER, DDAU_COMPONENT, LAYOUT_SHELL, LEAF_VIOLATION, AMBIGUOUS                                                                                                                                                                                                                                                                                                                                                      |
| template      | EXTRACTION_CANDIDATE, COMPLEXITY_HOTSPOT                                                                                                                                                                                                                                                                                                                                                                                |
| test-quality  | MOCK_BOUNDARY_COMPLIANT, MOCK_INTERNAL_VIOLATION, MOCK_DOMAIN_BOUNDARY, ASSERTION_USER_VISIBLE, ASSERTION_IMPLEMENTATION, ASSERTION_SNAPSHOT, CLEANUP_COMPLETE, CLEANUP_INCOMPLETE, DATA_SOURCING_COMPLIANT, DATA_SOURCING_VIOLATION, ORPHANED_TEST, DELETE_CANDIDATE, DETECTED_STRATEGY                                                                                                                                |
| dead-code     | DEAD_EXPORT, POSSIBLY_DEAD_EXPORT, DEAD_BARREL_REEXPORT, CIRCULAR_DEPENDENCY                                                                                                                                                                                                                                                                                                                                            |
| intent        | PRESERVED, INTENTIONALLY_REMOVED, ACCIDENTALLY_DROPPED, ADDED, CHANGED                                                                                                                                                                                                                                                                                                                                                  |
| parity        | PARITY, EXPANDED, REDUCED, NOT_PORTED                                                                                                                                                                                                                                                                                                                                                                                   |
| vitest-parity | PARITY, EXPANDED, REDUCED, NOT_PORTED                                                                                                                                                                                                                                                                                                                                                                                   |
| plan-audit    | HEADER_COMPLETE, HEADER_DEFICIENCY, VERIFICATION_PRESENT, VERIFICATION_ABSENT, CLEANUP_REFERENCED, CLEANUP_UNREFERENCED, STANDING_ELEMENTS_COMPLETE, STANDING_ELEMENTS_INCOMPLETE, CERTIFICATION_MISSING, CERTIFIED, CONDITIONAL_PREFLIGHT, BLOCKED_PREFLIGHT, PROMPT_WELL_FORMED, PROMPT_DEFICIENCY, DEPENDENCY_CYCLE_DETECTED, PROMPT_FILE_UNRESOLVED, AGGREGATION_RISK, DEFERRED_CLEANUP_NOTED, CONVENTION_REFERENCE |
| skill-quality | STALE_FILE_PATH, STALE_COMMAND, BROKEN_CROSS_REF, BROKEN_DOC_REF, MISSING_SECTION, SECTION_COMPLETE, PATH_VALID, CROSS_REF_VALID                                                                                                                                                                                                                                                                                        |

## Step 2: Create fixture directory

Directory name: `feedback-<YYYY-MM-DD>-<description>/`

Where `<description>` is `--description` if provided, otherwise
`<tool>-<expected-kind-kebab>` (e.g., `effects-derived-state`).

Location: `scripts/AST/ground-truth/fixtures/`

If the directory already exists (same date + description), append a
numeric suffix: `feedback-2026-03-17-effects-derived-state-2/`

## Step 3: Copy source files

### Entry-based tools (effects, hooks, ownership, template, test-quality, dead-code)

Copy `--file` and any `--files` into the fixture directory, preserving
relative subdirectory structure where needed (test-quality and dead-code
may require subdirectories for domain boundary or import graph testing).

For each copied file:

- Strip the original path and use only the basename (or relative path
  from a common ancestor if subdirectories are needed)
- Keep file content exactly as-is -- do NOT simplify or minimize the
  source. Feedback fixtures capture real production code, not synthetic
  minimizations.

### Intent tool

Requires before-files and after-files. The `--file` argument is the
before-file. The `--files` argument must contain the after-file(s).

Copy with naming convention:

- Before files: `before-<ComponentName>.tsx`
- After files: `after-<ComponentName>.tsx`

### Parity / vitest-parity tools

Requires source-spec and target-spec files. The `--file` argument is the
source spec. The `--files` argument must contain the target spec (and
optionally helper files).

Copy with naming convention:

- Source specs: `source-<specName>.spec.ts`
- Target specs: `target-<specName>.spec.ts`
- Helper files: `target-helper-<name>.ts`

### Plan-audit tool

The `--file` argument is the plan markdown file. The `--files` argument
contains prompt files (if any).

Copy as-is (plan.md, prompt-01.md, etc.).

## Step 4: Run the interpreter and capture ALL assessments

This is the critical step. The manifest must include an expected
classification for EVERY assessment the interpreter produces on the
fixture files. The accuracy spec enforces this for feedback fixtures --
incomplete coverage fails the test.

### Entry-based tools

Run the interpreter on the copied files and collect all assessments:

```bash
# effects
npx tsx scripts/AST/ast-interpret-effects.ts <fixture-dir> --json

# hooks
npx tsx scripts/AST/ast-interpret-hooks.ts <fixture-dir> --json

# ownership
npx tsx scripts/AST/ast-interpret-ownership.ts <fixture-dir> --json

# template
npx tsx scripts/AST/ast-interpret-template.ts <fixture-dir> --json

# test-quality
npx tsx scripts/AST/ast-interpret-test-quality.ts <fixture-dir> --json

# dead-code
npx tsx scripts/AST/ast-interpret-dead-code.ts <fixture-dir> --json
```

Parse the JSON output. Each assessment has `kind`, `subject.file`,
`subject.line`, `subject.symbol`.

### Intent tool

```bash
npx tsx scripts/AST/ast-refactor-intent.ts \
  --before <before-files> --after <after-files> --json
npx tsx scripts/AST/ast-interpret-refactor-intent.ts \
  --signal-pair <output-json> --refactor-type <type> --json
```

### Parity / vitest-parity tools

```bash
# parity
npx tsx scripts/AST/ast-interpret-pw-test-parity.ts \
  --source-dir <fixture-dir> --target-dir <fixture-dir> --json

# vitest-parity
npx tsx scripts/AST/ast-interpret-vitest-parity.ts \
  --source-dir <fixture-dir> --target-dir <fixture-dir> --json
```

### Plan-audit tool

```bash
npx tsx scripts/AST/ast-interpret-plan-audit.ts <plan-file> --json
```

### Skill-quality tool

```bash
npx tsx scripts/AST/ast-interpret-skill-quality.ts <skill-file-or-dir>
```

## Step 5: Build the manifest

Create `manifest.json` in the fixture directory. The format depends on
the tool family.

### Entry-based manifest template

```json
{
  "tool": "<tool-name>",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "status": "pending",
  "files": ["<file1>", "<file2>"],
  "expectedClassifications": [
    {
      "file": "<basename>",
      "line": <N>,
      "symbol": "<name>",
      "expectedKind": "<CORRECT-KIND>",
      "notes": "<why this is the correct classification>"
    }
  ]
}
```

For EACH assessment from Step 4:

- Add an entry to `expectedClassifications`
- Use the interpreter's output for `file`, `line`, `symbol`
- Set `expectedKind` to the interpreter's `kind` for ALL assessments
  EXCEPT the misclassified one
- For the misclassified assessment: set `expectedKind` to the
  `--expected` value and add a `notes` field explaining why

### Intent manifest template

```json
{
  "tool": "intent",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "status": "pending",
  "refactorType": "<component|hook|route|provider|service-hook|test>",
  "beforeFiles": ["before-<Name>.tsx"],
  "afterFiles": ["after-<Name>.tsx"],
  "expectedClassifications": [
    {
      "kind": "<OBSERVATION_KIND>",
      "evidence": { "<key>": "<value>" },
      "expectedClassification": "<CORRECT-STATUS>",
      "notes": "<why>"
    }
  ]
}
```

### Parity / vitest-parity manifest template

```json
{
  "tool": "<parity|vitest-parity>",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "status": "pending",
  "sourceFiles": ["source-<name>.spec.ts"],
  "targetFiles": ["target-<name>.spec.ts"],
  "helperFiles": [],
  "expectedClassifications": [
    {
      "testName": "<test name>",
      "expectedStatus": "<CORRECT-STATUS>",
      "notes": "<why>"
    }
  ]
}
```

### Plan-audit manifest template

```json
{
  "tool": "plan-audit",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "status": "pending",
  "planFile": "plan.md",
  "promptFiles": [],
  "expectedVerdict": "<CERTIFIED|CONDITIONAL|BLOCKED>",
  "expectedScoreRange": [<lo>, <hi>],
  "expectedClassifications": [
    {
      "expectedKind": "<CORRECT-KIND>",
      "notes": "<why>"
    }
  ],
  "unexpectedClassifications": ["<kinds that should NOT appear>"]
}
```

## Step 6: Verify the fixture

Run the accuracy spec to confirm the fixture is structurally valid:

```bash
npx vitest run --config scripts/AST/vitest.config.mts \
  scripts/AST/__tests__/interpreter-accuracy.spec.ts
```

The spec should still pass. Pending fixtures are allowed to fail the
per-fixture 50% accuracy floor (that check skips pending fixtures), but
the overall tool accuracy must stay >= threshold.

If the spec fails with a coverage error (UNCOVERED assessments), you
missed an assessment in Step 5. Go back and add the missing entries.

## Step 7: Report

Output a summary:

```
Created feedback fixture: feedback-<date>-<description>/
  Tool: <tool>
  Files: <N> files copied
  Assessments: <N> total, 1 corrected (<actual> -> <expected>)
  Status: pending

Run `/calibrate-ast-interpreter --tool <tool>` when 3+ pending
fixtures accumulate for this tool.
```

## Notes

- Feedback fixtures capture REAL production code. Do not simplify,
  minimize, or rewrite the source files. The whole point is to test the
  interpreter against patterns it failed on in practice.
- The `source: "feedback"` field triggers stricter coverage enforcement
  in the accuracy spec. Every assessment must have a corresponding
  expectedClassification entry.
- Feedback fixtures start as `status: "pending"` and are changed to
  `"calibrated"` by `/calibrate-ast-interpreter`.
- If you realize mid-creation that the interpreter was actually correct
  (your initial assessment was wrong), abort and do not create the
  fixture. Bad ground truth is worse than no ground truth.
- **Negative fixtures** (expect zero assessments): This skill does not
  handle the case where the interpreter should produce NO assessments
  but does. For false positives on a file that should be clean, create
  the fixture manually following `scripts/AST/docs/ast-feedback-loop.md`
  with an empty `expectedClassifications` array.
