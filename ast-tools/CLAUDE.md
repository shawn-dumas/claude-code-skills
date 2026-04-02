# AST Tool System

Agent-facing documentation for the static analysis tools in `scripts/AST/`.
See `README.md` for design philosophy and architecture overview.

## 1. Tool Inventory

### Observation Tools (registry-registered)

These tools are registered in `tool-registry.ts` and can be run via
`runAllObservers` or `runObservers` programmatically.

| Tool | ast-query route | Description |
|---|---|---|
| ast-authz-audit | `ast-query.ts authz <path>` | Detects raw role checks and role equality checks outside canonical files |
| ast-behavioral | `ast-query.ts behavioral <path>` | Extracts behavioral fingerprint: defaults, render caps, null coercion, string literals, column defs, state init, type coercion, conditional guards |
| ast-complexity | `ast-query.ts complexity <path>` | Measures cyclomatic complexity per function |
| ast-concern-matrix | `ast-query.ts concerns <path>` | Checks containers for loading/error/empty/permission handling |
| ast-data-layer | `ast-query.ts data-layer <path>` | Maps service hooks, query keys, fetchApi calls, API endpoints |
| ast-env-access | `ast-query.ts env <path>` | Detects process.env, clientEnv, serverEnv access patterns |
| ast-error-coverage | `ast-query.ts errors <path>` | Checks query/mutation error handling coverage per container |
| ast-export-surface | `ast-query.ts exports <path>` | Extracts export surface from isolated files (works on git refs) |
| ast-feature-flags | `ast-query.ts feature-flags <path>` | Maps PostHog feature flag usage, page guards, flag reads |
| ast-handler-structure | `ast-query.ts handler <path>` | Detects inline handler logic and multi-method handlers in BFF routes |
| ast-imports | `ast-query.ts imports <path>` | Builds import graph, detects circular deps and dead exports |
| ast-jsx-analysis | `ast-query.ts jsx <path>` | Measures JSX return complexity, ternary chains, inline handlers |
| ast-null-display | `ast-query.ts null-display <path>` | Detects null/empty display patterns, wrong placeholders, zero conflation |
| ast-number-format | `ast-query.ts number-format <path>` | Detects raw toFixed/toLocaleString, percentage display, format function usage |
| ast-react-inventory | `ast-query.ts hooks <path>` / `effects <path>` | Inventories hooks, effects, components, and props per file |
| ast-side-effects | `ast-query.ts side-effects <path>` | Detects console, toast, timer, PostHog, and window mutation calls |
| ast-storage-access | `ast-query.ts storage <path>` | Detects localStorage, sessionStorage, typedStorage, cookie access |
| ast-test-analysis | `ast-query.ts test-quality <path>` | Analyzes test file structure: mocks, assertions, cleanup, data sourcing |
| ast-test-coverage | `ast-query.ts test-coverage <path>` | Maps production files to spec files, computes risk scores |
| ast-type-safety | `ast-query.ts type-safety <path>` / `as-any <path>` | Detects as-any, as-unknown, non-null assertions, trust boundary casts |
| ast-pw-test-parity | `ast-query.ts pw-parity <path>` | Inventories Playwright spec structure, assertions, route intercepts |
| ast-vitest-parity | `ast-query.ts vitest-parity <path>` | Inventories Vitest spec structure, assertions, mocks, renders |
| ast-branded-check | `ast-query.ts branded <path>` | Detects unbranded ID fields and unbranded function params (UNBRANDED_PARAM) |

### Standalone Tools (not in registry)

These tools operate on non-TypeScript inputs or have specialized APIs.

| Tool | CLI | Description |
|---|---|---|
| ast-bff-gaps | `npx tsx scripts/AST/ast-bff-gaps.ts` | Compares BFF routes vs mock routes, finds missing/stub endpoints |
| ast-peer-deps | `npx tsx scripts/AST/ast-peer-deps.ts` | Checks peer dependency satisfaction across all installed packages |
| ast-plan-audit | `npx tsx scripts/AST/ast-plan-audit.ts <path>` | Audits orchestration plan markdown (MDAST-based, not TypeScript AST) |
| ast-skill-analysis | `npx tsx scripts/AST/ast-skill-analysis.ts <path>` | Analyzes skill file structure, stale paths, broken cross-refs |
| ast-refactor-intent | `npx tsx scripts/AST/ast-refactor-intent.ts --before <dir> --after <dir>` | Compares before/after observation sets to detect accidental behavioral drops |
| ast-field-refs | `npx tsx scripts/AST/ast-field-refs.ts <path> --field <name>` | Finds all structural references to a field/property name (access, destructuring, type defs, string literals) |
| ast-date-handling | `npx tsx scripts/AST/ast-date-handling.ts <path> [--summary]` | Detects raw Date usage vs. Temporal/formatDate. Classifies by layer (fe/bff/shared). Use `--summary` for raw/proper ratio. |
| ast-audit | `npx tsx scripts/AST/ast-audit.ts <path> [--output <dir>] [--json] [--diff <dir>]` | Deterministic codebase audit: runs all tools + interpreters, maps to findings, renders report. Replaces agent-driven audit. |

### Interpreters

Interpreters consume observations and emit assessments with confidence levels.

| Interpreter | Consumes | Assessment Kinds |
|---|---|---|
| ast-interpret-dead-code | ast-imports | DEAD_EXPORT, POSSIBLY_DEAD_EXPORT, DEAD_BARREL_REEXPORT, CIRCULAR_DEPENDENCY |
| ast-interpret-display-format | ast-number-format, ast-null-display | WRONG_PLACEHOLDER, MISSING_PLACEHOLDER, FALSY_COALESCE_NUMERIC, HARDCODED_DASH, RAW_FORMAT_BYPASS, PERCENTAGE_PRECISION_MISMATCH, ZERO_NULL_CONFLATION, INCONSISTENT_EMPTY_MESSAGE |
| ast-interpret-effects | ast-react-inventory | DERIVED_STATE, EVENT_HANDLER_DISGUISED, TIMER_RACE, DOM_EFFECT, EXTERNAL_SUBSCRIPTION, NECESSARY |
| ast-interpret-hooks | ast-react-inventory | LIKELY_SERVICE_HOOK, LIKELY_CONTEXT_HOOK, LIKELY_AMBIENT_HOOK, LIKELY_STATE_HOOK, UNKNOWN_HOOK |
| ast-interpret-ownership | ast-react-inventory | CONTAINER, DDAU_COMPONENT, LAYOUT_SHELL, LEAF_VIOLATION, AMBIGUOUS |
| ast-interpret-plan-audit | ast-plan-audit | HEADER_COMPLETE, VERIFICATION_PRESENT, CLEANUP_REFERENCED, CERTIFIED, BLOCKED_PREFLIGHT, PROMPT_DEFICIENCY, AGGREGATION_RISK, etc. |
| ast-interpret-pw-test-parity | ast-pw-test-parity | (parity matching across Playwright spec pairs) |
| ast-interpret-refactor-intent | ast-refactor-intent | (intention preservation scoring) |
| ast-interpret-skill-quality | ast-skill-analysis | STALE_FILE_PATH, STALE_COMMAND, BROKEN_CROSS_REF, CONVENTION_DRIFT, CONVENTION_ALIGNED, MISSING_SECTION_ROLE, etc. |
| ast-interpret-template | ast-jsx-analysis | EXTRACTION_CANDIDATE, COMPLEXITY_HOTSPOT |
| ast-interpret-test-coverage | ast-test-coverage | TEST_GAP (with risk and suggestedPriority) |
| ast-interpret-test-quality | ast-test-analysis | MOCK_BOUNDARY_COMPLIANT, MOCK_INTERNAL_VIOLATION, ASSERTION_USER_VISIBLE, ASSERTION_IMPLEMENTATION, CLEANUP_COMPLETE, ORPHANED_TEST, DELETE_CANDIDATE, etc. |
| ast-interpret-vitest-parity | ast-vitest-parity | PARITY, REDUCED, EXPANDED, NOT_PORTED (per test match) |
| ast-interpret-branch-classification | ast-complexity | TYPE_DISPATCH, NULL_GUARD, ERROR_CHECK, FEATURE_FLAG, BOOLEAN_GUARD, LOADING_CHECK, OTHER |

### Infrastructure

| File | Purpose |
|---|---|
| ast-cache.ts | File-level content cache with config-hash invalidation |
| ast-cache-warm.ts | Pre-populates cache for all observation tools across src/ |
| ast-config.ts | Centralized repo convention config (thresholds, patterns, hook lists) |
| cli.ts | Shared CLI argument parsing and output formatting |
| project.ts | ts-morph project singleton and path resolution |
| shared.ts | Shared AST traversal utilities |
| tool-registry.ts | Tool name to analyzer function mapping |
| types.ts | All observation and assessment type definitions |

## 1b. Primary CLI Entry Point: ast-query

`ast-query.ts` is the primary CLI interface for all routable AST tools.
It dispatches to the underlying tool based on a query-type argument.

```bash
npx tsx scripts/AST/ast-query.ts <query-type> <path...> [flags]
```

For CLI queries, use `ast-query.ts`. For programmatic use, import from
`tool-registry.ts` directly.

Run `npx tsx scripts/AST/ast-query.ts --help` for the full query-type
list. All flags (`--pretty`, `--count`, `--kind`, `--no-cache`,
`--test-files`, `--summary`) pass through to the underlying tool.

Common examples:

```bash
ast-query.ts imports src/shared/utils/ --pretty
ast-query.ts consumers src/shared/utils/date/formatDate/formatDate.ts --pretty
ast-query.ts symbol BadRequestError src/ --pretty
ast-query.ts dead-exports src/ui/page_blocks/ --pretty
ast-query.ts circular src/ui/ --pretty
ast-query.ts complexity src/ui/page_blocks/ --pretty
ast-query.ts as-any src/ui/ --pretty
ast-query.ts hooks src/ui/page_blocks/ --count
ast-query.ts effects src/ui/page_blocks/ --count
ast-query.ts date-summary src/ --pretty
ast-query.ts interpret-effects src/ui/page_blocks/dashboard/team/ --pretty
ast-query.ts interpret-hooks src/ui/page_blocks/dashboard/team/ --pretty
ast-query.ts batch hooks,complexity,interpret-branches src/path/file.tsx --pretty
```

**Batch mode** runs multiple query types in a single process, sharing the
parsed AST. Use when running 3+ queries on the same file. 33x faster than
sequential invocations (1.6s vs 54s for 9 queries). Supports observation
tools and interpreters (interpret-effects, interpret-hooks,
interpret-ownership, interpret-branches).

**Unroutable tools** (use direct invocation):

- `npx tsx scripts/AST/ast-bff-gaps.ts` (no path args)
- `npx tsx scripts/AST/ast-field-refs.ts <path> --field <name>`
- `npx tsx scripts/AST/ast-peer-deps.ts` (no path args)
- `npx tsx scripts/AST/ast-plan-audit.ts <path>`
- `npx tsx scripts/AST/ast-skill-analysis.ts <path>`
- `npx tsx scripts/AST/ast-refactor-intent.ts --before <dir> --after <dir>`

## 2. Observation/Assessment Architecture

The AST tools follow a three-layer architecture:

1. **Observations** (emitted by tools): Line-anchored structural facts.
   Every observation has a `kind` (e.g., `HOOK_CALL`, `JSX_TERNARY_CHAIN`),
   `file`, `line`, and `evidence` (structured details). Observations are
   objective -- no classifications or judgments.

2. **Assessments** (emitted by interpreters): Interpretations over
   observations plus repo config. Every assessment has `confidence`
   (high/medium/low), `rationale`, `basedOn` (which observations), and
   `requiresManualReview`. Assessments answer "is this a violation?"

3. **Report policy** (owned by skills): Skills decide when to mark
   `[AST-confirmed]`, bump severity, or force manual review.

The `ast-config.ts` file centralizes all repo conventions (hook lists,
path patterns, thresholds). Interpreters read from `astConfig` to make
classifications.

All observation types are defined in `types.ts`. Reference it for
canonical field definitions.

### Observation kinds per tool

**This table is exhaustive.** Every `--kind` value each tool accepts is
listed. If a kind is not in this table, it does not exist. Update this
table whenever a new kind is added to `types.ts`.

| Tool | Observations emitted | Interpreter |
|---|---|---|
| `ast-imports` | `STATIC_IMPORT`, `DYNAMIC_IMPORT`, `REEXPORT_IMPORT`, `SIDE_EFFECT_IMPORT`, `EXPORT_DECLARATION`, `CIRCULAR_DEPENDENCY`, `DEAD_EXPORT_CANDIDATE` | `ast-interpret-dead-code` |
| `ast-react-inventory` | `HOOK_CALL`, `HOOK_IMPORT`, `HOOK_DEFINITION`, `EFFECT_LOCATION`, `EFFECT_DEP_ENTRY`, `EFFECT_STATE_SETTER_CALL`, `EFFECT_FETCH_CALL`, `EFFECT_TIMER_CALL`, `EFFECT_NAVIGATION_CALL`, `EFFECT_STORAGE_CALL`, `EFFECT_TOAST_CALL`, `EFFECT_CLEANUP_PRESENT`, `EFFECT_ASYNC_CALL`, `EFFECT_PROP_READ`, `EFFECT_CONTEXT_READ`, `EFFECT_REF_TOUCH`, `EFFECT_DOM_API`, `EFFECT_BODY_DEP_CALL`, `COMPONENT_DECLARATION`, `PROP_FIELD` | `ast-interpret-effects`, `ast-interpret-hooks`, `ast-interpret-ownership` |
| `ast-jsx-analysis` | `JSX_TERNARY_CHAIN`, `JSX_GUARD_CHAIN`, `JSX_TRANSFORM_CHAIN`, `JSX_IIFE`, `JSX_INLINE_HANDLER`, `JSX_INLINE_STYLE`, `JSX_COMPLEX_CLASSNAME`, `JSX_RETURN_BLOCK` | `ast-interpret-template` |
| `ast-test-analysis` | `TEST_SUBJECT_IMPORT`, `TEST_HELPER_IMPORT`, `MOCK_DECLARATION`, `SPY_DECLARATION`, `MOCK_TARGET_RESOLVED`, `ASSERTION_CALL`, `RENDER_CALL`, `PROVIDER_WRAPPER`, `AFTER_EACH_BLOCK`, `CLEANUP_CALL`, `FIXTURE_IMPORT`, `SHARED_MUTABLE_IMPORT`, `DESCRIBE_BLOCK`, `TEST_BLOCK`, `PLAYWRIGHT_IMPORT`, `TEST_HELPER_DELEGATION`, `SEQUENTIAL_MOCK_RESPONSE`, `TIMER_NEGATIVE_ASSERTION`, `MOCK_INTERNAL`, `MISSING_CLEANUP`, `DATA_SOURCING_VIOLATION`, `IMPLEMENTATION_ASSERTION` | `ast-interpret-test-quality` |
| `ast-test-coverage` | `TEST_COVERAGE` | `ast-interpret-test-coverage` |
| `ast-complexity` | `FUNCTION_COMPLEXITY` | (observation-only) |
| `ast-data-layer` | `QUERY_HOOK_DEFINITION`, `MUTATION_HOOK_DEFINITION`, `FETCH_API_CALL`, `QUERY_KEY_FACTORY`, `API_ENDPOINT`, `QUERY_INVALIDATION` | (observation-only) |
| `ast-handler-structure` | `HANDLER_INLINE_LOGIC`, `HANDLER_MULTI_METHOD` | (observation-only) |
| `ast-side-effects` | `CONSOLE_CALL`, `TOAST_CALL`, `TIMER_CALL`, `POSTHOG_CALL`, `WINDOW_MUTATION` | (observation-only) |
| `ast-storage-access` | `DIRECT_STORAGE_CALL`, `TYPED_STORAGE_CALL`, `JSON_PARSE_CALL`, `JSON_PARSE_ZOD_GUARDED`, `COOKIE_CALL`, `STORAGE_PROPERTY_ACCESS` | (observation-only) |
| `ast-env-access` | `PROCESS_ENV_ACCESS`, `ENV_WRAPPER_ACCESS`, `ENV_WRAPPER_IMPORT`, `RAW_ENV_IMPORT` | (observation-only) |
| `ast-feature-flags` | `FLAG_HOOK_CALL`, `FLAG_READ`, `PAGE_GUARD`, `NAV_TAB_GATE`, `CONDITIONAL_RENDER`, `FLAG_OVERRIDE` | (observation-only) |
| `ast-type-safety` | `AS_ANY_CAST`, `AS_UNKNOWN_AS_CAST`, `NON_NULL_ASSERTION`, `EXPLICIT_ANY_ANNOTATION`, `CATCH_ERROR_ANY`, `TS_DIRECTIVE`, `ESLINT_DISABLE`, `TRUST_BOUNDARY_CAST` | (observation-only) |
| `ast-pw-test-parity` | `PW_TEST_BLOCK`, `PW_ASSERTION`, `PW_ROUTE_INTERCEPT`, `PW_NAVIGATION`, `PW_POM_USAGE`, `PW_AUTH_CALL`, `PW_SERIAL_MODE`, `PW_BEFORE_EACH`, `PW_HELPER_DELEGATION` | `ast-interpret-pw-test-parity` |
| `ast-refactor-intent` | `INTENT_SIGNAL_BEFORE`, `INTENT_SIGNAL_AFTER`, `INTENT_SIGNAL_PAIR` | `ast-interpret-refactor-intent` |
| `ast-authz-audit` | `RAW_ROLE_CHECK`, `RAW_ROLE_EQUALITY` | (observation-only) |
| `ast-behavioral` | `DEFAULT_PROP_VALUE`, `RENDER_CAP`, `NULL_COERCION_DISPLAY`, `CONDITIONAL_RENDER_GUARD`, `JSX_STRING_LITERAL`, `COLUMN_DEFINITION`, `STATE_INITIALIZATION`, `TYPE_COERCION_BOUNDARY` | (observation-only) |
| `ast-bff-gaps` | `BFF_STUB_ROUTE`, `MOCK_ROUTE`, `BFF_MISSING_ROUTE`, `QUERY_HOOK_BFF_GAP` | (observation-only) |
| `ast-branded-check` | `UNBRANDED_ID_FIELD`, `UNBRANDED_PARAM` | (observation-only) |
| `ast-vitest-parity` | `VT_DESCRIBE_BLOCK`, `VT_TEST_BLOCK`, `VT_ASSERTION`, `VT_MOCK_DECLARATION`, `VT_RENDER_CALL`, `VT_FIXTURE_IMPORT`, `VT_BEFORE_EACH`, `VT_AFTER_EACH` | `ast-interpret-vitest-parity` |
| `ast-error-coverage` | `QUERY_ERROR_HANDLED`, `QUERY_ERROR_UNHANDLED`, `MUTATION_ERROR_HANDLED`, `MUTATION_ERROR_UNHANDLED`, `GLOBAL_ERROR_HANDLER` | (observation-only) |
| `ast-concern-matrix` | `CONTAINER_HANDLES_LOADING`, `CONTAINER_HANDLES_ERROR`, `CONTAINER_HANDLES_EMPTY`, `CONTAINER_HANDLES_PERMISSION`, `CONTAINER_MISSING_LOADING`, `CONTAINER_MISSING_ERROR`, `CONTAINER_MISSING_EMPTY`, `CONTAINER_MISSING_PERMISSION` | (observation-only) |
| `ast-export-surface` | `EXPORT_SURFACE` | (observation-only) |
| `ast-plan-audit` | `PLAN_HEADER_MISSING`, `PLAN_HEADER_INVALID`, `VERIFICATION_BLOCK_MISSING`, `CLEANUP_FILE_MISSING`, `PROMPT_FILE_MISSING`, `PROMPT_VERIFICATION_MISSING`, `PROMPT_DEPENDENCY_CYCLE`, `PROMPT_MODE_UNSET`, `STANDING_ELEMENT_MISSING`, `RECONCILIATION_TEMPLATE_MISSING`, `PRE_FLIGHT_CERTIFIED`, `PRE_FLIGHT_CONDITIONAL`, `PRE_FLIGHT_BLOCKED`, `PRE_FLIGHT_MARK_MISSING`, `NAMING_CONVENTION_INSTRUCTION`, `CLIENT_SIDE_AGGREGATION`, `DEFERRED_CLEANUP_REFERENCE`, `FILE_PATH_REFERENCE`, `SKILL_REFERENCE`, `PROMPT_DEPENDENCY_EDGE_COUNT`, `PROMPT_CHAIN_DEPTH`, `PROMPT_FAN_OUT`, `PLAN_PROMPT_COUNT`, `PLAN_FILE_REFERENCE_DENSITY` | (observation-only, MDAST-based) |
| `ast-skill-analysis` | `SKILL_SECTION`, `SKILL_STEP`, `SKILL_SECTION_ROLE`, `SKILL_CODE_BLOCK`, `SKILL_COMMAND_REF`, `SKILL_FILE_PATH_REF`, `SKILL_CROSS_REF`, `SKILL_DOC_REF`, `SKILL_TABLE`, `SKILL_CHECKLIST_ITEM`, `SKILL_SUPERSEDED_PATTERN`, `SKILL_MISSING_CONVENTION`, `SKILL_CONVENTION_ALIGNED`, `SKILL_INVALID_ROLE` | `ast-interpret-skill-quality` |
| `ast-number-format` | `FORMAT_NUMBER_CALL`, `FORMAT_INT_CALL`, `FORMAT_DURATION_CALL`, `FORMAT_CELL_VALUE_CALL`, `RAW_TO_FIXED`, `RAW_TO_LOCALE_STRING`, `PERCENTAGE_DISPLAY`, `INTL_NUMBER_FORMAT` | `ast-interpret-display-format` |
| `ast-null-display` | `NULL_COALESCE_FALLBACK`, `FALSY_COALESCE_FALLBACK`, `NO_FALLBACK_CELL`, `HARDCODED_PLACEHOLDER`, `EMPTY_STATE_MESSAGE`, `ZERO_CONFLATION` | `ast-interpret-display-format` |
| `ast-peer-deps` | `PEER_DEP_SATISFIED`, `PEER_DEP_VIOLATED`, `PEER_DEP_OPTIONAL_MISSING` | (observation-only, JSON metadata) |

## 3. Calibration

All 9+ interpreter tools have ground-truth calibration fixtures in
`scripts/AST/ground-truth/`. The `/calibrate-ast-interpreter` skill
introduces a feedback loop: interpreters emit assessments, the calibration
skill measures accuracy against fixture ground truth, and tunes the
weights/thresholds in `ast-config.ts`. The skill follows a diagnostic-first
approach: it checks for algorithmic defects (hard ceilings, double-counting)
before tuning weights. Consuming skills (audit, build, refactor) create
feedback fixtures when they encounter misclassifications, and the calibration
skill consumes them in batches (3+ pending fixtures). See
`scripts/AST/docs/ast-calibration.md` for accuracy baselines and calibration
history.

**Calibration cadence check.** Before starting any orchestration plan that
runs audit, refactor, or build skills, check pending fixture count:

```bash
for f in scripts/AST/ground-truth/fixtures/*/manifest.json; do
  tool=$(python3 -c "import json; print(json.load(open('$f')).get('status',''))")
  [ "$tool" = "pending" ] && echo "PENDING: $f"
done
```

If any interpreter tool has 3+ pending fixtures, run
`/calibrate-ast-interpreter --tool <name>` before proceeding.

## 4. Running AST Tools

Use `ast-query.ts` as the primary CLI entry point. For programmatic use,
import from `tool-registry.ts` directly.

```bash
# Observation output (JSON by default)
npx tsx scripts/AST/ast-query.ts complexity src/shared/utils/date/formatDate.ts

# Pretty-printed observation output
npx tsx scripts/AST/ast-query.ts hooks src/ui/page_blocks/dashboard/team/**/*.tsx --pretty

# Filter by observation kind
npx tsx scripts/AST/ast-query.ts test-quality src/ui/page_blocks/dashboard/ --kind MOCK_DECLARATION

# Count mode for verification
npx tsx scripts/AST/ast-query.ts test-quality src/ui/page_blocks/dashboard/ --kind TIMER_NEGATIVE_ASSERTION --count

# Scan test files with any tool
npx tsx scripts/AST/ast-query.ts type-safety src/ui/page_blocks/dashboard/ --test-files --kind AS_UNKNOWN_AS_CAST

# Multi-file
npx tsx scripts/AST/ast-query.ts type-safety src/shared/utils/date/*.ts src/shared/utils/string/*.ts

# Run an interpreter
npx tsx scripts/AST/ast-query.ts interpret-effects src/ui/page_blocks/dashboard/team/
```

### CLI flags

All observation tools accept these flags:

- `--pretty` -- human-readable JSON output
- `--kind <KIND>` -- filter observations to a single kind
- `--count` -- output observation kind counts (e.g., `{"MOCK_DECLARATION": 5}`)
- `--test-files` -- scan test/spec files instead of production files
- `--no-cache` -- bypass the file-content cache

Exceptions: `ast-test-analysis` omits `--test-files` (always scans test
files by design). `ast-imports` caches the full dependency graph to disk
(keyed by target directory content hash); `--no-cache` forces recompute.

## 5. Authority Rules

1. **Authoritative observations MUST become findings.** When an AST tool
   emits an observation, the consuming agent MUST report it. Agents do not
   decide whether to include tool-emitted observations -- they format them.

2. **Priority comes from PRIORITY_RULES.** The `PRIORITY_RULES` array and
   `lookupPriority()` function in `ast-config.ts` are the single source of
   truth for finding priority assignment. Agents use `lookupPriority(kind,
   context)` to get the priority. They do not assign priorities by judgment.

3. **Agent priority override is ONLY allowed when no AST tool can make the
   determination.** If a finding kind has no corresponding tool or
   `PRIORITY_RULES` entry, the agent may assign priority. This is the only
   case where agent judgment is acceptable for priority.

4. **If overriding, MUST add a GAPS.md entry.** Any pattern where an agent
   makes a judgment that should be tool-determined requires an entry in
   `scripts/AST/GAPS.md`. This tracks un-relocated judgments for future
   tool development.

## 6. Ground Truth Fixtures

Fixtures live in `scripts/AST/__tests__/fixtures/`. Each fixture is a
minimal TypeScript/TSX file that exercises specific observation or
assessment behaviors.

Interpreter ground truth lives in `scripts/AST/ground-truth/fixtures/`.
Each interpreter tool has a subdirectory with a `manifest.json` tracking
fixture status (pending, calibrated).

Run all AST tool tests:

```bash
npx vitest run --config scripts/AST/vitest.config.mts
```

The tests validate that:
- Observation tools emit the correct kinds for each fixture
- Observation counts match expected values
- Interpreters produce assessments matching ground truth classifications
- Edge cases (negative fixtures) produce zero observations

### Observation Snapshots

Ground-truth accuracy tests use pre-computed observation snapshots
(`observations.json` alongside each `manifest.json`) instead of
re-parsing fixtures with ts-morph at test time. This makes accuracy
tests run in ~2ms instead of ~3s, eliminating timeout sensitivity.

**After changing parser logic** (ast-react-inventory, ast-jsx-analysis,
ast-test-analysis, or their observation extraction), regenerate snapshots:

```bash
npx tsx scripts/AST/__tests__/snapshot-observations.ts
```

The "Observation snapshot freshness" tests in `interpreter-accuracy.spec.ts`
re-parse one fixture per tool and compare against the snapshot. They will
fail with a clear message if snapshots are stale. Use `--check` to verify
without writing:

```bash
npx tsx scripts/AST/__tests__/snapshot-observations.ts --check
```

## 7. Adding New Tools

Checklist:

1. Add observation types to `types.ts` (define the kind union and evidence type)
2. Create the tool file (`ast-<name>.ts`)
   - Export `analyze*()` for programmatic use
   - Export observation extraction function for the registry
   - Include `main()` + `isDirectRun` guard for CLI
   - Use `outputFiltered` for CLI output (provides `--kind` and `--count` for free)
3. Register in `tool-registry.ts` (add adapter + entry to `entries` array)
4. Write spec file (`__tests__/ast-<name>.spec.ts`)
5. Add test fixtures to `__tests__/fixtures/`
6. Add finding kind to `PRIORITY_RULES` in `ast-config.ts` if the tool
   introduces a new finding kind
7. Add any repo-convention config to the appropriate section in `ast-config.ts`
8. Update this CLAUDE.md (add to tool inventory, observation types section)
9. Update the project root CLAUDE.md tool inventory table
