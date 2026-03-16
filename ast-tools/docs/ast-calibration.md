# AST Interpreter Calibration

Nine AST interpreter pipelines with a shared calibration system. Three
parity/intent tools compare code across branches or refactoring steps.
Six domain interpreters classify effects, hooks, ownership, templates,
test quality, and dead code from observation-producing AST tools.

All share the same ground-truth fixture infrastructure, accuracy
regression test, and calibration skill (`/calibrate-ast-interpreter`).

## Ground rules

Two rules protect the integrity of calibration data. Violating either
one makes accuracy numbers meaningless.

### 1. Anti-circularity: do not copy interpreter output into fixtures

Ground-truth classifications are always hand-written. Never run the
interpreter on a fixture file and copy its output into the manifest.
If you do, the accuracy test is circular -- it measures whether the
interpreter agrees with itself, not whether it is correct.

### 2. Separation of measurement and optimization: do not fix interpreters during fixture authoring

Fixture authoring establishes measurement infrastructure. Interpreter
tuning is optimization. These must happen in separate steps, separate
commits, and (ideally) separate sessions. Reasons:

- **The fixture is the ruler.** You do not adjust the ruler and the
  thing being measured in the same step. If you do, your accuracy
  percentage does not demonstrate that the interpreter classifies
  correctly -- it only demonstrates that you made the interpreter
  agree with your fixtures.

- **The calibration skill exists for a reason.** The
  `/calibrate-ast-interpreter` skill follows a diagnostic-first
  workflow: it checks for algorithmic defects (hard ceilings,
  double-counting, observer gaps, greedy tie-breaking failures)
  before tuning weights. An in-flight fix during fixture authoring
  bypasses those checks and may mask a deeper problem.

- **The 3+ pending fixture batch threshold prevents over-fitting.**
  One misclassification might be an edge case. Three in the same
  category reveal a systematic defect. Fixing on the first sighting
  optimizes for noise.

- **Commit atomicity for bisect.** Mixing fixture authoring with
  interpreter changes in the same commit makes it impossible to
  isolate whether a regression was caused by the fixture or the
  interpreter change.

When a fixture reveals a misclassification, note it in the cleanup
file (or append a `feedback-*` fixture) and move on. The calibration
skill will address it in batch.

## Current accuracy

| Tool | Accuracy | Fixtures | Threshold | Last calibrated |
|------|----------|----------|-----------|-----------------|
| Intent matcher | 100% (55/55) | 7 synthetic + 2 git-history | 60% | 2026-03-14 |
| Parity tool | 100% (26/26) | 3 synthetic + 6 git-history | 60% | 2026-03-14 |
| Vitest parity tool | 100% (13/13) | 3 synthetic + 4 git-history | 60% | 2026-03-15 |
| Effects | 89.5% (17/19) | 5 synthetic + 5 git-history | 60% | 2026-03-16 |
| Hooks | 100% (18/18) | 3 synthetic | 60% | 2026-03-16 |
| Ownership | 94.4% (17/18) | 4 synthetic + 5 git-history | 60% | 2026-03-16 |
| Template | 100% (14/14) | 3 synthetic + 5 git-history (incl. 3 negative) | 60% | 2026-03-16 |
| Test quality | 100% (48/48) | 4 synthetic + 4 git-history | 60% | 2026-03-16 |
| Dead code | 100% (12/12) | 4 synthetic | 60% | 2026-03-16 |

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

## Vitest Parity Tool

Compares Vitest test suites across branches. Inventories spec files,
matches tests by composite similarity, and classifies coverage status.
Uses the same ground-truth fixture infrastructure as the other tools.

### Pipeline

```
Source specs + Target specs
    |
    v
+---------------------------+
| ast-vitest-parity.ts      |  Observation: parses spec files into
|                           |  VtSpecInventory (describes, tests,
|                           |  assertions, mocks, renders, fixtures,
|                           |  lifecycle hooks)
+---------------------------+
    |
    v (VtSpecInventory[])
+---------------------------+
| ast-interpret-vitest-     |  Interpretation: matches source tests
| parity.ts                 |  to target tests, classifies each as
|                           |  PARITY / EXPANDED / REDUCED / NOT_PORTED
+---------------------------+
    |
    v (VtParityReport: matches, score)
```

### Test matching

Two-pass matching:

**Pass 1:** Exact normalized name matches (locked at sim=1.0).

**Pass 2:** Global-sort greedy. Computes ALL (source, target) candidate
pairs, sorts by composite similarity descending, assigns greedily.
This prevents low-quality matches from stealing targets that
higher-quality sources need.

Composite similarity:

| Signal | Weight | Measures |
|--------|--------|----------|
| Name token overlap | 0.60 | Jaccard on words > 2 chars |
| Assertion target overlap | 0.25 | Set intersection of expect() targets |
| Mock target overlap | 0.15 | Set intersection of vi.mock() paths |
| Describe-context bonus | +0.05 | Same parentDescribe name |

Match threshold: 0.15. Composite clamped to 1.0.

### Classification

Based on assertion ratio (target / source assertions):

| Assertion ratio | Status |
|----------------|--------|
| > 1.2 | EXPANDED |
| 0.8 -- 1.2 | PARITY |
| < 0.8 | REDUCED |

### test.each / it.each support

The observation tool handles the `it.each(...)('name %s', fn)` double-
invocation AST pattern. The outer call's expression is a CallExpression
(the `.each([...])` invocation), not an Identifier, so `resolveCallName`
does not cover it. A dedicated `detectEachPattern` function identifies
this structure in `extractTestBlocks`, `extractAssertions`,
`extractRenderCalls`, and `countTestsInDescribe`.

### Known limitation

Token-based matching is vulnerable to domain vocabulary overlap. When
two semantically unrelated tests share many domain-specific words (e.g.,
"should not redirect when feature flag is null" vs. "should only redirect
for the specific feature flag being guarded"), the composite similarity
can exceed the 0.15 threshold despite the tests testing different
behaviors. The describe-context bonus partially mitigates this for tests
in the same describe block.

## Effects Interpreter

Classifies each useEffect by its likely purpose. Consumes observations
from `ast-react-inventory`.

### Pipeline

```
React source files
    |
    v
+---------------------------+
| ast-react-inventory.ts    |  Observation: emits EFFECT_LOCATION,
|                           |  EFFECT_STATE_SETTER_CALL, EFFECT_PROP_READ,
|                           |  EFFECT_TIMER_CALL, EFFECT_DOM_API, etc.
+---------------------------+
    |
    v (EffectObservation[])
+---------------------------+
| ast-interpret-effects.ts  |  Interpretation: classifies each effect
|                           |  as DERIVED_STATE, EVENT_HANDLER_DISGUISED,
|                           |  TIMER_RACE, DOM_EFFECT, EXTERNAL_SUBSCRIPTION,
|                           |  or NECESSARY
+---------------------------+
    |
    v (EffectAssessment[])
```

### Classification categories

| Category | Meaning | Typical action |
|----------|---------|---------------|
| DERIVED_STATE | Effect mirrors fetched/prop/context data into state | Replace with useMemo or useQuery |
| EVENT_HANDLER_DISGUISED | Effect wraps what should be an event handler | Move to onClick/onSubmit |
| TIMER_RACE | Timer + setState without cleanup | Review cleanup |
| DOM_EFFECT | Ref or DOM API access | Likely legitimate |
| EXTERNAL_SUBSCRIPTION | Cleanup-based subscription (addEventListener) | Likely legitimate |
| NECESSARY | No suspicious patterns detected | Low priority |

### Thresholds and tunables

- Priority cascade order: DERIVED_STATE > EVENT_HANDLER_DISGUISED >
  TIMER_RACE > DOM_EFFECT (strong, hasDomApi only) >
  LIFECYCLE_IMPERATIVE > EXTERNAL_SUBSCRIPTION > NECESSARY
- `setterMirrorsProp` heuristic for prop-mirror DERIVED_STATE detection,
  including prefix stripping (initial*, default*, prev*, previous*, old*,
  cached*)
- Setter-mirrors-dep heuristic for useMemo-derived-to-state sync
- `classifyLifecycleImperative`: callback prop with cleanup pattern
- Async body detection (fetch/then/await patterns) for DERIVED_STATE
- Config: `astConfig.effects` (effect classification thresholds)

### Known limitations from calibration

1. **~~setterMirrorsProp does not handle prefix-in-prop patterns.~~**
   Fixed 2026-03-16. `setterMirrorsProp` now strips common prefixes
   (initial, default, prev, previous, old, cached) from prop names
   before comparison. Additionally, a new DERIVED_STATE branch matches
   setter-mirrors-dep patterns where the dep is a useMemo local rather
   than a direct prop.

2. **Observation layer does not emit EFFECT_DOM_API for DOM property
   assignments.** Setting `document.title = ...` does not produce an
   observation because the detector looks for method calls only, not
   property assignments. These effects classify as NECESSARY.

3. **~~Observation layer does not emit EFFECT_DOM_API for ref.current DOM
   property access.~~** RESOLVED 2026-03-16. The observation layer now
   resolves `useRef<T>()` generic type parameters. When T extends
   HTMLElement/SVGElement/Element, the EFFECT_REF_TOUCH observation carries
   `isDomRef: true`, and the interpreter classifies as DOM_EFFECT.
   Untyped refs (no generic parameter) remain ambiguous and fall through
   to NECESSARY. synth-effects-04 line 11 now correctly classified.

4. **Priority cascade: EVENT_HANDLER_DISGUISED wins over DOM_EFFECT.**
   When a useEffect has both a callback prop dependency and a
   `window.addEventListener` call, the cascade picks
   EVENT_HANDLER_DISGUISED because it is checked first.

5. **EVENT_HANDLER_DISGUISED detection requires `on*` callback prop.**
   The classifier only detects the event-handler-in-disguise pattern
   when a prop dependency name starts with `on`. Effects that respond
   to data changes by calling a setter (e.g., auto-select when data
   arrives) are conceptually event handlers but are classified as
   NECESSARY. Affects git-effects-03 (expected EVENT_HANDLER_DISGUISED,
   gets NECESSARY). Broadening this heuristic requires distinguishing
   "reactive side effect" from "necessary synchronization," which is
   a harder problem.

6. **94.7% accuracy (18/19) reflects 1 known heuristic limitation.**
   Synth and git-history fixtures together cover 19 classifications.
   The 1 remaining misclassification (git-effects-03, limitation 5)
   requires broader heuristic development to distinguish reactive side
   effects from necessary synchronization. Limitation 3 (DOM ref
   resolution) was resolved 2026-03-16.

## Hooks Interpreter

Classifies each hook call by its role in the component architecture.
Consumes observations from `ast-react-inventory`.

### Pipeline

```
React source files
    |
    v
+---------------------------+
| ast-react-inventory.ts    |  Observation: emits HOOK_CALL observations
|                           |  with hookName, importSource, containingFunction
+---------------------------+
    |
    v (HookCallObservation[])
+---------------------------+
| ast-interpret-hooks.ts    |  Interpretation: classifies each hook call
|                           |  using a 3-stage cascade: import path,
|                           |  name list, and naming convention
+---------------------------+
    |
    v (HookAssessment[])
```

### Classification categories

| Category | Meaning | DDAU implication |
|----------|---------|-----------------|
| LIKELY_SERVICE_HOOK | Data-fetching hook (TanStack Query) | Container only |
| LIKELY_CONTEXT_HOOK | Context consumption hook | Container only |
| LIKELY_AMBIENT_HOOK | UI utility hook (breakpoints, pagination) | Allowed in leaves |
| LIKELY_STATE_HOOK | React builtin (useState, useRef, useMemo) | Allowed in leaves |
| UNKNOWN_HOOK | Cannot classify automatically | Manual review |

### Classification stages

1. **Import path match**: checks `importSource` against config path patterns
   (`services/hooks/` -> service, `providers/context/` -> context)
2. **Name list match**: checks `hookName` against config sets
   (`ambientLeafHooks`, `stateHooks`)
3. **Naming convention**: falls back to `use<Domain>Query/Mutation` patterns

### Known limitations from calibration

1. **Import path resolution depends on codebase presence.** ts-morph
   resolves `@/` aliases against the real project's tsconfig. If the
   codebase were restructured, fixtures with real import paths would
   break silently.

2. **100% accuracy on synthetic fixtures is expected.** All 18 entries
   across 3 fixtures use unambiguous import paths and hook names from the
   config sets. Real-world hooks imported via barrel re-exports that
   obscure the original path would produce lower accuracy.

## Ownership Interpreter

Classifies each component as container, DDAU component, layout shell, or
leaf violation. Consumes observations from `ast-react-inventory`.

### Pipeline

```
React source files
    |
    v
+---------------------------+
| ast-react-inventory.ts    |  Observation: emits COMPONENT_DECLARATION,
|                           |  HOOK_CALL, PROP_FIELD observations
+---------------------------+
    |
    v (ComponentObservation[])
+---------------------------+
| ast-interpret-ownership.ts|  Interpretation: scores container signals
|                           |  (service hooks, context hooks, router,
|                           |  query state) against component signals
|                           |  (prop count, callback props)
+---------------------------+
    |
    v (OwnershipAssessment[])
```

### Classification categories

| Category | Meaning | Characteristics |
|----------|---------|----------------|
| CONTAINER | Orchestrates data-fetching and hook calls | Service hooks, context hooks, router |
| DDAU_COMPONENT | Receives all data via props | Props only, no forbidden hooks |
| LAYOUT_SHELL | Layout, auth guard, error boundary | Matches layout name patterns |
| LEAF_VIOLATION | Non-container with forbidden hooks | Needs refactoring or exception |
| AMBIGUOUS | Cannot determine automatically | Manual review |

### Signal scoring

Container signals: service hook calls, context hook calls, router hooks,
query state hooks, storage access, toast calls. Component signals: prop
count, callback prop count. Layout detection: suffix matching against
`astConfig.ownership.layoutExceptions` (e.g., `EightFlowDashboardLayout`
matches `DashboardLayout`). Exact match is tried first, then suffix match.

### Known limitations from calibration

1. **Evaluation harness does not pass sideEffectObservations.** Toast
   calls are never counted as container signals in the evaluation
   pipeline. The production CLI also omits side effects. The toast signal
   is effectively dead -- no caller passes side effect observations.

2. **useRouter classified differently by hooks vs ownership.** The hooks
   interpreter classifies `useRouter` as `LIKELY_AMBIENT_HOOK` (ambient
   leaf hooks config set). The ownership interpreter independently counts
   it as a router signal via `isRouterHook()`. This split classification
   is architecturally intentional.

3. **Config-passed hooks are invisible to static analysis.** When service
   hooks (e.g., `useGetAllQuery`, `useCreateMutation`) are passed via a
   `config` prop and destructured at runtime, the hooks interpreter
   classifies them as UNKNOWN_HOOK because they have no import path. This
   means containers that receive all their service hooks via props (like
   `SettingsEntityContainer`) get insufficient container signals. A
   heuristic fix (matching prop names or types against service hook naming
   patterns) would be fragile and over-engineered. Tracked as
   git-ownership-05 (pending). Accuracy impact: 1 misclassification.

4. **100% accuracy on synthetic fixtures is expected.** All 12 entries
   across 4 synthetic fixtures use unambiguous signals. The 5 git-history
   fixtures introduce real-world edge cases including layout name prefix
   mismatches and config-passed hooks.

## Template Interpreter

Classifies JSX return blocks by complexity, identifying extraction
candidates and complexity hotspots. Consumes observations from
`ast-jsx-analysis`.

### Pipeline

```
React source files
    |
    v
+---------------------------+
| ast-jsx-analysis.ts       |  Observation: emits JSX_TERNARY_CHAIN,
|                           |  JSX_GUARD_CHAIN, JSX_TRANSFORM_CHAIN,
|                           |  JSX_IIFE, JSX_INLINE_HANDLER,
|                           |  JSX_RETURN_BLOCK observations
+---------------------------+
    |
    v (JsxObservation[])
+---------------------------+
| ast-interpret-template.ts |  Interpretation: classifies returns as
|                           |  EXTRACTION_CANDIDATE (long returns) or
|                           |  COMPLEXITY_HOTSPOT (3+ distinct JSX
|                           |  observation kinds in one return)
+---------------------------+
    |
    v (TemplateAssessment[])
```

### Classification categories

| Category | Meaning | Typical action |
|----------|---------|---------------|
| EXTRACTION_CANDIDATE | Return block exceeds line threshold | Extract sub-components |
| COMPLEXITY_HOTSPOT | 3+ distinct JSX observation kinds in return | Flatten with /flatten-jsx-template |

### Thresholds

- EXTRACTION_CANDIDATE: return block line count > `astConfig.template.extractionThreshold`
- COMPLEXITY_HOTSPOT: 4+ distinct observation kinds, OR 3 distinct kinds
  with at least one substantive instance (above severity floor), OR
  inline handler with 4+ statements

### Known limitations from calibration

1. **Dual classification on long-return fixtures.** Long return blocks
   can trigger both EXTRACTION_CANDIDATE (from line count) and
   COMPLEXITY_HOTSPOT (from observation kind count). The evaluation
   harness matches correctly because EXTRACTION_CANDIDATE is emitted
   first by the interpreter's priority ordering.

2. **Severity filter on 3-kind boundary.** The original rule fired
   COMPLEXITY_HOTSPOT on any component with 3+ distinct JSX observation
   kinds. This produced false positives on clean components where all
   instances were trivial (depth-1 ternary, 1-statement handler, simple
   guard). Fixed by requiring at least one substantive instance when
   exactly 3 kinds are present. Severity floors align with
   `ast-config.ts` violation thresholds.

3. **100% accuracy on 8 fixtures.** All 14 entries across 8 fixtures
   (3 synthetic, 5 git-history, including 3 negative) classify
   correctly. Real-world components near threshold boundaries would
   produce lower accuracy.

## Test Quality Interpreter

Classifies test file characteristics: mock boundary compliance, assertion
patterns, test strategy, cleanup completeness, and data sourcing. Consumes
observations from `ast-test-analysis`.

### Pipeline

```
Test spec files
    |
    v
+---------------------------+
| ast-test-analysis.ts      |  Observation: emits MOCK_DECLARATION,
|                           |  ASSERTION_CALL, RENDER_CALL,
|                           |  PROVIDER_WRAPPER, CLEANUP_CALL,
|                           |  FIXTURE_IMPORT, etc.
+---------------------------+
    |
    v (TestObservation[])
+---------------------------+
| ast-interpret-test-        |  Interpretation: classifies mocks as
| quality.ts                |  boundary/internal/domain, assertions as
|                           |  user-visible/implementation, detects
|                           |  strategy, cleanup, data sourcing
+---------------------------+
    |
    v (TestQualityAssessment[])
```

### Classification categories

| Category | Meaning |
|----------|---------|
| MOCK_BOUNDARY_COMPLIANT | Mock targets only external boundaries |
| MOCK_INTERNAL_VIOLATION | Mocks own hook/component/utility |
| MOCK_DOMAIN_BOUNDARY | Mocks cross-domain service hook |
| ASSERTION_USER_VISIBLE | Asserts on rendered output/aria |
| ASSERTION_IMPLEMENTATION | Asserts on implementation details |
| ASSERTION_SNAPSHOT | Large snapshot assertion |
| DETECTED_STRATEGY | Records detected test strategy |
| CLEANUP_COMPLETE | Proper afterEach + restore |
| CLEANUP_INCOMPLETE | Missing cleanup patterns |
| DATA_SOURCING_COMPLIANT | Uses fixture system |
| DATA_SOURCING_VIOLATION | Shared mutable constants or as any |
| ORPHANED_TEST | Subject file does not exist |
| DELETE_CANDIDATE | High internal-mock count (triage) |

### Tunables

- `astConfig.testing.boundaryPackages`: package patterns for mock boundary
  compliance (fetch, firebase, next/router, etc.)
- `astConfig.testing.deleteThresholdInternalMocks`: internal mock count
  triggering DELETE_CANDIDATE (default: 3)
- `astConfig.testing.userVisibleMatchers`: assertion matcher patterns for
  ASSERTION_USER_VISIBLE classification

### Known limitations from calibration

1. **subjectExists and subjectDomainDir must be passed explicitly.** The
   evaluation harness needed fixes to pass `subjectExists` from the
   analysis and compute `subjectDomainDir` from the subject path.
   ORPHANED_TEST and MOCK_DOMAIN_BOUNDARY depend on these parameters.

2. **Entry-based evaluation needed test-file filtering.** The harness ran
   the interpreter on ALL manifest files including companion subjects.
   Fixed by filtering to `.spec.ts`/`.test.ts` files only for test-quality.

3. **MOCK_DOMAIN_BOUNDARY requires subdirectory fixture structure.** The
   interpreter compares mock target paths against the subject's domain
   directory. Flat fixture layouts cannot produce this classification.

4. **Ambiguous matching for file-level assessments.** Multiple assessments
   (DETECTED_STRATEGY, CLEANUP_*, DATA_SOURCING_*) share the same
   file-level signature. Fixed with two-pass matching in the harness.

5. **100% accuracy on synthetic fixtures is expected.** All 23 entries
   across 4 fixtures use unambiguous signals. Real-world test files with
   barrel re-export mocking or wrapper function assertions would produce
   lower accuracy.

### Calibration history

**2026-03-16: git-history fixtures + 3 fixes (accuracy 93.75% -> 100%)**

Added 4 git-history fixtures (git-test-quality-01 through 04) covering
barrel mock ambiguity, mixed assertion boundaries, strategy with
providers, and assertion edge cases. 3 misclassifications found:

1. **queryClient.clear() not recognized as cleanup** (git-03): observation
   layer fix. Added `queryCacheClearPatterns` to `ast-config.ts` and
   detection loop to `ast-test-analysis.ts` `extractCleanupObservations()`.
   Patterns: `queryClient.clear`, `queryClient.resetQueries`,
   `queryClient.removeQueries`.

2. **toThrow not in matcher lists** (git-04 line 22): config fix. Added
   `toThrow` to `astConfig.testing.userVisibleMatchers`. Rendering
   without errors is a user-visible outcome.

3. **Variable indirection hides screen query** (git-04 line 28):
   observation layer fix. Added `isScreenQueryVariable()` heuristic to
   `ast-test-analysis.ts`. When the expect argument is a bare identifier,
   walks up to the enclosing block and checks if any `const <name> =
   screen.<query>(...)` declaration matches. Single-level variable
   resolution only -- does not trace through function calls, re-assignments,
   or destructuring.

Result: 48/48 classifications correct across 8 fixtures (4 synth + 4
git-history). All marked calibrated.

## Dead Code Interpreter

Classifies dead exports, barrel re-exports, and circular dependencies from
the import graph. Consumes observations from `ast-imports`.

### Pipeline

```
Source directory
    |
    v
+---------------------------+
| ast-imports.ts            |  Observation: builds dependency graph,
|                           |  emits DEAD_EXPORT_CANDIDATE,
|                           |  CIRCULAR_DEPENDENCY, EXPORT_DECLARATION,
|                           |  REEXPORT_IMPORT observations
+---------------------------+
    |
    v (ImportObservation[])
+---------------------------+
| ast-interpret-dead-code.ts|  Interpretation: classifies dead exports
|                           |  by confidence (0 consumers = high,
|                           |  1 consumer = low/fragile), barrel
|                           |  re-exports, circular deps
+---------------------------+
    |
    v (DeadCodeAssessment[])
```

### Classification categories

| Category | Meaning | Confidence |
|----------|---------|-----------|
| DEAD_EXPORT | Export with 0 consumers | high |
| POSSIBLY_DEAD_EXPORT | 0 static consumers, may have dynamic | medium |
| DEAD_BARREL_REEXPORT | Barrel re-exports dead name | high |
| CIRCULAR_DEPENDENCY | Part of circular import chain | high |

### Tunables

- Fragile export threshold: exports with exactly 1 consumer get
  `confidence: 'low'` assessment (not dead, but fragile)
- `exportKind` distinction (type vs value) -- currently broken, see below
- Search directory for consumer detection (defaults to `src/`)

### Known limitations from calibration

1. **Per-directory dispatch required.** Unlike other interpreters that
   run per-file, dead-code runs on a dependency graph built from a
   directory. The evaluation harness needed a special branch to run the
   interpreter once for the entire fixture directory.

2. **DEAD_BARREL_REEXPORT uses name-only matching.** The interpreter
   matches dead export names against re-export names. A barrel re-export
   is only classified as dead if the re-exported name matches a dead
   export in a different file. Same-file re-exports create import edges
   that prevent the export from being dead.

3. **DEAD_EXPORT_CANDIDATE evidence lacks exportKind.** The
   `extractDeadExportObservations` function does not include `exportKind`
   in observation evidence. The interpreter's `isTypeExport` check reads
   `evidence.exportKind` which is always `undefined`. All dead exports get
   `confidence: 'high'` regardless of type/value distinction.

4. **Barrel REEXPORT_IMPORT line numbers come from resolved
   declarations.** When `collectDeclaredExports` runs on a barrel, line
   numbers come from the source module, not the barrel's export statement.

5. **Fragile export detection produces extra assessments.** Live exports
   with exactly 1 consumer are classified as fragile (`confidence: 'low'`).
   Fixture authors must give each live export 2+ consumers to avoid
   unwanted fragile assessments.

6. **100% accuracy on synthetic fixtures is expected.** All 12 entries
   across 4 fixtures use unambiguous graph structures. Real-world
   codebases with barrel chains, tsconfig path aliases, and dynamic
   imports would produce lower accuracy.

## Ground Truth Fixtures

Fixtures live in `scripts/AST/ground-truth/fixtures/`. Each fixture is
a directory containing source files and a `manifest.json` with expected
classifications. See the [fixture authoring guide](ast-fixture-authoring.md)
for the full evaluation pipeline, cross-file factory setup, and common pitfalls.

### Fixture sources

| Prefix | Source | Purpose |
|--------|--------|---------|
| `synth-intent-*` | Hand-written minimal examples | Core algorithm coverage |
| `synth-parity-*` | Hand-written spec pairs | PW parity matching coverage |
| `synth-vitest-parity-*` | Hand-written spec pairs | Vitest parity matching coverage |
| `synth-effects-*` | Hand-written component files | Effect classification coverage |
| `synth-hooks-*` | Hand-written component files | Hook role classification coverage |
| `synth-ownership-*` | Hand-written component files | Container/component classification |
| `synth-template-*` | Hand-written component files | JSX complexity classification |
| `synth-test-quality-*` | Hand-written spec files | Test quality classification coverage |
| `synth-dead-code-*` | Hand-written module graphs | Dead export/circular dep coverage |
| `git-intent-*` | Extracted from real git commits | Real-world validation |
| `git-parity-*` | Real QA-to-integration spec pairs | Real-world PW parity validation |
| `git-vitest-parity-*` | Real cross-branch spec pairs | Real-world Vitest parity validation |
| `feedback-*` | Created by consuming skills on misclassification | Regression prevention |

### Adding fixtures

1. Create a directory: `scripts/AST/ground-truth/fixtures/<prefix>-NN-description/`
2. Add source files (under 40 lines each)
3. Write `manifest.json` with `status: "pending"`
4. Hand-write all expected classifications (never copy tool output)
5. Run `/calibrate-ast-interpreter --tool <tool-name>` when 3+ pending fixtures exist

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
groups by tool (intent, parity, vitest-parity, effects, hooks,
ownership, template, test-quality, dead-code), runs each tool's
observation + interpretation pipeline, and asserts accuracy >= threshold
per tool. It catches regressions where changes to one tool degrade
accuracy on others.

Current test counts: 866 tests across 32 spec files (full AST suite).

## Calibration Skill

```bash
/calibrate-ast-interpreter --tool intent
/calibrate-ast-interpreter --tool parity
/calibrate-ast-interpreter --tool vitest-parity
/calibrate-ast-interpreter --tool effects
/calibrate-ast-interpreter --tool hooks
/calibrate-ast-interpreter --tool ownership
/calibrate-ast-interpreter --tool template
/calibrate-ast-interpreter --tool test-quality
/calibrate-ast-interpreter --tool dead-code
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
| 2026-03-15 | vitest-parity | it.each extraction, global-sort greedy matching, describe-context bonus | 69% (9/13) | 100% (13/13) |
| 2026-03-16 | effects | Initial fixture authoring (5 synthetic fixtures, 14 entries) | -- | 100% (14/14) |
| 2026-03-16 | hooks | Initial fixture authoring (3 synthetic fixtures, 18 entries) | -- | 100% (18/18) |
| 2026-03-16 | ownership | Initial fixture authoring (4 synthetic fixtures, 12 entries) | -- | 100% (12/12) |
| 2026-03-16 | template | Initial fixture authoring (3 synthetic fixtures, 8 entries incl. 1 negative) | -- | 100% (8/8) |
| 2026-03-16 | test-quality | Initial fixture authoring (4 synthetic fixtures, 23 entries) | -- | 100% (23/23) |
| 2026-03-16 | dead-code | Initial fixture authoring (4 synthetic fixtures, 12 entries) | -- | 100% (12/12) |
| 2026-03-16 | ownership | Algorithm fix: suffix matching for layout exceptions (5 git-history fixtures added) | 88.9% (16/18) | 94.4% (17/18) |
| 2026-03-16 | template | Algorithm fix: severity filter on 3-kind COMPLEXITY_HOTSPOT (5 git-history fixtures added) | 92.9% (13/14) | 100% (14/14) |
| 2026-03-16 | effects | Algorithm fix: ref.current narrowing, setterMirrorsProp prefix stripping, lifecycle imperative detection (5 git-history fixtures added) | 73.7% (14/19) | 89.5% (17/19) |
