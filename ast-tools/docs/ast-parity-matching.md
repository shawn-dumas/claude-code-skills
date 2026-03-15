# AST Parity Matching Algorithm

Reference for the test parity interpreter (`ast-interpret-pw-test-parity.ts`).
All values are from the source code and should be updated if the code changes.

## Composite similarity

Each source test is compared against every target test in the mapped file.
The composite similarity score determines whether a match exists:

```
composite = nameScore * 0.5
          + routeScore * 0.2
          + navScore * 0.15
          + pomScore * 0.15
```

| Signal        | Weight | Computed from                                    |
| ------------- | ------ | ------------------------------------------------ |
| Name overlap  | 50%    | Word overlap of test names (words with length >2) |
| Route overlap | 20%    | Shared `page.route()` URL patterns               |
| Nav overlap   | 15%    | Shared `page.goto()` URLs                         |
| POM overlap   | 15%    | Shared POM class names (classes ending in `Page`) |

Each overlap function uses: `intersection.size / max(setA.size, setB.size)`.

## Match threshold

```
composite < 0.15 --> no match (candidate rejected)
```

A source test with no candidate scoring >= 0.15 is classified `NOT_PORTED`.

## Test weight

After matching, weight determines the classification:

```
weight = assertionCount
       + (routeIntercepts.length * 2)
       + navigations.length
       + resolvedHelperWeight
       + pomUsages.length

minimum weight = 1
```

Helper delegation weight resolution (`resolveHelperWeight`):
- Tries three lookup strategies against the helper index:
  1. **Exact match**: `helperIndex.lookup[functionName]` (e.g., `signInWithEmulator`)
  2. **Fuzzy class match**: for `obj.method` names (e.g., `insights.verifyExport`),
     searches for any `ClassName.method` entry (e.g., `InsightsPage.verifyExport`).
     Returns the match only when exactly one candidate exists.
- Resolved weight: `max(resolvedAssertionCount, 3)` -- never below the flat-3
  baseline. POM methods with 0 assertions still have structural value.
- If no helper index or no match: flat weight of **3** per delegation

### Route normalization (mock handler baseline)

When the target suite uses a mock handler baseline (`mockHandlerBaselineMarker`
in `ast-config.ts`), route intercept weight is normalized. The source test's
excess route intercepts (routes the source has but the target lacks) are removed
from the source weight before computing the ratio. This prevents false REDUCED
classifications for integration tests that serve data via a global mock handler
instead of per-test `page.route()` calls.

## Classification boundaries

The weight ratio is `targetWeight / sourceWeight` (normalized when mock handler
baseline is active):

| Weight ratio | Classification | Meaning                                   |
| ------------ | -------------- | ----------------------------------------- |
| > 2.0        | `EXPANDED`     | Target has at least double the signals    |
| < 0.4        | `REDUCED`      | Target lost more than 60% of signals     |
| 0.4 -- 2.0   | `PARITY`       | Structurally equivalent coverage          |

### Assertion equivalence floor

When the weight ratio is < 0.4 (would-be REDUCED), the classifier checks
whether the target's total **resolved assertions** (explicit + POM-delegated)
meet or exceed the source's explicit assertion count. If so, the test is
classified `PARITY` instead of `REDUCED`, because the target is verifying
equivalent behavior through POM methods despite having lower infrastructure
weight. Also applies when the source has 0 assertions but the target has
resolved assertions (target is strictly more thorough).

### REDUCED override

Even if the weight ratio is in the PARITY band, the test is classified
`REDUCED` when:
- Source has > 2 "strong matchers" (`toHaveText`, `toContainText`,
  `toHaveValue`, `toHaveAttribute`, `toHaveCount`)
- Target has 0 of those matchers but has some assertions

### Zero-signal demotion

If every source test scores 0.00 similarity against all target tests
(no structural signal at all), the file status `PARITY` is demoted to
`SHRUNK`. Other file statuses are not affected.

## Confidence

Confidence is `low` when the weight ratio falls within 20% of a
classification boundary:

| Boundary zone      | Weight ratio range |
| ------------------- | ------------------ |
| Near-REDUCED        | 0.32 -- 0.48      |
| Near-EXPANDED       | 1.60 -- 2.40      |

All other weight ratios produce `high` confidence.

## Overall score

```
For each matched test:
  PARITY or EXPANDED:   matchedWeight += sourceWeight      (full credit)
  REDUCED:              matchedWeight += sourceWeight * 0.5 (half credit)
  NOT_PORTED:           matchedWeight += 0                  (no credit)

score = round((matchedWeight / totalWeight) * 100)   // 0-100
```

## File mapping

Source specs are mapped to target specs via `astConfig.testParity.fileMapping`.
The mapping uses basenames:

| Source (QA)                          | Target (integration)       |
| ------------------------------------ | -------------------------- |
| `auth.spec.ts`                       | `auth.spec.ts`             |
| `bpo.spec.ts`                        | `bpo.spec.ts`              |
| `exportInsightsTabs.spec.ts`         | `export.spec.ts`           |
| `generalComponents.spec.ts`          | `components.spec.ts`       |
| `mockDataAnalyzer.spec.ts`           | `analyzer.spec.ts`         |
| `mockDataRealTime.spec.ts`           | `realtime.spec.ts`         |
| `mockDataSystemLatency.spec.ts`      | `system-latency.spec.ts`   |
| `mockDataTeamProductivity.spec.ts`   | `team-productivity.spec.ts`|
| `mockDataUserProductivity.spec.ts`   | `user-productivity.spec.ts`|
| `projects.spec.ts`                   | `projects.spec.ts`         |
| `teams.spec.ts`                      | `teams.spec.ts`            |
| `userAssignmentsTeams.spec.ts`       | `assignments.spec.ts`      |
| `users.spec.ts`                      | `users.spec.ts`            |

Unmapped source files produce `NOT_MAPPED` status with all tests `NOT_PORTED`.
Target files with no source mapping appear in `netNewTargetFiles`.

## Split detection

After matching, the interpreter checks each matched source test for
unmatched target tests in the same file that share route intercept URLs
or navigation URLs. These are recorded in `splitCoverage[]` to indicate
a source test may have been split into multiple target tests.
