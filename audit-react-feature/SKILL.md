---
name: audit-react-feature
description: Audit an entire React feature area. Maps dependencies, counts violations across all files, classifies every hook call and useEffect, and produces a prioritized migration checklist.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/feature/directory>
---

Audit the React feature area at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a complete migration report.

<!-- role: workflow -->

## Step 0: Run AST analysis tools and interpreters

Before reading files manually, run observation-producing tools AND their
interpreters. All tools accept glob patterns and multiple paths natively.

```bash
# --- Observation-producing tools ---

# Authorization patterns (emits RAW_ROLE_CHECK observations)
npx tsx scripts/AST/ast-authz-audit.ts $ARGUMENTS --pretty

# Dependency graph (emits STATIC_IMPORT, CIRCULAR_DEPENDENCY, DEAD_EXPORT_CANDIDATE observations)
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty

# Component/hook/effect inventory (emits HOOK_CALL, COMPONENT_DECLARATION, EFFECT_* observations)
npx tsx scripts/AST/ast-react-inventory.ts $ARGUMENTS/**/*.tsx --pretty

# JSX template complexity (emits JSX_TERNARY_CHAIN, JSX_RETURN_BLOCK, etc. observations)
npx tsx scripts/AST/ast-jsx-analysis.ts $ARGUMENTS/**/*.tsx --pretty

# Type safety (emits AS_ANY_CAST, NON_NULL_ASSERTION, TRUST_BOUNDARY_CAST observations)
npx tsx scripts/AST/ast-type-safety.ts $ARGUMENTS --pretty

# Side effects (emits CONSOLE_CALL, TOAST_CALL, TIMER_CALL observations)
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty

# Storage access (emits DIRECT_STORAGE_CALL, TYPED_STORAGE_CALL observations)
npx tsx scripts/AST/ast-storage-access.ts $ARGUMENTS --pretty

# Service hooks, query keys, fetchApi endpoints (emits QUERY_HOOK_DEFINITION, FETCH_API_CALL observations)
npx tsx scripts/AST/ast-data-layer.ts $ARGUMENTS --pretty

# Feature flag usage (emits FLAG_HOOK_CALL, PAGE_GUARD, CONDITIONAL_RENDER observations)
npx tsx scripts/AST/ast-feature-flags.ts $ARGUMENTS --pretty

# Environment variable access (emits PROCESS_ENV_ACCESS, ENV_WRAPPER_ACCESS observations)
npx tsx scripts/AST/ast-env-access.ts $ARGUMENTS --pretty

# --- Interpreters (produce assessments over observations) ---

# Hook classification (emits LIKELY_SERVICE_HOOK, LIKELY_CONTEXT_HOOK, LIKELY_AMBIENT_HOOK, UNKNOWN_HOOK assessments)
npx tsx scripts/AST/ast-interpret-hooks.ts $ARGUMENTS/**/*.tsx --pretty

# Effect classification (emits DERIVED_STATE, EVENT_HANDLER_DISGUISED, TIMER_RACE, DOM_EFFECT, NECESSARY assessments)
npx tsx scripts/AST/ast-interpret-effects.ts $ARGUMENTS/**/*.tsx --pretty

# Ownership classification (emits CONTAINER, DDAU_COMPONENT, LEAF_VIOLATION, LAYOUT_SHELL assessments)
npx tsx scripts/AST/ast-interpret-ownership.ts $ARGUMENTS/**/*.tsx --pretty

# Template assessment (emits EXTRACTION_CANDIDATE, COMPLEXITY_HOTSPOT assessments)
npx tsx scripts/AST/ast-interpret-template.ts $ARGUMENTS/**/*.tsx --pretty

# Dead code detection (emits DEAD_EXPORT, POSSIBLY_DEAD_EXPORT, CIRCULAR_DEPENDENCY assessments)
npx tsx scripts/AST/ast-interpret-dead-code.ts $ARGUMENTS --pretty

# Error handling coverage (emits QUERY_ERROR_UNHANDLED, MUTATION_ERROR_UNHANDLED observations)
npx tsx scripts/AST/ast-error-coverage.ts $ARGUMENTS --count
npx tsx scripts/AST/ast-error-coverage.ts $ARGUMENTS --kind QUERY_ERROR_UNHANDLED --pretty

# Behavioral concern matrix (emits CONTAINER_MISSING_LOADING, CONTAINER_MISSING_ERROR, etc.)
npx tsx scripts/AST/ast-concern-matrix.ts $ARGUMENTS --count
```

### New tools available

New tools available:
- ast-test-coverage: maps production files to test coverage status
- ast-handler-structure: detects inline API handler logic and multi-method handlers
- ast-branded-type-gaps: detects bare primitives where branded types exist

### Error handling coverage

Use `QUERY_ERROR_UNHANDLED` and `MUTATION_ERROR_UNHANDLED` observations to
identify containers with unhandled query/mutation errors. These are
`[AST-confirmed]` findings (structural facts). Include in the migration
checklist: containers must handle error states for every query/mutation.

### Behavioral concern matrix

Use `CONTAINER_MISSING_*` observations to identify containers that lack
loading, error, or empty state handling. Containers scoring below 2/3
(missing 2+ of loading/error/empty) should be flagged in the audit findings.

### Using observations and assessments

**Observations** are structural facts with no classification (line X has
a `useState` call, line Y has a ternary chain of depth 3). They populate
inventory tables.

**Assessments** are interpretations over observations with confidence
levels and rationale. They populate the classification columns and the
"Manual Review Required" section.

Use observations for counts and inventories. Use assessments for
classification decisions. When an assessment says `requiresManualReview:
true`, include the item in the Manual Review section of the report.

<!-- role: guidance -->

## Report Policy

### Tool authority

TOOL AUTHORITY: Do NOT filter AST tool output. Every observation with
confidence >= medium becomes a finding. Report ALL authoritative
observations from ast-test-analysis, ast-test-coverage, ast-complexity,
ast-imports, ast-type-safety, ast-interpret-effects, ast-interpret-hooks,
ast-interpret-ownership, ast-concern-matrix, ast-handler-structure,
ast-branded-type-gaps, and all other registered AST tools.

### GAP.md enforcement

GAP.md ENFORCEMENT: If you assign `architecture-smell` as the finding
kind, you MUST simultaneously append to scripts/AST/GAPS.md with:
- Pattern class name
- File example
- What AST tool would need to detect this pattern
No exceptions. This is the feedback loop for tool development.

### AST-confirmed tagging

An assessment qualifies for `[AST-confirmed]` tagging when ALL of:

- Based on observations only (no interpretive leap), OR is an
  assessment whose sole input is a structural count or graph fact
- Confidence is `high`
- `isCandidate: false`
- `requiresManualReview: false`

Examples that qualify:

- `DIRECT_STORAGE_CALL` observation -> `[AST-confirmed]` (structural fact)
- `DEAD_EXPORT` assessment with high confidence -> `[AST-confirmed]`
  (zero consumer count from import graph, no classification heuristic)
- `CIRCULAR_DEPENDENCY` assessment -> `[AST-confirmed]` (graph fact)
- Type safety observations (`AS_ANY_CAST`, `NON_NULL_ASSERTION`) -> `[AST-confirmed]`

Examples that do NOT qualify, even at high confidence:

- `LIKELY_SERVICE_HOOK` -- interpreter output; classifying a hook as
  "service" applies heuristic rules over import paths, not a structural
  fact. High confidence does not remove the interpretive leap.
- `LEAF_VIOLATION` -- always `isCandidate: true, requiresManualReview: true`
- `EXTRACTION_CANDIDATE` -- depends on threshold interpretation
- Any assessment where `isCandidate: true` or `requiresManualReview: true`

**Rule:** when in doubt, do not tag `[AST-confirmed]`. The tag exists to
bump severity of findings the tool can prove structurally. Interpreter
classifications are evidence, not proof.

### Severity bumping

`[AST-confirmed]` findings get +1 concern-level bump:

- Bug/Low -> Bug/Medium
- Architecture/Medium -> Architecture/High

### Manual review section

All assessments with `requiresManualReview: true` go into a separate
"Manual Review Required" section of the report. These are candidates
that need human judgment:

- `LEAF_VIOLATION` candidates (ownership interpreter)
- `UNKNOWN_HOOK` assessments (hook interpreter)
- `DERIVED_STATE` candidates with `isCandidate: true` (effect interpreter)
- `DELETE_CANDIDATE` test files (test quality interpreter)

<!-- role: workflow -->

## Step 1: Inventory all files

Glob for all .ts/.tsx files in the target directory and its subdirectories. For each
file, record:

- File path
- What it exports (from `EXPORT_DECLARATION` observations in ast-imports output)
- What it imports (from `STATIC_IMPORT` observations in ast-imports output)

<!-- role: workflow -->

## Step 2: Map the dependency graph

Use observations from ast-imports to build the dependency graph. Identify:

- Which files import context hooks (from `HOOK_IMPORT` observations where
  `importSource` matches `providers/context/`)
- Which files import service hooks (from `HOOK_IMPORT` observations where
  `importSource` matches `services/hooks/`)
- Which files import from other feature domains (cross-domain coupling)
- Which files call useRouter/usePathname (from `HOOK_CALL` observations)
- Which files access storage (from `DIRECT_STORAGE_CALL` / `TYPED_STORAGE_CALL` observations)
- Which files call toast functions (from `TOAST_CALL` observations)
- Circular dependencies (from `CIRCULAR_DEPENDENCY` observations/assessments)

<!-- role: detect -->

## Step 3: Classify every component

Use assessments from `ast-interpret-ownership` for component classification:

| Assessment Kind  | Meaning                                                          | Report as      |
| ---------------- | ---------------------------------------------------------------- | -------------- |
| `CONTAINER`      | Orchestrates data-fetching and hook calls for a route or section | Container      |
| `DDAU_COMPONENT` | Receives all data via props, fires all actions via callbacks     | DDAU           |
| `LAYOUT_SHELL`   | Layout, auth guard, error boundary, or similar app-level concern | Infrastructure |
| `LEAF_VIOLATION` | Non-container with forbidden hook calls (needs manual review)    | Self-contained |
| `AMBIGUOUS`      | Cannot determine classification automatically                    | Manual review  |

**Inner containers:** If a component is assessed as `CONTAINER` but the
rationale mentions "receives context/navigation from parent" or "calls
service hooks for data that depends on local selection state," classify
as Inner container.

**Providers:** Not detected by ownership interpreter. Look for
`ComponentObservation` where the return contains `Provider` or
`createContext` usage.

<!-- role: detect -->

## Step 3b: Dead code detection

Use assessments from `ast-interpret-dead-code` to identify dead code:

| Assessment Kind        | Meaning                                    | Action           |
| ---------------------- | ------------------------------------------ | ---------------- |
| `DEAD_EXPORT`          | Export with 0 consumers, high confidence   | Delete           |
| `POSSIBLY_DEAD_EXPORT` | 0 static consumers but may be dynamic      | Manual review    |
| `DEAD_BARREL_REEXPORT` | Barrel re-exports something nobody imports | Delete re-export |
| `CIRCULAR_DEPENDENCY`  | Part of a circular import chain            | Refactor         |

If a component/hook has a `DEAD_EXPORT` assessment, classify as **DEAD_CODE**
instead of auditing for violations. Dead code should be deleted, not refactored.
This saves significant effort -- a surprising fraction of "violations" turn out
to be unreachable code.

**Orphaned test files.** Use `ORPHANED_TEST` assessments from
`ast-interpret-test-quality` (if test files are in scope). These indicate test
files whose subject no longer exists. Orphaned tests should be deleted.

**Co-located container/leaf detection.** If ast-interpret-ownership emits
both a `CONTAINER` assessment and a `DDAU_COMPONENT` assessment for the same
file, flag it as a candidate for file splitting: the container should move to
`containers/` and the leaf should be exported from the original file. Common
pattern: `Foo` (container) wrapping `FooContent` (leaf) in the same file.

<!-- role: detect -->

## Step 3c: Debug artifact detection

Use observations from ast-side-effects to detect development leftovers:

- `CONSOLE_CALL` observations where `evidence.method` is `log`, `debug`, or
  `info` (not `error` or `warn`, which may be intentional)

For these items, manually scan:

- Commented-out code blocks longer than 3 lines
- `// TODO` or `// HACK` or `// FIXME` markers
- Disabled ESLint rules (`eslint-disable`) without an explanatory comment

Record these in the report under a "Debug artifacts" section.

<!-- role: detect -->

## Step 3d: Type audit

Use observations from ast-type-safety for type violations. Map observation kinds
to report categories:

| Observation Kind          | Report Category                     | `[AST-confirmed]`?  |
| ------------------------- | ----------------------------------- | ------------------- |
| `AS_ANY_CAST`             | Explicit any                        | Yes                 |
| `AS_UNKNOWN_AS_CAST`      | Double casts (as unknown as X)      | Yes                 |
| `NON_NULL_ASSERTION`      | Non-null assertions                 | Yes (if no guard)   |
| `EXPLICIT_ANY_ANNOTATION` | Explicit any                        | Yes                 |
| `CATCH_ERROR_ANY`         | catch (error: any)                  | Yes                 |
| `TS_DIRECTIVE`            | @ts-expect-error without comment    | Yes (if no comment) |
| `TRUST_BOUNDARY_CAST`     | Trust boundaries without validation | Yes                 |

For observations with `evidence.hasGuard: true`, do NOT flag as violations.
The guard makes the non-null assertion safe.

For `TS_DIRECTIVE` observations, check `evidence.hasExplanation`. If true, do
not flag.

These items require manual scanning (not covered by ast-type-safety):

- Duplicate type/interface definitions (vs `src/shared/types/`)
- Bare primitives that should be branded types
- Enums that should be `as const` objects
- Inline type annotations appearing in 2+ files
- Unsound type guard functions

Record all findings in the report under a "Type violations" section.

<!-- role: detect -->

## Step 4: Classify every useEffect

The interpreter `ast-interpret-effects` (run in Step 0) emits assessments for each
useEffect. Use these assessments directly:

| Assessment Kind           | What it means                                       | Action                                                          |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `DERIVED_STATE`           | Effect mirrors fetched/prop/context data into state | Flag as violation. Should use useQuery or useMemo.              |
| `EVENT_HANDLER_DISGUISED` | Effect wraps what should be an event handler        | Flag as violation. Move to onClick/onSubmit handler.            |
| `TIMER_RACE`              | Timer + setState without cleanup                    | Flag as bug candidate if no cleanup. Review if cleanup present. |
| `DOM_EFFECT`              | Ref or DOM API access                               | Likely legitimate. Verify cleanup present.                      |
| `EXTERNAL_SUBSCRIPTION`   | Cleanup-based subscription                          | Likely legitimate. Verify cleanup completeness.                 |
| `NECESSARY`               | No suspicious patterns                              | Low priority. Skip unless reviewing for deletion.               |

**Report policy for useEffect assessments:**

- `confidence: high` + `isCandidate: false` -> report as `[AST-confirmed]` finding
- `confidence: high` + `isCandidate: true` -> report as finding, flag for manual review
- `confidence: medium` -> report as finding, no `[AST-confirmed]`
- `confidence: low` -> report only if `isCandidate: true`
- `requiresManualReview: true` -> always include in Manual Review Required section

Include the interpreter's `rationale` in the report. Do not reclassify effects based
on your own reading -- use the assessment as-is and note any disagreement in the
review section.

**Observations that inform effect assessments:** The underlying observations
(`EFFECT_STATE_SETTER_CALL`, `EFFECT_PROP_READ`, `EFFECT_TIMER_CALL`, etc.) appear
in `effectObservations` from ast-react-inventory. These feed the interpreter. You
can reference them in the useEffect inventory table for additional context.

<!-- role: detect -->

## Step 4b: Detect ghost state

Ghost state is a boolean (like `isCollapsed`, `isDetailCollapsed`, `isUserCollapsed`)
that is paired with a selection state (like `selectedUser`, `selectedDetail`). When a
useEffect nulls the selection (e.g., because the selected item was filtered out), the
boolean may remain `true`, creating a hidden inconsistency.

For each boolean state variable:

- Identify whether it is paired with a selection (set together, cleared together)
- Check whether the selection can be nulled independently (by a useEffect or by the
  `effectiveX` useMemo pattern)
- If yes, check whether every JSX path that reads the boolean also guards on the
  selection being non-null (e.g., `isUserCollapsed && effectiveSelectedUser`)
- If any JSX path reads the boolean WITHOUT guarding on the selection, flag it as
  **GHOST_STATE** -- the UI will show collapsed/expanded state for a selection that
  no longer exists

Ghost state is invisible when JSX guards are correct, but becomes a latent bug if
someone later removes the guard. Flag it in the report even when currently guarded.

<!-- role: detect -->

## Step 4c: Detect timer race conditions

Scan for `setTimeout` and `setInterval` inside useEffect callbacks (or inside
functions called by useEffect callbacks). These are code smells because:

- **setState after timeout**: The component may have unmounted or the triggering
  condition may have changed before the timer fires. Even with cleanup, the
  pattern is fragile and hard to reason about.
- **Missing cleanup**: A setTimeout/setInterval without a corresponding
  `clearTimeout`/`clearInterval` in the useEffect cleanup function is a leak.
- **Deferred state sync**: Using setTimeout to "wait for React to settle" before
  reading or writing state is almost always papering over a missing dependency
  or a wrong data flow. The timer duration is arbitrary and environment-dependent.

For each timer found:

- Check whether the cleanup function clears it
- Check whether the callback calls setState
- Check whether the same logic could be an event handler, a CSS transition,
  or a requestAnimationFrame (for layout reads)

Classify as **TIMER_RACE** in the useEffect inventory. Flag in the report even
if cleanup is present -- the pattern itself is worth reviewing.

Note: `requestAnimationFrame` inside useEffect for one-time layout measurement
is a recognized pattern and less risky than setTimeout, but still flag it if it
calls setState -- the same unmount race applies.

<!-- role: detect -->

## Step 4d: Audit JSX template complexity

Use observations from ast-jsx-analysis and assessments from ast-interpret-template.

**Observations** (from ast-jsx-analysis) map to template issues:

| Observation Kind      | What it detects                             | `[AST-confirmed]`? |
| --------------------- | ------------------------------------------- | ------------------ |
| `JSX_TERNARY_CHAIN`   | Multi-way branch in JSX (depth in evidence) | Yes                |
| `JSX_GUARD_CHAIN`     | 3+ conditions in `&&` chain                 | Yes                |
| `JSX_TRANSFORM_CHAIN` | Data transformation in return               | Yes                |
| `JSX_IIFE`            | Immediately-invoked function in return      | Yes                |
| `JSX_INLINE_HANDLER`  | Multi-statement inline handler              | Yes (if 2+ stmts)  |
| `JSX_RETURN_BLOCK`    | Return statement metadata (line count)      | Yes (if > 100)     |

**Assessments** (from ast-interpret-template) aggregate observations:

| Assessment Kind        | What it means                                 | Action                         |
| ---------------------- | --------------------------------------------- | ------------------------------ |
| `EXTRACTION_CANDIDATE` | Pattern should become a shared component      | Flag for component extraction  |
| `COMPLEXITY_HOTSPOT`   | Return block is too complex, needs flattening | Flag for /flatten-jsx-template |

Report assessments directly. Include the `rationale` field which explains why
the assessment was made.

**Repeated rendering patterns:** Not detected automatically. Manually scan for
identical or near-identical JSX patterns appearing 3+ times across files:

- Percentage-width bars (`style={{ width: \`${pct}%\` }}`)
- Loading/empty/error cascading ternaries
- KPI display with nested loading ternary
- Multi-way type/mode/status switches using the same discriminant

For each repeated pattern, note: the pattern, the files where it appears, and
what shared component would replace it.

Record all findings in the report under a "Template complexity" section.

<!-- role: detect -->

## Step 5: Classify every hook call in leaves

Use assessments from ast-interpret-hooks to classify hook calls. For each
component that is NOT a container (check ownership assessments from Step 3):

| Assessment Kind       | What it means                          | Action                              |
| --------------------- | -------------------------------------- | ----------------------------------- |
| `LIKELY_SERVICE_HOOK` | Service hook in non-container          | DDAU violation, absorb in container |
| `LIKELY_CONTEXT_HOOK` | Context hook in non-container          | DDAU violation, absorb in container |
| `LIKELY_AMBIENT_HOOK` | Ambient hook (allowed in leaves)       | Do NOT flag                         |
| `LIKELY_STATE_HOOK`   | React builtin (useState, useRef, etc.) | Do NOT flag                         |
| `UNKNOWN_HOOK`        | Cannot classify automatically          | Manual review                       |

For each flagged hook call, record:

- The component and line number (from assessment's `subject`)
- The hook being called (from assessment's `subject.symbol`)
- Which fields/values are destructured (from underlying `HOOK_CALL` observation)
- Which container should absorb this call
- What props the component should receive instead

**MAY-remain hooks:** The `LIKELY_AMBIENT_HOOK` assessment covers hooks in the
ambient leaf hooks list: useBreakpoints, useWindowSize, useDropdownScrollHandler,
useClickAway, useScrollCallback, usePagination, useSorting, useTheme, useTranslation,
and any `useXxxScope()` hook exported by a scoped context. Do NOT flag these.

<!-- role: detect -->

## Step 6: Check storage, toast, cross-domain coupling, and URL state

### URL state

- Use `HOOK_CALL` observations where `hookName` is `useRouter`, `useSearchParams`,
  `useQueryState`, or `useQueryStates` to find URL param readers
- Flag any component assessed as `DDAU_COMPONENT` (not container) that has such
  hooks -- this is a state-store access violation
- List every piece of state currently in context or localStorage that is
  URL-worthy (affects what the user sees on reload: filters, sort, tab,
  date range, pagination, selected team/user)
- For each URL-worthy field: where does it currently live, and which container
  should own the `useQueryState` call after refactor?

### Storage

Use observations from ast-storage-access:

| Observation Kind         | What it means                          | `[AST-confirmed]` violation? |
| ------------------------ | -------------------------------------- | ---------------------------- |
| `DIRECT_STORAGE_CALL`    | Raw localStorage/sessionStorage access | Yes -- must use typedStorage |
| `TYPED_STORAGE_CALL`     | Compliant typedStorage usage           | No                           |
| `JSON_PARSE_CALL`        | JSON.parse without Zod guard           | Yes                          |
| `JSON_PARSE_ZOD_GUARDED` | JSON.parse with Zod validation         | No                           |

For each storage access:

- Identify who reads/writes each key
- Flag any key with multiple independent writers
- Flag any component assessed as `DDAU_COMPONENT` that has storage observations
- Flag any key that stores URL-worthy state (should move to URL params)

### Toasts

Use `TOAST_CALL` observations from ast-side-effects:

- List every toast call site in this feature
- Check `evidence.containingFunction` -- flag if in a service hook or utility
- Note which container onSuccess/onError callback should own each toast

### Cross-domain query keys

Use `QUERY_INVALIDATION` observations from ast-data-layer:

- List every import of query keys from outside this feature's domain
  (from `STATIC_IMPORT` observations targeting another domain's keys file)
- For each: what mutation triggers it, and which container should own it instead

<!-- role: detect -->

## Step 6b: Test coverage assessment

For test files in scope, use assessments from `ast-interpret-test-quality`:

| Assessment Kind           | What it means                                     |
| ------------------------- | ------------------------------------------------- |
| `ORPHANED_TEST`           | Subject file no longer exists -- delete test      |
| `DELETE_CANDIDATE`        | High internal-mock count, low quality -- review   |
| `MOCK_INTERNAL_VIOLATION` | Mocks own hook/component/utility                  |
| `MOCK_BOUNDARY_COMPLIANT` | Mock targets only external boundaries             |
| `CLEANUP_INCOMPLETE`      | Missing afterEach/restore patterns                |
| `DATA_SOURCING_VIOLATION` | Shared mutable constants or `as any` in test data |

For each production file (non-test, non-type) in the feature:

1. **Check for a dedicated spec.** Look for `<basename>.spec.ts`, `<basename>.spec.tsx`,
   `<basename>.test.ts`, `<basename>.test.tsx` in the same directory and in sibling
   `__tests__/` or `tests/` directories.

2. **Check for indirect coverage.** Grep for the file's exports across all spec files.
   If another test exercises this file's functions, it has indirect coverage.

3. **Classify:**

| Level                 | Criteria                                         |
| --------------------- | ------------------------------------------------ |
| **TESTED**            | Dedicated spec exists                            |
| **INDIRECTLY_TESTED** | No dedicated spec, but exercised by other specs  |
| **UNTESTED**          | No spec and no other spec imports from this file |

Record in the file inventory table. Flag UNTESTED files in the migration checklist
with a warning: "No test coverage -- write tests before refactoring."

For UNTESTED files, estimate refactor risk using complexity observations:

- HIGH: container or hook with `FUNCTION_COMPLEXITY` observation showing
  cyclomaticComplexity > 5 and zero coverage
- MEDIUM: component with multiple interactive behaviors and zero coverage
- LOW: simple presentational component or type file

<!-- role: detect -->

## Step 7: Identify the DDAU boundary

Use ownership assessments to determine container boundaries:

- Components with `CONTAINER` assessment are the orchestration boundaries
- One container per orchestration boundary (typically per route, but also per
  non-route entry point like a modal or embedded panel)
- `LAYOUT_SHELL` assessments indicate components rendered at layout level
- `LEAF_VIOLATION` assessments indicate components 2-3 levels deep calling hooks
  (deeply nested data-fetching)

<!-- role: emit -->

## Step 8: Produce the migration report

Output a structured report. Use assessment kinds in tables where appropriate:

```
## Feature Audit: <FeatureName>

### File inventory
| File | Type | Ownership Assessment | Test coverage |
|------|------|----------------------|---------------|
| ...  | ...  | CONTAINER / DDAU_COMPONENT / LEAF_VIOLATION / LAYOUT_SHELL | TESTED / INDIRECTLY_TESTED / UNTESTED |

### Scorecard (by ownership assessment)
| Assessment Kind  | Count | % |
|------------------|-------|---|
| DDAU_COMPONENT   | ...   |   |
| CONTAINER        | ...   |   |
| LAYOUT_SHELL     | ...   |   |
| LEAF_VIOLATION   | ...   |   |
| AMBIGUOUS        | ...   |   |

### useEffect inventory (from ast-interpret-effects)
| File:Line | Assessment Kind | Confidence | Action |
|-----------|-----------------|------------|--------|
| ...       | DERIVED_STATE   | high       | useMemo |
| ...       | TIMER_RACE      | medium     | review cleanup |

### useEffect summary
| Assessment Kind           | Count | Typical Action |
|---------------------------|-------|----------------|
| DERIVED_STATE             | ...   | useMemo or delete |
| EVENT_HANDLER_DISGUISED   | ...   | move to handler |
| TIMER_RACE                | ...   | review cleanup |
| DOM_EFFECT                | ...   | keep (verify cleanup) |
| EXTERNAL_SUBSCRIPTION     | ...   | keep (verify cleanup) |
| NECESSARY                 | ...   | keep |

### Dead code (from ast-interpret-dead-code)
| File | Export | Assessment Kind | Confidence |
|------|--------|-----------------|------------|
| ...  | ...    | DEAD_EXPORT / POSSIBLY_DEAD_EXPORT | high / medium |

### Ghost state
| File | Boolean state | Paired selection | Guarded in JSX? |
|------|--------------|-----------------|----------------|
| ...  | isCollapsed  | selectedUser    | yes / NO       |

### Timer race conditions (from TIMER_RACE assessments)
| File:Line | Has cleanup? | Confidence | Rationale |
|-----------|-------------|------------|-----------|
| ...       | yes / no    | high       | ...       |

### Debug artifacts (from CONSOLE_CALL observations)
| File:Line | Observation Kind | Evidence |
|-----------|-----------------|----------|
| ...       | CONSOLE_CALL    | method: log |
| ...       | (manual)        | commented-out block |

### Type violations (from ast-type-safety observations)
| File:Line | Observation Kind | Evidence | [AST-confirmed]? |
|-----------|-----------------|----------|------------------|
| ...       | AS_ANY_CAST     | text: "x as any" | Yes |
| ...       | NON_NULL_ASSERTION | hasGuard: false | Yes |
| ...       | TRUST_BOUNDARY_CAST | source: JSON.parse | Yes |

### Type violations summary
| Observation Kind | Count |
|------------------|-------|
| AS_ANY_CAST | ... |
| AS_UNKNOWN_AS_CAST | ... |
| NON_NULL_ASSERTION (unguarded) | ... |
| EXPLICIT_ANY_ANNOTATION | ... |
| CATCH_ERROR_ANY | ... |
| TS_DIRECTIVE (no comment) | ... |
| TRUST_BOUNDARY_CAST | ... |

### Template complexity (from ast-jsx-analysis + ast-interpret-template)
| File:Line | Observation/Assessment | Evidence/Rationale |
|-----------|------------------------|-------------------|
| ...       | JSX_TERNARY_CHAIN      | depth: 3 |
| ...       | EXTRACTION_CANDIDATE   | (rationale from assessment) |
| ...       | COMPLEXITY_HOTSPOT     | (rationale from assessment) |

### Template complexity summary
| Observation Kind | Count |
|------------------|-------|
| JSX_TERNARY_CHAIN (depth >= 2) | ... |
| JSX_GUARD_CHAIN | ... |
| JSX_TRANSFORM_CHAIN | ... |
| JSX_IIFE | ... |
| JSX_INLINE_HANDLER (2+ stmts) | ... |
| JSX_RETURN_BLOCK (> 100 lines) | ... |

### Repeated rendering patterns (candidates for shared components)
| Pattern | Files | Suggested component |
|---------|-------|-------------------|
| Percentage-width bar | SystemsTab, ActivitiesTable, ... | `<ProgressBar>` |
| Loading/empty/error cascade | NodeDetailsPanel, RelaySystemAggregate, ... | `<AsyncContent>` |
| ... | ... | ... |

### Hook calls in leaves (from ast-interpret-hooks assessments)
| Component | Hook | Assessment Kind | Fields used | Target container | Becomes props |
|-----------|------|-----------------|-------------|-----------------|---------------|
| ...       | ...  | LIKELY_SERVICE_HOOK | data, isLoading | ... | ... |
| ...       | ...  | LIKELY_CONTEXT_HOOK | user | ... | user |

### Storage access (from ast-storage-access observations)
| File:Line | Observation Kind | Evidence | [AST-confirmed] violation? |
|-----------|-----------------|----------|---------------------------|
| ...       | DIRECT_STORAGE_CALL | storageType: localStorage | Yes |
| ...       | TYPED_STORAGE_CALL | helperName: readStorage | No |

### Toast call sites (from TOAST_CALL observations)
| File:Line | Containing Function | Should move to |
|-----------|---------------------|---------------|
| ...       | useUpdateUser       | container onSuccess |

### Cross-domain coupling
| File | Imports keys from | Reason | Should move to |
|------|-------------------|--------|---------------|
| ...  | ...               | ...    | ...           |

### Dependency graph issues (from ast-imports + ast-interpret-dead-code)
- Circular dependencies: <list CIRCULAR_DEPENDENCY assessments or "none">
- Deepest fetch depth: <N levels>

### Test coverage summary
| Level | Count | Files |
|-------|-------|-------|
| TESTED | <N> | ... |
| INDIRECTLY_TESTED | <N> | ... |
| UNTESTED | <N> | ... |

### Manual Review Required

Items where assessments have `requiresManualReview: true`:

| Source | File:Line | Assessment/Observation | Rationale |
|--------|-----------|------------------------|-----------|
| ownership | ... | LEAF_VIOLATION | (from assessment.rationale) |
| hooks | ... | UNKNOWN_HOOK | could not classify |
| effects | ... | DERIVED_STATE (candidate) | (from assessment.rationale) |
| test | ... | DELETE_CANDIDATE | high internal mock count |

### Migration checklist (in order)

For each item, if the target file is UNTESTED, prepend: **[UNTESTED -- write tests first]**

1. [ ] Delete dead code (DEAD_EXPORT assessments with high confidence)
       Files: <list>
2. [ ] Extract standalone hooks for <domain> (Phase 0)
       Files: <list>
3. [ ] Create <ContainerName> container (Phase 1)
       Absorbs: <list of LIKELY_SERVICE_HOOK / LIKELY_CONTEXT_HOOK assessments>
4. [ ] Convert <ComponentName> to DDAU (Phase 2)
       Remove: <hooks with LEAF_VIOLATION assessment>
       Add props: <list>
5. [ ] Flatten JSX templates (COMPLEXITY_HOTSPOT assessments)
       Files: <list>
6. [ ] Extract shared components (EXTRACTION_CANDIDATE assessments)
       Patterns: <list>
7. [ ] ...

### Estimated scope
- Components to convert (LEAF_VIOLATION count): <N>
- useEffects to eliminate (DERIVED_STATE + EVENT_HANDLER_DISGUISED count): <N>
- Hook call sites to absorb (LIKELY_SERVICE_HOOK + LIKELY_CONTEXT_HOOK in non-containers): <N>
- Templates to flatten (COMPLEXITY_HOTSPOT count): <N>
- Production files with no test coverage: <N>
```

<!-- role: emit -->

## Step 9: Emit structured findings

Write a `.findings.yaml` file next to the raw report. The filename pattern is the same as the raw report but with `.findings.yaml` extension (e.g., `react-feature--chat--raw.findings.yaml`).

### FindingsFile schema

The YAML must validate against the FindingsFile Zod schema in `scripts/audit/schema.ts`.

```yaml
meta:
  auditTimestamp: "<timestamp from artifacts directory name>"
  auditType: "react-feature"
  target: "<target directory>"
  agentId: "<agent ID from orchestrator>"
  track: "<fe|bff|cross-cutting>"
  filesAudited: <number>
  date: "<YYYY-MM-DD>"

headline:
  ddauViolations: <number>
  useEffects: <number>
  eliminableEffects: <number>
  rawLocalStorage: <number>
  nonNullAssertions: <number>
  trustBoundaryGaps: <number>
  crossDomainCoupling: <number>
  deadExports: <number>
  deadFiles: <number>

findings:
  - contentHash: "<computed by finding-id.ts or manually>"
    file: "<file path>"
    line: <line number>
    kind: "<from canonical vocabulary>"
    priority: "<P1-P5>"
    category: "<bug|dead-code|type-safety|architecture|trust-boundary|test-gap|performance|style>"
    track: "<fe|bff|cross-cutting>"
    description: "<finding description>"
    fix: "<fix action>"
    astConfirmed: <true|false>
    astTool: "<tool name if AST-confirmed>"
    requiresManualReview: <true|false>
```

### Headline fields for react-feature

| Field | Type | Description |
|-------|------|-------------|
| ddauViolations | number | Count of DDAU boundary violations (service/context hooks in non-containers) |
| useEffects | number | Total useEffect count in the feature |
| eliminableEffects | number | Count of useEffects classified as DERIVED_STATE or EVENT_HANDLER_DISGUISED |
| rawLocalStorage | number | Count of DIRECT_STORAGE_CALL observations |
| nonNullAssertions | number | Count of unguarded NON_NULL_ASSERTION observations |
| trustBoundaryGaps | number | Count of TRUST_BOUNDARY_CAST observations |
| crossDomainCoupling | number | Count of cross-domain import violations |
| deadExports | number | Count of DEAD_EXPORT assessments with high confidence |
| deadFiles | number | Count of files where all exports are dead |

### Canonical kind vocabulary

| kind | Source | Maps from |
|------|--------|-----------|
| dead-export | ast-interpret-dead-code | DEAD_EXPORT assessment |
| dead-file | ast-interpret-dead-code | All exports dead in a file |
| eliminable-effect | ast-interpret-effects | DERIVED_STATE, EVENT_HANDLER_DISGUISED assessments |
| ddau-violation | ast-interpret-hooks, ast-interpret-ownership | LIKELY_SERVICE_HOOK, LIKELY_CONTEXT_HOOK in non-container; LEAF_VIOLATION |
| jsx-complexity | ast-jsx-analysis, ast-interpret-template | COMPLEXITY_HOTSPOT, JSX_RETURN_BLOCK > 100 lines |
| as-any | ast-type-safety | AS_ANY_CAST, EXPLICIT_ANY_ANNOTATION observations |
| non-null-assertion | ast-type-safety | NON_NULL_ASSERTION observation (unguarded) |
| trust-boundary-gap | ast-type-safety | TRUST_BOUNDARY_CAST observation |
| raw-storage | ast-storage-access | DIRECT_STORAGE_CALL observation |
| cross-domain-coupling | ast-imports | Cross-domain import violations |
| console-leak | ast-side-effects | CONSOLE_CALL (log/debug/info) observation |
| test-gap | Manual / ast-interpret-test-quality | UNTESTED file classification |
| architecture-smell | Manual | Structural issues not covered by other kinds |
| bug | Manual / ast-interpret-effects | TIMER_RACE, ghost state, runtime errors |
| style | Manual | Code style issues, debug artifacts |

### Priority assignment

PRIORITY ASSIGNMENT: Use PRIORITY_RULES from ast-config.ts to assign
priority. Do NOT assign priority based on subjective judgment. If no
rule matches the finding's kind, assign P4 and add a GAP.md entry
explaining the unmatched pattern.

### Rules

1. Every finding from the Migration Checklist / Findings section MUST appear in the YAML.
2. Assign `priority` (P1-P5) using PRIORITY_RULES from ast-config.ts. Do NOT assign `concern` -- it is assigned during the triage pass after all agents complete.
3. `stableId` should be omitted or set to `"(new)"` -- it is assigned by the pipeline.
4. `contentHash` can be computed using `npx tsx scripts/audit/finding-id.ts` or by following the algorithm: sha256(file + ':' + line + ':' + kind + ':' + sha256(description)), truncated to 8 hex.
5. Use the canonical kind vocabulary above. If validation fails on `kind`, pick the closest canonical value and describe the specifics in `description`.
6. For multi-file findings, set `file` to the primary representative file and list all affected files in the `files` array.

### Validation

After writing the YAML file, validate it:

```bash
npx tsx scripts/audit/yaml-io.ts --validate <findings-file.yaml>
```

If validation fails, fix the YAML before proceeding.

<!-- role: workflow -->

## Interpreter Calibration Gate

If any interpreter classification is wrong and the misclassification
affected a decision in this audit:

1. Confirm you investigated and the interpreter is genuinely wrong
   (not just an ambiguous case).
2. Run `/create-feedback-fixture --tool <name> --file <path> --expected <correct-kind> --actual <wrong-kind>`.
3. Note the fixture in the summary output.

Do NOT create a fixture if you are unsure or the error did not affect
a decision. See the skill for the full pre-conditions.

<!-- role: reference -->
## Related skills

- `/audit-display-conventions` -- for display convention violations (number formatting, null/empty handling, percentage precision). Run on the same target directory after this audit.
- `/audit-module` -- for non-React modules (utilities, transformers, validators).
- `/audit-api-handler` -- for Next.js API route handlers.
