---
name: calibrate-ast-interpreter
description: Calibrate an AST interpreter's weights/thresholds against the ground-truth fixture corpus. Diagnostic-first approach -- checks for algorithmic defects before tuning weights.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task
argument-hint: --tool <intent|parity|vitest-parity|effects|hooks|ownership|template|test-quality|dead-code|plan-audit>
---

<!-- role: guidance -->

# /calibrate-ast-interpreter

Calibrate an AST interpreter's weights/thresholds against the ground truth
fixture corpus. Supports all 10 interpreter tools.

<!-- role: reference -->

## Arguments

`$ARGUMENTS` should contain `--tool <tool-name>`. Default: `intent`.

Supported tools: `intent`, `parity`, `vitest-parity`, `effects`, `hooks`,
`ownership`, `template`, `test-quality`, `dead-code`, `plan-audit`.

<!-- role: workflow -->

## Step 1: Discover fixtures

Read all `manifest.json` files in `scripts/AST/ground-truth/fixtures/*/`.
Filter to fixtures matching the `--tool` value (the `tool` field in each
manifest).

Report:

- Tool: `<intent | parity>`
- Total fixtures for this tool: N (S synthetic, F feedback, G git-history)
- Pending calibration: N
- Previously calibrated: N
- Total expected classifications: N

<!-- role: workflow -->

## Step 2: Run the interpreter on all fixtures

### If `--tool intent`

For each fixture:

1. Read `beforeFiles` from the fixture directory
2. Read `afterFiles` from the fixture directory
3. Write files to a temp directory so observation tools can access them
4. Run `runAllObservers()` on each file to collect observations
5. Build a `RefactorSignalPair` via greedy matching (same algorithm as
   `ast-refactor-intent.ts`)
6. Build an `AuditContext` from the manifest's `refactorType` (empty
   `flaggedKinds` and `flaggedLocations`)
7. Run `interpretRefactorIntent(signalPair, auditContext)`
8. Compare each classification against `manifest.expectedClassifications`:
   - Match by `kind` + evidence fields
   - Record: correct, incorrect (with actual vs expected), unmatched

### If `--tool parity`

For each fixture:

1. Read `sourceFiles` from the fixture directory
2. Read `targetFiles` from the fixture directory
3. Read `helperFiles` from the fixture directory (if present)
4. Write files to a temp directory
5. Run `analyzeTestParity()` on each source and target file
6. Build helper index via `analyzeHelperFile()` for helper files
7. Build a file mapping from source basenames to target basenames
8. Run `interpretTestParity(sourceInventories, targetInventories, fileMapping, { targetHelpers })`
9. Compare each test match status against `manifest.expectedClassifications`:
   - Match by `testName`
   - Record: correct, incorrect (with actual vs expected), unmatched

### If `--tool effects`

For each fixture:

1. Copy fixture files to a temp directory
2. Run `analyzeReactFile()` on each `.tsx` file to collect effect observations
3. Run `interpretEffects(effectObservations)` on the observations
4. Compare each assessment against `manifest.expectedClassifications`:
   - Match by `file` + `line` + `expectedKind`
   - Record: correct, incorrect, unmatched

Observation chain: `ast-react-inventory` -> `ast-interpret-effects`

Tunable parameters:

- Priority cascade order in `classifyEffect()` in `ast-interpret-effects.ts`
- `setterMirrorsProp` heuristic for prop-mirror detection
- Async body detection patterns (fetch, then, await)

Ground-truth fixture prefix: `synth-effects-*`

### If `--tool hooks`

For each fixture:

1. Copy fixture files to a temp directory
2. Run `analyzeReactFile()` on each `.tsx` file to collect hook call observations
3. Run `interpretHooks(hookCallObservations)` on the observations
4. Compare each assessment against `manifest.expectedClassifications`:
   - Match by `file` + `line` + `symbol` + `expectedKind`
   - Record: correct, incorrect, unmatched

Observation chain: `ast-react-inventory` -> `ast-interpret-hooks`

Tunable parameters:

- `astConfig.hooks.serviceHookPaths`: import path patterns for service hooks
- `astConfig.hooks.contextHookPaths`: import path patterns for context hooks
- `astConfig.hooks.ambientLeafHooks`: name set for ambient leaf hooks
- `astConfig.hooks.stateHooks`: name set for React builtin hooks
- Naming convention fallback patterns in `classifyByConvention()`

Ground-truth fixture prefix: `synth-hooks-*`

### If `--tool ownership`

For each fixture:

1. Copy fixture files to a temp directory
2. Run `analyzeReactFile()` on each `.tsx` file to collect component and hook observations
3. Run `interpretOwnership(componentObservations, hookAssessments)` on the observations
4. Compare each assessment against `manifest.expectedClassifications`:
   - Match by `file` + `symbol` + `expectedKind`
   - Record: correct, incorrect, unmatched

Observation chain: `ast-react-inventory` -> `ast-interpret-hooks` -> `ast-interpret-ownership`

Tunable parameters:

- `astConfig.ownership.routerHooks`: hook names counted as router signals
- `astConfig.ownership.layoutNames`: component name patterns for LAYOUT_SHELL
- Container signal weights (service hooks, context hooks, router, query state)
- Component signal weights (prop count, callback prop count)

Ground-truth fixture prefix: `synth-ownership-*`

### If `--tool template`

For each fixture:

1. Copy fixture files to a temp directory
2. Run `analyzeJsxFile()` on each `.tsx` file to collect JSX observations
3. Run `interpretTemplate(jsxObservations)` on the observations
4. Compare each assessment against `manifest.expectedClassifications`:
   - Match by `file` + `line` + `expectedKind`
   - Negative fixtures (empty `expectedClassifications`): expect zero assessments
   - Record: correct, incorrect, unmatched

Observation chain: `ast-jsx-analysis` -> `ast-interpret-template`

Tunable parameters:

- `astConfig.template.extractionThreshold`: return line count for EXTRACTION_CANDIDATE
- Complexity hotspot: 3+ distinct JSX observation kinds in one return block

Ground-truth fixture prefix: `synth-template-*`

### If `--tool test-quality`

For each fixture:

1. Copy fixture files (including companion subject files) to a temp directory,
   creating subdirectories as needed
2. Run `analyzeTestFile()` on each `.spec.ts`/`.test.ts` file only (skip
   companion subject files)
3. Pass `subjectExists` from the analysis and compute `subjectDomainDir`
   as `path.dirname(subjectPath)`
4. Run `interpretTestQuality(observations, subjectExists, subjectDomainDir)`
5. Compare each assessment against `manifest.expectedClassifications`:
   - Two-pass matching: first exact match including `expectedKind`, then
     fallback to location-only match for misclassification reporting
   - Record: correct, incorrect, unmatched

Observation chain: `ast-test-analysis` -> `ast-interpret-test-quality`

Tunable parameters:

- `astConfig.testing.boundaryPackages`: package patterns for mock boundary compliance
- `astConfig.testing.deleteThresholdInternalMocks`: internal mock count for DELETE_CANDIDATE
- `astConfig.testing.userVisibleMatchers`: assertion matchers for user-visible classification
- `astConfig.testing.implementationMatchers`: assertion matchers for implementation classification

Ground-truth fixture prefix: `synth-test-quality-*`

### If `--tool dead-code`

For each fixture:

1. Copy all fixture files to a temp directory, creating subdirectories as needed
2. Run `buildDependencyGraph()` on the entire temp directory with
   `{ searchDir: fixtureDir }` (not the repo's `src/`)
3. Run `interpretDeadCode(graph)` once for the entire directory (not per-file)
4. Compare each assessment against `manifest.expectedClassifications`:
   - Match by `file` + `symbol` + `expectedKind`
   - Record: correct, incorrect, unmatched

Observation chain: `ast-imports` -> `ast-interpret-dead-code`

Tunable parameters:

- Fragile export threshold (1 consumer = low confidence)
- `isTypeExport` check (currently broken -- `exportKind` always undefined)
- Name-based DEAD_BARREL_REEXPORT matching heuristic

Ground-truth fixture prefix: `synth-dead-code-*`

### If `--tool plan-audit`

Plan-audit is fundamentally different from the other tools: it parses
markdown (MDAST via `unified`/`remark-parse`), not TypeScript AST. The
observation layer is `ast-plan-audit.ts` and the interpreter is
`ast-interpret-plan-audit.ts`.

Plan-audit has two fixture types evaluated separately:

**Synthetic fixtures** (`synth-plan-audit-*`):

For each fixture:

1. Read the `planFile` and `promptFiles` from the fixture directory
2. Run `analyzePlan(planPath, promptPaths)` to collect observations
3. Run `interpretPlanAudit(planPath, promptPaths, observations)` to
   produce the verdict report
4. Compare against `manifest.expectedClassifications`:
   - Check verdict matches `manifest.expectedVerdict`
   - Check score falls within `manifest.expectedScoreRange`
   - Check each `expectedKind` appears in the report assessments
   - Check each `unexpectedClassifications` kind is absent
   - Check each `expectedObservationValues` (kind + evidence key/value)
   - Record: correct, incorrect, unmatched

**Real-world fixtures** (`real-plan-audit/manifest.json`):

For each plan entry in the manifest:

1. Resolve the plan file path (relative `.md.gz` paths are decompressed
   to a temp file; legacy `~/` paths are expanded)
2. Run `analyzePlan(planPath, [])` (no prompt files for real-world plans)
3. Run `interpretPlanAudit(planPath, [], observations)`
4. Compare verdict against `entry.expectedVerdict`
5. Aggregate accuracy by cohort and friction grade
6. Record: correct (verdict match), incorrect (verdict mismatch)

Real-world fixtures only check verdict, not individual assessments or
score ranges -- the plans were not authored with per-check ground truth.

Observation chain: `ast-plan-audit` (MDAST) -> `ast-interpret-plan-audit`

Tunable parameters:

- `astConfig.planAudit.severityMap`: maps observation kinds to
  blocker/warning/info severity
- `astConfig.planAudit.checkWeights`: points subtracted per observation
  kind (blockers and warnings only)
- `astConfig.planAudit.verdictThresholds`: score boundaries for
  CERTIFIED (>= 90) and CONDITIONAL (>= 60)

Ground-truth fixture prefix: `synth-plan-audit-*` (synthetic),
`real-plan-audit/` (real-world)

**Important differences from other tools:**

- Fixtures reference `.md` plan files and prompt files, not `.ts` source
  files. No temp directory file copying is needed -- the observation tool
  reads markdown directly.
- Real-world plan files are gzipped (`.md.gz`) and stored in
  `real-plan-audit/plans/`. The accuracy spec decompresses them via
  `zlib.gunzipSync`.
- The `PRE_FLIGHT_MARK_MISSING` penalty (-10) is the expected baseline
  for fixtures that omit pre-flight marks. This is intentional: pre-flight
  marks are the tool's own output and should not be fed back as input to
  avoid circularity.

### If `--tool skill-quality`

For each fixture:

1. Read the SKILL.md file referenced in the manifest
2. Run `analyzeSkillFile()` to collect skill analysis observations
3. Run `interpretSkillQuality(result)` on the observations
4. Compare each assessment against `manifest.expectedClassifications`:
   - Match by `expectedKind`
   - Record: correct, incorrect, unmatched

Observation chain: `ast-skill-analysis` (MDAST) -> `ast-interpret-skill-quality`

Tunable parameters:

- `astConfig.skillQuality.requiredSections`: per-category required heading
  patterns (build, refactor, audit, orchestrate)
- `astConfig.skillQuality.deprecatedCommandPatterns`: regex patterns for
  stale command detection with replacement suggestions

Ground-truth fixture prefix: `skill-quality/`

**Important differences from other tools:**

- Fixtures reference `.md` skill files, not `.ts` source files. No temp
  directory file copying is needed -- the observation tool reads markdown
  directly.
- The `skillDirs` set for cross-ref validation is built by scanning the
  actual `.claude/skills/` directory, not from the fixture manifest.

<!-- role: detect -->

## Step 3: Compute accuracy metrics

- Overall accuracy: correct / total
- Per-classification accuracy (how often each status/kind is correct)
- Per-source accuracy (synthetic vs feedback vs git-history, separately)
- Bias profile:
  - Intent: FP:FN ratio for ACCIDENTALLY_DROPPED
  - Parity: FP:FN ratio (false NOT_PORTED vs false PARITY)
- Per-signal-kind accuracy (which observation kinds or test match
  dimensions are most often wrong)

<!-- role: workflow -->

## Step 4: Assess whether calibration is needed

- If overall accuracy >= current threshold AND no pending fixtures:
  report "No calibration needed" and stop.
- If pending fixtures exist OR accuracy < threshold: proceed to Step 4b.

<!-- role: detect -->

## Step 4b: Diagnose -- algorithmic defect or weight tuning?

Before adjusting weights, determine whether the misclassifications stem
from an algorithmic defect in the matching/classification code or from
suboptimal weight/threshold values. Weight tuning cannot fix broken
algorithms.

For each misclassified observation:

1. **Trace the similarity computation.** Run `computeSimilarity` on the
   before/after observation pair and inspect the component scores
   (`functionContextScore`, `jaccardSimilarity`, `positionScore`).

2. **Check for hard ceilings.** Compute the maximum possible similarity
   given the observation pair. If the maximum is below the fail threshold
   (0.6), no weight adjustment can fix the match -- the algorithm has a
   structural limitation.

   Common ceiling patterns:

   - **Cross-file context mismatch:** `functionContextScore` returns 0
     when `parentFunction` differs across files, capping similarity at
     `WEIGHT_EVIDENCE + WEIGHT_POSITION` (currently 0.50). This makes
     cross-file refactoring matches impossible.
   - **Double-counted evidence:** Context fields (`parentFunction`,
     `containingFunction`) appearing in both `functionContextScore` AND
     `jaccardSimilarity`, penalizing context differences twice.
   - **Greedy sort ties:** Two candidates with similar similarity but
     different name matches. The greedy algorithm picks the wrong one
     because it has no tie-breaking beyond raw similarity.
   - **Observer gap:** The observation is never emitted (e.g., HOOK_CALL
     inside a hook definition). No matching algorithm can find a signal
     that does not exist. Fix the manifest expectation, not the code.

3. **Classify the fix type:**

   - **Algorithm fix needed:** Hard ceiling, double-counting, missing
     tie-breaking, observer gap. Proceed to Step 4c.
   - **Weight tuning sufficient:** The similarity is in range but on the
     wrong side of a threshold. Proceed to Step 5.

   If both types are present, do algorithm fixes first (Step 4c), then
   re-measure, then tune weights (Step 5) if still needed.

<!-- role: workflow -->

## Step 4c: Fix algorithmic defects

Apply targeted fixes to the matching or classification algorithm in
`ast-refactor-intent.ts` or `ast-interpret-refactor-intent.ts`.

After each fix:

1. Re-run accuracy on all fixtures for this tool
2. Verify the fix resolved the targeted misclassifications
3. Verify no regressions on previously-correct fixtures
4. If a fixture expectation was wrong (observer gap, wrong evidence
   format), update the manifest -- do not bend the algorithm to match
   a bad expectation

When all algorithmic defects are addressed, return to Step 3 to
recompute accuracy metrics, then proceed to Step 5 if weight tuning is
still needed.

<!-- role: workflow -->

## Step 5: Tune weights

### If `--tool intent`

Target: `REFACTOR_TYPE_EXPECTED_REMOVALS` in `ast-interpret-refactor-intent.ts`
and `astConfig.intentMatcher.signalWeights` in `ast-config.ts`.

For each misclassified observation:

1. Identify the dominant misclassification direction:
   - False ACCIDENTALLY_DROPPED (should be PRESERVED or INTENTIONALLY_REMOVED):
     - If the kind should be in the expected removals for the refactorType,
       add it to `REFACTOR_TYPE_EXPECTED_REMOVALS`
     - If the observation should have matched an after observation but did
       not, increase the signal weight (makes matches stickier)
   - False PRESERVED (should be ACCIDENTALLY_DROPPED):
     - Decrease the signal weight (makes mismatches louder)
   - False INTENTIONALLY_REMOVED (should be ACCIDENTALLY_DROPPED):
     - Remove the kind from `REFACTOR_TYPE_EXPECTED_REMOVALS` for that
       refactorType (the heuristic is too broad)
2. Adjust weight by +/-0.5 increment
3. Re-run accuracy on all fixtures for this tool
4. If accuracy improved: keep the change. If not: revert.
5. Repeat for the next worst-performing kind.

### If `--tool parity`

Target: `astConfig.testParity` (weight thresholds and match scoring).

Tunable parameters:

- REDUCED threshold (default 0.4 in `classifyTestParity`)
- EXPANDED threshold (default 2.0 in `classifyTestParity`)
- Match score component weights (name: 0.5, routes: 0.2, nav: 0.15, pom: 0.15
  in `computeMatchScore`)
- Match minimum threshold (default 0.15 in `computeMatchScore`)
- Helper delegation fallback weight (default 3 in `computeTestWeight`)

For each misclassified test:

1. Identify which parameter caused the error (threshold too strict?
   match weight too low for a signal type?)
2. Adjust by small increment
3. Re-run accuracy on all parity fixtures
4. If accuracy improved: keep. If not: revert.

### If `--tool effects`

Target: `classifyEffect()` priority cascade in `ast-interpret-effects.ts`
and `astConfig.effects` in `ast-config.ts`.

Tunable: priority order of classification checks, `setterMirrorsProp`
matching logic, async body detection patterns.

### If `--tool hooks`

Target: `astConfig.hooks` in `ast-config.ts`.

Tunable: `serviceHookPaths`, `contextHookPaths`, `ambientLeafHooks`,
`stateHooks` name sets. For misclassifications from import path resolution,
check whether the path pattern is too broad or too narrow.

### If `--tool ownership`

Target: `astConfig.ownership` in `ast-config.ts` and signal scoring in
`ast-interpret-ownership.ts`.

Tunable: `routerHooks`, `layoutNames`, container/component signal weights.

### If `--tool template`

Target: `astConfig.template` in `ast-config.ts`.

Tunable: `extractionThreshold` (line count for EXTRACTION_CANDIDATE),
complexity hotspot kind count threshold.

### If `--tool test-quality`

Target: `astConfig.testing` in `ast-config.ts`.

Tunable: `boundaryPackages`, `deleteThresholdInternalMocks`,
`userVisibleMatchers`, `implementationMatchers`.

### If `--tool dead-code`

Target: `ast-interpret-dead-code.ts` inline thresholds.

Tunable: fragile export threshold, name-based barrel re-export matching.

### If `--tool plan-audit`

Target: `astConfig.planAudit` in `ast-config.ts`.

Tunable parameters:

- `severityMap`: maps observation kinds to blocker/warning/info. Changing
  a kind from warning to info (or vice versa) shifts its effect on score.
- `checkWeights`: points deducted per observation kind. Only applied for
  blocker/warning severity. Adjust weights when the score is on the wrong
  side of a verdict boundary.
- `verdictThresholds.certified` (default 90): raise to make CERTIFIED
  harder to achieve; lower to make it easier.
- `verdictThresholds.conditional` (default 60): raise to make CONDITIONAL
  harder; lower to allow more plans to pass.

For each misclassified verdict:

1. Check the score. Is it near a threshold boundary? If so, small weight
   adjustments may fix it.
2. Check which observations fired. Was a blocker incorrectly assigned?
   Should a warning be downgraded to info (or vice versa)?
3. Adjust severity or weight by the smallest increment that fixes the
   misclassification.
4. Re-run accuracy on all plan-audit fixtures (both synthetic and
   real-world).
5. If accuracy improved: keep. If not: revert.

For real-world fixture mismatches:

- These are verdict-only checks. If the score is close to a boundary,
  the weight for the dominant observation kind may need adjustment.
- If the plan genuinely changed quality due to convention evolution,
  update the `expectedVerdict` in the manifest instead of tuning weights.

### General tuning protocol

Stop when:

- All classifications are correct, OR
- No single adjustment improves overall accuracy (plateau)

Document each adjustment: parameter, old value, new value, accuracy delta.

<!-- role: emit -->

## Step 6: Update configuration

### If `--tool intent`

Write adjusted values to:

- `REFACTOR_TYPE_EXPECTED_REMOVALS` in `ast-interpret-refactor-intent.ts`
- `astConfig.intentMatcher.signalWeights` in `ast-config.ts` (if weights changed)

### If `--tool parity`

Write adjusted values to:

- `classifyTestParity`, `computeMatchScore`, or `computeTestWeight` in
  `ast-interpret-pw-test-parity.ts` (inline constants)
- Or centralize in `astConfig.testParity` if the values are extracted there

### If `--tool effects`

Write adjusted values to:

- `classifyEffect()` in `ast-interpret-effects.ts` (priority cascade)
- `astConfig.effects` in `ast-config.ts` (if thresholds changed)

### If `--tool hooks`

Write adjusted values to:

- `astConfig.hooks` in `ast-config.ts` (path patterns, name sets)

### If `--tool ownership`

Write adjusted values to:

- `astConfig.ownership` in `ast-config.ts` (layout names, router hooks)
- Signal scoring in `ast-interpret-ownership.ts` (if weights changed)

### If `--tool template`

Write adjusted values to:

- `astConfig.template` in `ast-config.ts` (extraction threshold)

### If `--tool test-quality`

Write adjusted values to:

- `astConfig.testing` in `ast-config.ts` (boundary packages, matchers, thresholds)

### If `--tool dead-code`

Write adjusted values to:

- `ast-interpret-dead-code.ts` (fragile threshold, barrel matching logic)

### If `--tool plan-audit`

Write adjusted values to:

- `astConfig.planAudit.severityMap` in `ast-config.ts` (kind -> severity)
- `astConfig.planAudit.checkWeights` in `ast-config.ts` (kind -> points)
- `astConfig.planAudit.verdictThresholds` in `ast-config.ts` (certified/conditional boundaries)

Add a calibration comment block to the updated section:

```ts
/**
 * Calibrated: <date>
 * Tool: <intent | parity>
 * Fixtures: <N> (<S> synthetic, <F> feedback, <G> git-history)
 * Accuracy: <N%> (threshold: <M%>)
 * Bias: <FP:FN ratio>
 */
```

Update the accuracy threshold to: calibrated accuracy minus 5 points
(floor of 60%).

<!-- role: workflow -->

## Step 7: Mark fixtures as calibrated

Update each pending fixture manifest for this tool: `status` -> `"calibrated"`.

<!-- role: workflow -->

## Step 8: Run regression test

```bash
npx vitest run --config scripts/AST/vitest.config.mts \
  scripts/AST/__tests__/interpreter-accuracy.spec.ts
```

The test loads ALL fixtures (both tools), groups by tool, runs each
tool's interpreter on its fixtures, and asserts accuracy >= threshold
per tool. This catches regressions where tuning one tool's weights
degrades the other.

<!-- role: workflow -->

## Step 9: Verify and commit

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm build
npx eslint . --max-warnings 0
```

Commit:

```
calibrate(ast): tune <tool> weights (accuracy N% on M fixtures)
```

<!-- role: emit -->

## Step 10: Report

Output:

- Tool: `<intent | parity>`
- Fixtures processed: N (N pending, N previously calibrated)
- Accuracy before: N%
- Accuracy after: N%
- Weights/thresholds changed: list
- Threshold: N%
- Bias profile: FP:FN

<!-- role: guidance -->

## Notes

- The regression test and the calibration skill use the same fixture
  format and the same interpreter APIs. They are the same system.
- Fixture manifests use `status: "pending"` until calibrated, then
  `status: "calibrated"`.
- Ground truth classifications in manifests are always hand-written.
  Never run the interpreter and copy output (circular).
- When adding new fixtures, add them with `status: "pending"` and
  run the calibration skill to incorporate them.
