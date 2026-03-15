# AST Interpreter Calibration

Two AST interpreter pipelines with a shared calibration system. The
**intent matcher** verifies refactors are behavior-preserving. The
**parity tool** compares Playwright test suites across branches.

Both share the same ground-truth fixture infrastructure, accuracy
regression test, and calibration skill (`/calibrate-ast-interpreter`).

## Current accuracy

| Tool | Accuracy | Fixtures | Threshold | Last calibrated |
|------|----------|----------|-----------|-----------------|
| Intent matcher | 100% (55/55) | 7 synthetic + 2 git-history | 60% | 2026-03-14 |
| Parity tool | 100% (26/26) | 3 synthetic + 6 git-history | 60% | 2026-03-14 |

## Intent Matcher

Compares code before and after a refactor. Classifies each observable
signal as PRESERVED, INTENTIONALLY_REMOVED, ACCIDENTALLY_DROPPED, ADDED,
or CHANGED.

### Pipeline

```
Before files + After files
    |
    v
+---------------------------+
| ast-refactor-intent.ts    |  Observation: runs all AST tools on both
|                           |  file sets, builds signal inventory,
|                           |  greedy-matches before/after observations
+---------------------------+
    |
    v (RefactorSignalPair: matched, unmatched, novel)
+---------------------------+
| ast-interpret-refactor-   |  Interpretation: classifies each signal
| intent.ts                 |  using audit context + refactor-type
|                           |  heuristics
+---------------------------+
    |
    v (IntentReport: signals, score, summary)
```

### Matching algorithm

The matcher pairs before-observations with after-observations using
greedy best-first matching. Each pair gets a composite similarity score:

```
similarity = 0.50 * functionContextScore
           + 0.35 * jaccardSimilarity (evidence, excluding context fields)
           + 0.15 * positionScore
```

**Cross-file name matching.** When a hook or function moves between files
during a refactor, `functionContextScore` returns 0.7 (instead of 0) if
the primary identifying name matches (e.g., `useAuthState` in both files
but with different `parentFunction`). This handles the DDAU container
extraction pattern where hooks move from a component to a container file.

**Context evidence de-duplication.** The `parentFunction` and
`containingFunction` fields are excluded from Jaccard evidence because
they are already scored by `functionContextScore`. This prevents context
differences from being penalized twice.

**Name-based greedy tie-breaking.** When two candidate pairs have
similarity within 0.05, the sort prefers the pair where the primary
name matches. This prevents the greedy algorithm from pairing functions
with similar metrics but different names.

### Classification thresholds

| Similarity | Classification |
|-----------|----------------|
| >= 0.80 | PRESERVED |
| 0.60 -- 0.79 | CHANGED |
| < 0.60 | Unmatched (goes to classifyUnmatched) |

Unmatched signals are classified as INTENTIONALLY_REMOVED (if the kind
appears in `REFACTOR_TYPE_EXPECTED_REMOVALS` for the given refactorType
or is flagged by audit context) or ACCIDENTALLY_DROPPED (conservative
default).

### Configuration

Intent weights and thresholds live in `astConfig.intentMatcher` in
`scripts/AST/ast-config.ts`. The `REFACTOR_TYPE_EXPECTED_REMOVALS` map
in `ast-interpret-refactor-intent.ts` controls which observation kinds
are expected removals per refactor type.

### Usage

```bash
# Run observation + matching
npx tsx scripts/AST/ast-refactor-intent.ts \
  --before src/ui/page_blocks/users/Users.tsx \
  --after src/ui/page_blocks/users/Users.tsx \
         src/ui/page_blocks/users/UsersContainer.tsx \
  --pretty

# Run interpreter
npx tsx scripts/AST/ast-interpret-refactor-intent.ts \
  --signal-pair <output-json> \
  --refactor-type component \
  --pretty
```

Exit codes: 0 (safe), 1 (review -- has drops), 2 (investigate -- score < 70).

### Known limitations

**Observer gap for hooks inside hook definitions.** The react-inventory
tool emits HOOK_CALL observations for hooks called inside components and
containers, but not for hooks called inside hook definitions. When a
refactor extracts data-fetching from a component into a standalone hook,
the extracted hooks (e.g., `useQuery`, `useFetchApi`) disappear from the
observable surface. The matcher correctly flags them as
ACCIDENTALLY_DROPPED. This is a true detection (the signal IS gone from
the tool's perspective), not a false positive. Skills should not suppress
this warning; it serves as a reminder that the extracted hook file is not
independently observable.

## Parity Tool

Compares Playwright test suites across branches. Inventories spec files,
matches tests by composite similarity, and classifies coverage status.

For full algorithm details, see:
- [Matching algorithm reference](ast-parity-matching.md) -- scoring formula, thresholds, classification boundaries
- [Observation signals reference](ast-observation-signals.md) -- what the tool extracts and what it ignores
- [QA spec patterns](qa-spec-patterns.md) -- structural differences between QA and integration suites

### Pipeline

```
Source specs + Target specs + Helper files
    |
    v
+---------------------------+
| ast-pw-test-parity.ts     |  Observation: parses spec files into
|                           |  PwSpecInventory (tests, assertions,
|                           |  routes, POMs, helpers)
+---------------------------+
    |
    v (PwSpecInventory[], PwHelperIndex)
+---------------------------+
| ast-interpret-pw-test-    |  Interpretation: matches source tests
| parity.ts                 |  to target tests, classifies each as
|                           |  PARITY / EXPANDED / REDUCED / NOT_PORTED
+---------------------------+
    |
    v (ParityReport: file matches, test matches, score)
```

### Test matching

Greedy best-first matching using composite similarity:

| Signal | Weight | Measures |
|--------|--------|----------|
| Name word overlap | 0.50 | Jaccard on words > 2 chars |
| Route intercept overlap | 0.20 | Set intersection of `page.route()` URLs |
| Navigation overlap | 0.15 | Set intersection of `page.goto()` URLs |
| POM class overlap | 0.15 | Set intersection of `new XxxPage()` classes |

Match threshold: 0.15. Below that, the source test is NOT_PORTED.

### Classification

Based on weight ratio (target weight / source weight). When mock handler
baseline is active, the ratio is route-normalized.

| Weight ratio | Status | Notes |
|-------------|--------|-------|
| > 2.0 | EXPANDED | |
| 0.4 -- 2.0 | PARITY | |
| < 0.4 | PARITY | When assertion equivalence floor applies (see below) |
| < 0.4 | REDUCED | After assertion floor check fails |

**Assertion equivalence floor:** When the weight ratio is < 0.4 but the
target's total resolved assertions (explicit + POM-delegated via
`resolveHelperWeight`) meet or exceed the source's explicit assertion
count, the test is classified PARITY. Also applies when source has 0
assertions but target has resolved assertions. See
`ast-parity-matching.md` for the full algorithm reference.

### Factory pattern expansion

Handles specs that define wrapper functions calling `test()` internally.
The tool detects factory functions with template literal test names,
finds all call sites, and resolves each to a concrete test name.
Supports both in-file and cross-file factory expansion.

### Configuration

Parity weights and thresholds live in `astConfig.testParity` in
`scripts/AST/ast-config.ts`. File mapping (source spec -> target spec)
and helper directories are also configured there.

### Usage

```bash
# Run parity analysis
npx tsx scripts/AST/ast-interpret-pw-test-parity.ts \
  --source-branch production --source-dir e2e/tests/ \
  --target-dir integration/tests/ --pretty
```

### Bias profile

Pre-improvement (2026-03-13): 73% accuracy against 78-test ground truth,
FP:FN ratio 7:14, conservative bias. After interpreter improvements
(2026-03-15: fuzzy class match, route normalization, assertion equivalence
floor), the opaque-to-POM and factory inflation patterns are resolved.
Manual accuracy has not been re-measured but REDUCED dropped from 7 to 4
(production) and 19 to 6 (development), indicating significantly improved
accuracy.

| Metric | Pre-improvement | Post-improvement |
|--------|----------------|-----------------|
| FP:FN ratio | 7:14 | Not re-measured |
| Bias | Conservative | Expected neutral |
| Production REDUCED | 7 | 4 |
| Development REDUCED | 19 | 6 |

## Ground Truth Fixtures

Fixtures live in `scripts/AST/ground-truth/fixtures/`. Each fixture is
a directory containing source files and a `manifest.json` with expected
classifications. See the [fixture authoring guide](ast-fixture-authoring.md)
for the full evaluation pipeline, cross-file factory setup, and common pitfalls.

### Fixture sources

| Prefix | Source | Purpose |
|--------|--------|---------|
| `synth-intent-*` | Hand-written minimal examples | Core algorithm coverage |
| `synth-parity-*` | Hand-written spec pairs | Parity matching coverage |
| `git-intent-*` | Extracted from real git commits | Real-world validation |
| `git-parity-*` | Real QA-to-integration spec pairs | Real-world parity validation |
| `feedback-*` | Created by refactor skills on misclassification | Regression prevention |

### Adding fixtures

1. Create a directory: `scripts/AST/ground-truth/fixtures/<prefix>-NN-description/`
2. Add source files (under 40 lines each)
3. Write `manifest.json` with `status: "pending"`
4. Hand-write all expected classifications (never copy tool output)
5. Run `/calibrate-ast-interpreter --tool <intent|parity>` when 3+ pending fixtures exist

### Git-history fixtures

To extract a fixture from a real refactoring commit:

```bash
# Get before/after files
git show <commit>~1:<path> > before-<name>.tsx
git show <commit>:<path> > after-<name>.tsx

# For file splits, also extract new files
git show <commit>:<new-path> > after-<newname>.tsx
```

Run the observation tools on both file sets to understand what signals
are emitted, then write the manifest with expected classifications based
on what the refactor intended.

## Accuracy Regression Test

```bash
npx vitest run --config scripts/AST/vitest.config.mts \
  scripts/AST/__tests__/interpreter-accuracy.spec.ts
```

The test loads all fixtures from `scripts/AST/ground-truth/fixtures/`,
groups by tool (intent vs parity), runs each tool's observation +
matching + interpretation pipeline, and asserts accuracy >= threshold
per tool. It catches regressions where changes to one tool degrade
accuracy on the other.

Current test counts: 790 tests across 30 spec files (full AST suite).

## Calibration Skill

```bash
/calibrate-ast-interpreter --tool intent
/calibrate-ast-interpreter --tool parity
```

The skill follows a diagnostic-first approach:

1. **Discover** fixtures and compute current accuracy
2. **Diagnose** whether errors stem from algorithmic defects or
   weight/threshold values (Step 4b)
3. **Fix algorithms** if hard ceilings or double-counting detected (Step 4c)
4. **Tune weights** for remaining misclassifications (Step 5)
5. **Verify** via regression test, tsc, build

See `.claude/skills/calibrate-ast-interpreter/SKILL.md` for the full
protocol.

## Calibration History

| Date | Tool | Action | Before | After |
|------|------|--------|--------|-------|
| 2026-03-14 | intent | Initial calibration (P8) | -- | 83% (35/42) |
| 2026-03-14 | parity | Initial calibration (P8) | -- | 100% (10/10) |
| 2026-03-14 | intent | Cleanup: real matcher in tests | 83% | 69% (29/42) |
| 2026-03-14 | parity | Cleanup: template literal fix | 100% | 100% (10/10) |
| 2026-03-14 | intent | Algorithm fix: cross-file matching, de-duplication, tie-breaking | 69% | 100% (55/55) |
