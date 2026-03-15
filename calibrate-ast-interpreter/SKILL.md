# /calibrate-ast-interpreter

Calibrate an AST interpreter's weights/thresholds against the ground truth
fixture corpus. Supports the intent matcher (`--tool intent`) and the
parity tool (`--tool parity`).

## Arguments

`$ARGUMENTS` should contain `--tool <intent|parity>`. Default: `intent`.

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

## Step 3: Compute accuracy metrics

- Overall accuracy: correct / total
- Per-classification accuracy (how often each status/kind is correct)
- Per-source accuracy (synthetic vs feedback vs git-history, separately)
- Bias profile:
  - Intent: FP:FN ratio for ACCIDENTALLY_DROPPED
  - Parity: FP:FN ratio (false NOT_PORTED vs false PARITY)
- Per-signal-kind accuracy (which observation kinds or test match
  dimensions are most often wrong)

## Step 4: Assess whether calibration is needed

- If overall accuracy >= current threshold AND no pending fixtures:
  report "No calibration needed" and stop.
- If pending fixtures exist OR accuracy < threshold: proceed to Step 4b.

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

Stop when:
- All classifications are correct, OR
- No single adjustment improves overall accuracy (plateau)

Document each adjustment: parameter, old value, new value, accuracy delta.

## Step 6: Update configuration

### If `--tool intent`

Write adjusted values to:
- `REFACTOR_TYPE_EXPECTED_REMOVALS` in `ast-interpret-refactor-intent.ts`
- `astConfig.intentMatcher.signalWeights` in `ast-config.ts` (if weights changed)

### If `--tool parity`

Write adjusted values to:
- `classifyTestParity`, `computeMatchScore`, or `computeTestWeight` in
  `ast-interpret-test-parity.ts` (inline constants)
- Or centralize in `astConfig.testParity` if the values are extracted there

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

## Step 7: Mark fixtures as calibrated

Update each pending fixture manifest for this tool: `status` -> `"calibrated"`.

## Step 8: Run regression test

```bash
npx vitest run --config scripts/AST/vitest.config.mts \
  scripts/AST/__tests__/interpreter-accuracy.spec.ts
```

The test loads ALL fixtures (both tools), groups by tool, runs each
tool's interpreter on its fixtures, and asserts accuracy >= threshold
per tool. This catches regressions where tuning one tool's weights
degrades the other.

## Step 9: Verify and commit

```bash
pnpm tsc --noEmit
pnpm build
npx eslint . --max-warnings 0
```

Commit:
```
calibrate(ast): tune <tool> weights (accuracy N% on M fixtures)
```

## Step 10: Report

Output:
- Tool: `<intent | parity>`
- Fixtures processed: N (N pending, N previously calibrated)
- Accuracy before: N%
- Accuracy after: N%
- Weights/thresholds changed: list
- Threshold: N%
- Bias profile: FP:FN

## Notes

- The regression test and the calibration skill use the same fixture
  format and the same interpreter APIs. They are the same system.
- Fixture manifests use `status: "pending"` until calibrated, then
  `status: "calibrated"`.
- Ground truth classifications in manifests are always hand-written.
  Never run the interpreter and copy output (circular).
- When adding new fixtures, add them with `status: "pending"` and
  run the calibration skill to incorporate them.
