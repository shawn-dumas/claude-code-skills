# AST Tool System

Agent-facing documentation for the static analysis tools in `scripts/AST/`.
See `README.md` for design philosophy and architecture overview.

## 1. Tool Inventory

### Observation Tools (registry-registered)

These tools are registered in `tool-registry.ts` and can be run via
`runAllObservers` or `runObservers` programmatically.

| Tool | CLI | Description |
|---|---|---|
| ast-authz-audit | `npx tsx scripts/AST/ast-authz-audit.ts <path>` | Detects raw role checks and role equality checks outside canonical files |
| ast-complexity | `npx tsx scripts/AST/ast-complexity.ts <path>` | Measures cyclomatic complexity per function |
| ast-concern-matrix | `npx tsx scripts/AST/ast-concern-matrix.ts <path>` | Checks containers for loading/error/empty/permission handling |
| ast-data-layer | `npx tsx scripts/AST/ast-data-layer.ts <path>` | Maps service hooks, query keys, fetchApi calls, API endpoints |
| ast-env-access | `npx tsx scripts/AST/ast-env-access.ts <path>` | Detects process.env, clientEnv, serverEnv access patterns |
| ast-error-coverage | `npx tsx scripts/AST/ast-error-coverage.ts <path>` | Checks query/mutation error handling coverage per container |
| ast-export-surface | `npx tsx scripts/AST/ast-export-surface.ts <path>` | Extracts export surface from isolated files (works on git refs) |
| ast-feature-flags | `npx tsx scripts/AST/ast-feature-flags.ts <path>` | Maps PostHog feature flag usage, page guards, flag reads |
| ast-handler-structure | `npx tsx scripts/AST/ast-handler-structure.ts <path>` | Detects inline handler logic and multi-method handlers in BFF routes |
| ast-imports | `npx tsx scripts/AST/ast-imports.ts <path>` | Builds import graph, detects circular deps and dead exports |
| ast-jsx-analysis | `npx tsx scripts/AST/ast-jsx-analysis.ts <path>` | Measures JSX return complexity, ternary chains, inline handlers |
| ast-null-display | `npx tsx scripts/AST/ast-null-display.ts <path>` | Detects null/empty display patterns, wrong placeholders, zero conflation |
| ast-number-format | `npx tsx scripts/AST/ast-number-format.ts <path>` | Detects raw toFixed/toLocaleString, percentage display, format function usage |
| ast-react-inventory | `npx tsx scripts/AST/ast-react-inventory.ts <path>` | Inventories hooks, effects, components, and props per file |
| ast-side-effects | `npx tsx scripts/AST/ast-side-effects.ts <path>` | Detects console, toast, timer, PostHog, and window mutation calls |
| ast-storage-access | `npx tsx scripts/AST/ast-storage-access.ts <path>` | Detects localStorage, sessionStorage, typedStorage, cookie access |
| ast-test-analysis | `npx tsx scripts/AST/ast-test-analysis.ts <path>` | Analyzes test file structure: mocks, assertions, cleanup, data sourcing |
| ast-test-coverage | `npx tsx scripts/AST/ast-test-coverage.ts <path>` | Maps production files to spec files, computes risk scores |
| ast-type-safety | `npx tsx scripts/AST/ast-type-safety.ts <path>` | Detects as-any, as-unknown, non-null assertions, trust boundary casts |
| ast-pw-test-parity | `npx tsx scripts/AST/ast-pw-test-parity.ts <path>` | Inventories Playwright spec structure, assertions, route intercepts |
| ast-vitest-parity | `npx tsx scripts/AST/ast-vitest-parity.ts <path>` | Inventories Vitest spec structure, assertions, mocks, renders |

### Standalone Tools (not in registry)

These tools operate on non-TypeScript inputs or have specialized APIs.

| Tool | CLI | Description |
|---|---|---|
| ast-bff-gaps | `npx tsx scripts/AST/ast-bff-gaps.ts` | Compares BFF routes vs mock routes, finds missing/stub endpoints |
| ast-branded-check | `npx tsx scripts/AST/ast-branded-check.ts <path>` | Detects unbranded ID fields and unbranded function params (UNBRANDED_PARAM) |
| ast-peer-deps | `npx tsx scripts/AST/ast-peer-deps.ts` | Checks peer dependency satisfaction across all installed packages |
| ast-plan-audit | `npx tsx scripts/AST/ast-plan-audit.ts <path>` | Audits orchestration plan markdown (MDAST-based, not TypeScript AST) |
| ast-skill-analysis | `npx tsx scripts/AST/ast-skill-analysis.ts <path>` | Analyzes skill file structure, stale paths, broken cross-refs |
| ast-refactor-intent | `npx tsx scripts/AST/ast-refactor-intent.ts --before <dir> --after <dir>` | Compares before/after observation sets to detect accidental behavioral drops |

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

## 2. Observation Types

All observation types are defined in `types.ts`. Each observation has
`kind`, `file`, `line`, and `evidence` (a typed record specific to the kind).

Assessments add `confidence` (high/medium/low), `rationale`, `basedOn`
(observation references), `isCandidate`, and `requiresManualReview`.

Reference `types.ts` for the canonical field definitions. The CLAUDE.md
in the project root lists observation kinds per tool in the "Tool inventory"
table.

## 3. Authority Rules

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

## 4. Ground Truth Fixtures

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

## 5. Adding New Tools

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
