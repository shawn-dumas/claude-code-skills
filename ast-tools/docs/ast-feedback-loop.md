# Feedback Loop Guide

When a consuming skill (audit, refactor, build) runs an AST interpreter
and disagrees with a classification, it creates a **feedback fixture** --
a ground-truth entry that the calibration skill uses to improve the
interpreter. This guide is the single source of truth for that procedure.

The `/create-feedback-fixture` skill automates this procedure. Consuming
skills point to it via their "Interpreter Calibration Gate" sections.
Use the skill for standard cases (one misclassified assessment). For
edge cases the skill does not handle (negative fixtures, complex
multi-file setups), follow the manual procedure below.

The accuracy spec (`interpreter-accuracy.spec.ts`) enforces completeness
for feedback fixtures in CI -- see [Coverage enforcement](#coverage-enforcement).

## When to create a feedback fixture

Create a feedback fixture when **all three conditions** are met:

1. An interpreter produces a classification you believe is wrong.
2. You investigated and confirmed your classification is correct (you
   understand the code, not just disagreeing on instinct).
3. The misclassification affected a decision in the skill's workflow
   (you would have done something differently if the tool had been right).

Do NOT create a fixture for:

- A classification you are unsure about.
- A classification that is wrong but did not affect any decision.
- A case where the code itself is ambiguous (the interpreter might be
  right for different reasons than you expect).

## Common procedure (all tools)

### Step 1: Create the fixture directory

```
scripts/AST/ground-truth/fixtures/feedback-<YYYY-MM-DD>-<brief-description>/
```

Example: `feedback-2026-03-16-effect-timer-race/`

### Step 2: Copy source files as snapshots

Copy the relevant source file(s) into the fixture directory. These are
**snapshots** -- frozen copies of the code at this moment. Not symlinks,
not path references. The files must be self-contained within the fixture
directory.

File naming depends on the tool -- see per-tool templates below.

### Step 3: Write `manifest.json`

The manifest declares the fixture metadata and expected classifications.
The exact schema varies by tool -- see per-tool templates below.

**Critical: Classify ALL signals.** The manifest must include an expected
classification for every assessment the interpreter produces on these
files, not just the misclassified one. The calibration skill tunes
weights across all signals simultaneously. If you only document the one
wrong signal, calibration may fix it but regress three others because it
had no ground truth for them.

The accuracy spec enforces this rule for `source: "feedback"` fixtures.
If you create a fixture with fewer `expectedClassifications` entries
than the interpreter produces assessments, the test will fail with a
message listing the uncovered assessments.

To find all assessments for your fixture files, run the interpreter
and count the output (see per-tool commands below).

### Step 4: Set status to `"pending"`

All new feedback fixtures start as `"pending"`. This exempts them from
the per-fixture 50% accuracy floor (the whole point is that the
interpreter gets this case wrong). The calibration skill changes the
status to `"calibrated"` after tuning.

### Step 5: Note the fixture in skill output

Add to the skill's summary: "Created calibration fixture:
`feedback-<date>-<description>`. Run `/calibrate-ast-interpreter
--tool <name>` when 3+ pending fixtures accumulate."

### Step 6: Do NOT fix the interpreter

Separation of measurement and optimization. The feedback loop creates
ground truth. The calibration skill fixes the interpreter. Do not
short-circuit this by editing `ast-config.ts` or interpreter code
during fixture authoring.

## Coverage enforcement

The accuracy spec (`interpreter-accuracy.spec.ts`) checks coverage for
all entry-based fixtures with `source: "feedback"`. After matching
`expectedClassifications` against interpreter output, it identifies
assessments that were not matched by any expected classification. If
there are uncovered assessments, the test fails with:

```
Feedback fixture [<name>] has N uncovered assessment(s). Feedback
fixtures must classify ALL signals -- the calibration skill needs the
full picture to tune weights without regressing other classifications.
Add the missing assessments to expectedClassifications.
```

This catches the most common authoring failure: creating a fixture
that only documents the misclassified signal while ignoring the others.

## Per-tool templates

---

### Effects (`ast-interpret-effects`)

**Run the interpreter to see all assessments:**

```bash
npx tsx scripts/AST/ast-interpret-effects.ts <fixture-file> --pretty
```

**Fixture files:** Copy the source file (plain name, no prefix).

**Manifest template:**

```json
{
  "tool": "effects",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "files": ["<filename>.tsx"],
  "expectedClassifications": [
    {
      "file": "<filename>.tsx",
      "line": 42,
      "symbol": "useEffect",
      "expectedKind": "<correct-kind>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected kinds:** `DERIVED_STATE`, `EVENT_HANDLER_DISGUISED`,
`TIMER_RACE`, `DOM_EFFECT`, `EXTERNAL_SUBSCRIPTION`, `NECESSARY`.

**Notes:** The `symbol` field is always `"useEffect"` for this tool.

---

### Hooks (`ast-interpret-hooks`)

**Run the interpreter to see all assessments:**

```bash
npx tsx scripts/AST/ast-interpret-hooks.ts <fixture-file> --pretty
```

**Fixture files:** Copy the source file (plain name, no prefix).

**Tool-specific requirement: preserve import paths.** The hooks
interpreter classifies based on import paths (e.g., imports from
`services/hooks/` trigger `LIKELY_SERVICE_HOOK`). If you strip or
rewrite import paths, the classification changes. Copy the file
with realistic import statements intact.

**Manifest template:**

```json
{
  "tool": "hooks",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "files": ["<filename>.tsx"],
  "expectedClassifications": [
    {
      "file": "<filename>.tsx",
      "line": 15,
      "symbol": "<hookName>",
      "expectedKind": "<correct-kind>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected kinds:** `LIKELY_SERVICE_HOOK`, `LIKELY_CONTEXT_HOOK`,
`LIKELY_AMBIENT_HOOK`, `LIKELY_STATE_HOOK`, `UNKNOWN_HOOK`.

---

### Ownership (`ast-interpret-ownership`)

**Run the interpreter to see all assessments:**

```bash
npx tsx scripts/AST/ast-interpret-ownership.ts <fixture-file> --pretty
```

**Fixture files:** Copy the source file (plain name, no prefix).

**Tool-specific requirement: preserve import paths.** The ownership
interpreter chains on the hooks interpreter -- it uses hook assessments
(`LIKELY_SERVICE_HOOK`, `LIKELY_CONTEXT_HOOK`) as container signals.
If import paths are stripped, hook classification changes, which cascades
into ownership classification. Copy the file with realistic imports.

**Manifest template:**

```json
{
  "tool": "ownership",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "files": ["<filename>.tsx"],
  "expectedClassifications": [
    {
      "file": "<filename>.tsx",
      "line": 8,
      "symbol": "<ComponentName>",
      "expectedKind": "<correct-kind>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected kinds:** `CONTAINER`, `DDAU_COMPONENT`, `LAYOUT_SHELL`,
`LEAF_VIOLATION`, `AMBIGUOUS`.

---

### Template (`ast-interpret-template`)

**Run the interpreter to see all assessments:**

```bash
npx tsx scripts/AST/ast-interpret-template.ts <fixture-file> --pretty
```

**Fixture files:** Copy the source file (plain name, no prefix).

**Manifest template:**

```json
{
  "tool": "template",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "files": ["<filename>.tsx"],
  "expectedClassifications": [
    {
      "file": "<filename>.tsx",
      "line": 30,
      "symbol": "<ComponentName>",
      "expectedKind": "<correct-kind>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected kinds:** `EXTRACTION_CANDIDATE`, `COMPLEXITY_HOTSPOT`.

**Note:** For negative cases (components that should NOT trigger any
classification), use an **empty `expectedClassifications` array**. The
accuracy spec treats this as "expect zero assessments" and fails if
the interpreter produces any.

---

### Test quality (`ast-interpret-test-quality`)

**Run the interpreter to see all assessments:**

```bash
npx tsx scripts/AST/ast-interpret-test-quality.ts <fixture-file> --pretty
```

**Fixture files:** Copy the test file. If the misclassification involves
`ORPHANED_TEST` or `MOCK_DOMAIN_BOUNDARY`, also copy the companion
subject file so the interpreter can resolve the subject path.

**Manifest template:**

```json
{
  "tool": "test-quality",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "files": ["<spec-filename>.spec.ts", "<companion-subject>.ts"],
  "expectedClassifications": [
    {
      "file": "<spec-filename>.spec.ts",
      "line": 12,
      "symbol": "<symbol>",
      "expectedKind": "<correct-kind>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected kinds:** `MOCK_BOUNDARY_COMPLIANT`, `MOCK_INTERNAL_VIOLATION`,
`MOCK_DOMAIN_BOUNDARY`, `ASSERTION_USER_VISIBLE`,
`ASSERTION_IMPLEMENTATION`, `ASSERTION_SNAPSHOT`, `CLEANUP_COMPLETE`,
`CLEANUP_INCOMPLETE`, `DATA_SOURCING_COMPLIANT`, `DATA_SOURCING_VIOLATION`,
`ORPHANED_TEST`, `DELETE_CANDIDATE`, `DETECTED_STRATEGY`.

**Tool-specific requirement:** Use subdirectories if domain boundary
testing is needed (e.g., `domain-a/`, `domain-b/`).

---

### Dead code (`ast-interpret-dead-code`)

**Run the interpreter to see all assessments:**

```bash
npx tsx scripts/AST/ast-interpret-dead-code.ts <fixture-directory> --pretty
```

Note: the dead-code interpreter runs on an **entire directory**, not a
single file. It builds a dependency graph across all files in the
directory.

**Fixture files: multi-file required.** Dead code detection requires an
import graph. Include:

- The file(s) with the misclassified export(s)
- Barrel files (`index.ts`) that re-export from those files
- Consumer files that import from those files (or barrels)
- Any other files needed to reproduce the graph structure

All files go in the fixture directory as plain copies (no prefix).

**Manifest template:**

```json
{
  "tool": "dead-code",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "files": ["index.ts", "utils.ts", "consumer.ts"],
  "expectedClassifications": [
    {
      "file": "utils.ts",
      "line": 5,
      "symbol": "<exportName>",
      "expectedKind": "<correct-kind>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected kinds:** `DEAD_EXPORT`, `POSSIBLY_DEAD_EXPORT`,
`DEAD_BARREL_REEXPORT`, `CIRCULAR_DEPENDENCY`.

---

### Intent (`ast-interpret-refactor-intent`)

**Run the observation tool then the interpreter:**

```bash
# Step 1: collect signal pairs
npx tsx scripts/AST/ast-refactor-intent.ts \
  --before <before-files...> \
  --after <after-files...> \
  > /tmp/signal-pair.json

# Step 2: interpret
npx tsx scripts/AST/ast-interpret-refactor-intent.ts \
  --signal-pair /tmp/signal-pair.json \
  --refactor-type <type> \
  --pretty
```

Valid `refactorType` values: `component`, `hook`, `route`, `provider`,
`service-hook`, `test`.

**Fixture files:** Copy before-files with a `before-` prefix, after-files
with an `after-` prefix. Example: `before-UserPanel.tsx`,
`after-UserPanelContainer.tsx`, `after-UserPanelBlock.tsx`.

**Manifest template:**

```json
{
  "tool": "intent",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "refactorType": "<component|hook|route|provider|service-hook|test>",
  "beforeFiles": ["before-<filename>.tsx"],
  "afterFiles": ["after-<filename>.tsx"],
  "expectedClassifications": [
    {
      "kind": "<observation kind>",
      "evidence": { "<key>": "<value>" },
      "expectedClassification": "<correct-classification>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected classifications:** `PRESERVED`, `INTENTIONALLY_REMOVED`,
`ACCIDENTALLY_DROPPED`, `ADDED`, `CHANGED`.

**Note:** The `evidence` field must contain enough fields to uniquely
identify the signal. Common evidence fields: `hookName`,
`functionContext`, `componentName`. Check the interpreter's output
to see which evidence fields it uses for matching.

**Exit code protocol (used by consuming skills before creating fixtures):**

- Exit 0 (score >= 90, zero `ACCIDENTALLY_DROPPED`): no fixture needed.
- Exit 1 (score >= 70, has `ACCIDENTALLY_DROPPED`): investigate each.
  Create fixture only for signals that are actually `INTENTIONALLY_REMOVED`.
- Exit 2 (score < 70): stop and investigate before proceeding.

---

### Parity (`ast-interpret-pw-test-parity`)

**Run the observation tool then the interpreter:**

```bash
# Observe source and target specs
npx tsx scripts/AST/ast-pw-test-parity.ts <source-spec> --pretty
npx tsx scripts/AST/ast-pw-test-parity.ts <target-spec> --pretty

# Interpret
npx tsx scripts/AST/ast-interpret-pw-test-parity.ts \
  --source-dir <source-dir> \
  --target-dir <target-dir> \
  --pretty
```

**Fixture files:** Three-tier naming convention:

- Source (QA/E2E) spec: `source-<filename>.spec.ts`
- Target (integration) spec: `target-<filename>.spec.ts`
- POM helpers: `target-helper-<filename>.ts`

**Manifest template:**

```json
{
  "tool": "parity",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "sourceFiles": ["source-<name>.spec.ts"],
  "targetFiles": ["target-<name>.spec.ts"],
  "helperFiles": ["target-helper-<name>.ts"],
  "expectedClassifications": [
    {
      "testName": "<source test name>",
      "expectedStatus": "<correct-status>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected statuses:** `PARITY`, `EXPANDED`, `REDUCED`, `NOT_PORTED`.

**Common misclassification cause:** POM delegation. When the target
test delegates assertions to a POM helper, the tool may report `REDUCED`
because it does not see the assertions inline. The helper index resolves
this, but only if the helper file is included in `helperFiles`.

---

### Vitest parity (`ast-interpret-vitest-parity`)

**Run the interpreter:**

```bash
npx tsx scripts/AST/ast-interpret-vitest-parity.ts \
  --source <path-to-original-spec> \
  --target <path-to-refactored-spec> \
  --pretty
```

**Fixture files:** Two-tier naming convention:

- Original spec: `source-<filename>`
- Refactored spec: `target-<filename>`

**Manifest template:**

```json
{
  "tool": "vitest-parity",
  "created": "<YYYY-MM-DD>",
  "source": "feedback",
  "sourceFiles": ["source-<name>.spec.ts"],
  "targetFiles": ["target-<name>.spec.ts"],
  "expectedClassifications": [
    {
      "testName": "<source test name>",
      "expectedStatus": "<correct-status>",
      "notes": "<why the interpreter was wrong>"
    }
  ],
  "status": "pending"
}
```

**Expected statuses:** `PARITY`, `EXPANDED`, `REDUCED`, `NOT_PORTED`.

---

### Plan audit (`ast-interpret-plan-audit`)

**Run the observation tool then the interpreter:**

```bash
npx tsx scripts/AST/ast-interpret-plan-audit.ts <plan-file> \
  --prompts '<glob>' --pretty --verbose
```

**Fixture type: synthetic.** Plan-audit fixtures are self-contained
markdown files (plan.md + optional prompt files), not source code
snapshots. Create a new fixture directory following the
`synth-plan-audit-NN-<description>` naming convention.

**Fixture files:**

- `plan.md` -- the plan with headers, prompt table, verification,
  standing elements, cleanup reference (as needed for the test scenario)
- `<prompt-name>.md` -- prompt files with verification and reconciliation
  sections (if testing prompt-level checks)
- `manifest.json` -- declares expected verdict, score range, and
  expected/unexpected assessment kinds

**Manifest template:**

```json
{
  "tool": "plan-audit",
  "created": "<YYYY-MM-DD>",
  "source": "synthetic",
  "planFile": "plan.md",
  "promptFiles": ["<prompt-01>.md", "<prompt-02>.md"],
  "expectedVerdict": "<CERTIFIED|CONDITIONAL|BLOCKED>",
  "expectedScoreRange": [<lo>, <hi>],
  "expectedClassifications": [
    {
      "expectedKind": "<assessment-kind>",
      "notes": "<why this assessment is expected>"
    }
  ],
  "unexpectedClassifications": ["<kinds-that-must-NOT-appear>"],
  "notes": "<description of what this fixture tests>",
  "status": "pending"
}
```

**Assessment kinds:** `HEADER_COMPLETE`, `HEADER_DEFICIENCY`,
`VERIFICATION_PRESENT`, `VERIFICATION_ABSENT`, `CLEANUP_REFERENCED`,
`CLEANUP_UNREFERENCED`, `STANDING_ELEMENTS_COMPLETE`,
`STANDING_ELEMENTS_INCOMPLETE`, `CERTIFIED`, `CONDITIONAL_PREFLIGHT`,
`BLOCKED_PREFLIGHT`, `CERTIFICATION_MISSING`, `PROMPT_WELL_FORMED`,
`PROMPT_DEFICIENCY`, `DEPENDENCY_CYCLE_DETECTED`,
`PROMPT_FILE_UNRESOLVED`, `CONVENTION_REFERENCE`,
`DEFERRED_CLEANUP_NOTED`, `AGGREGATION_RISK`.

**Real-world calibration.** In addition to synthetic fixtures, the
real-plan-audit manifest
(`ground-truth/fixtures/real-plan-audit/manifest.json`) tracks
verdict accuracy across all archived plans. New entries are added
during the plan archival step (see `docs/orchestration-protocol.md`,
"Plan archival and feedback loop"). The accuracy spec tests both
synthetic fixtures (per-classification accuracy) and real-world
entries (verdict-only accuracy by cohort).

**Common misclassification causes:**

- Prompt table parser selecting an inventory table instead of the
  actual prompt/phase table (parser prefers tables with a Mode column)
- Pre-flight mark tier not parsed correctly (observation layer
  distinguishes CERTIFIED, CONDITIONAL, BLOCKED tiers)
- Header format regex too strict for plans with post-archival
  annotations (regex tolerates trailing text after core pattern)

**Note:** Pre-flight marks are this tool's own output. Calibration
fixtures should generally omit pre-flight marks to avoid circular
reasoning. The `PRE_FLIGHT_MARK_MISSING` observation (-10 weight)
is the expected baseline penalty for uncertified plans.

---

## Calibration cadence

Feedback fixtures accumulate as `"pending"`. When 3 or more pending
fixtures exist for a single tool, run:

```bash
/calibrate-ast-interpreter --tool <name>
```

Check pending count:

```bash
for f in scripts/AST/ground-truth/fixtures/*/manifest.json; do
  status=$(python3 -c "import json; print(json.load(open('$f')).get('status',''))")
  tool=$(python3 -c "import json; print(json.load(open('$f')).get('tool',''))")
  [ "$status" = "pending" ] && echo "PENDING ($tool): $f"
done
```

The batch threshold prevents overfitting to noise from a single
misclassification. The calibration skill runs diagnostics before
tuning weights -- it checks for algorithmic defects (hard ceilings,
double-counting) first.

## Related docs

- [Fixture authoring guide](ast-fixture-authoring.md) -- naming
  conventions, design rules, evaluation pipeline details, common pitfalls.
- [Calibration guide](ast-calibration.md) -- accuracy baselines,
  interpreter pipeline diagrams, weight formulas, calibration history.
