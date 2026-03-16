---
name: audit-module
description: Audit a non-React TypeScript module against the G1-G10 general code principles. Scores each principle, classifies the module, and produces a prioritized violation report.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/module.ts>
---

Audit the TypeScript module at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a complete violation report.

## Step 0: Run AST analysis tools and interpreters

```bash
# --- Observation-producing tools ---

# Dependency graph (emits STATIC_IMPORT, DEAD_EXPORT_CANDIDATE observations)
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty

# Complexity (emits FUNCTION_COMPLEXITY observations)
npx tsx scripts/AST/ast-complexity.ts $ARGUMENTS --pretty

# Type safety (emits AS_ANY_CAST, NON_NULL_ASSERTION, TRUST_BOUNDARY_CAST, EXPLICIT_ANY_ANNOTATION observations)
npx tsx scripts/AST/ast-type-safety.ts $ARGUMENTS --pretty

# Side effects (emits CONSOLE_CALL, TOAST_CALL, TIMER_CALL, POSTHOG_CALL observations)
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty

# Environment access (emits PROCESS_ENV_ACCESS, ENV_WRAPPER_ACCESS, ENV_WRAPPER_IMPORT observations)
npx tsx scripts/AST/ast-env-access.ts $ARGUMENTS --pretty

# Storage access (emits DIRECT_STORAGE_CALL, TYPED_STORAGE_CALL, JSON_PARSE_CALL observations)
npx tsx scripts/AST/ast-storage-access.ts $ARGUMENTS --pretty

# --- Interpreters ---

# Dead code detection (emits DEAD_EXPORT, POSSIBLY_DEAD_EXPORT, CIRCULAR_DEPENDENCY assessments)
npx tsx scripts/AST/ast-interpret-dead-code.ts $ARGUMENTS --pretty
```

### Using observations and assessments

**Observations** are structural facts with no classification (line X has
an `as any` cast, line Y has complexity 12). They populate inventory tables
and evidence columns.

**Assessments** are interpretations over observations with confidence
levels and rationale. Use `DEAD_EXPORT` assessments for G7 (narrow exports).

### Tool-to-principle mapping

| Principle               | Tool                                | Observations/Assessments used                                                     |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| G4 Low Complexity       | ast-complexity                      | `FUNCTION_COMPLEXITY` observations with `cyclomaticComplexity` evidence           |
| G5 Parse Don't Validate | ast-type-safety, ast-storage-access | `TRUST_BOUNDARY_CAST`, `JSON_PARSE_CALL` observations                             |
| G6 Pure Core            | ast-side-effects                    | `CONSOLE_CALL`, `TOAST_CALL`, `TIMER_CALL`, `POSTHOG_CALL` observations           |
| G7 Narrow Exports       | ast-interpret-dead-code             | `DEAD_EXPORT`, `POSSIBLY_DEAD_EXPORT` assessments                                 |
| G8 Types as Docs        | ast-type-safety                     | `AS_ANY_CAST`, `EXPLICIT_ANY_ANNOTATION` observations                             |
| G2/G5 Env access        | ast-env-access                      | `PROCESS_ENV_ACCESS` observations (violations), `ENV_WRAPPER_ACCESS` (compliant)  |
| G5/G6 Storage           | ast-storage-access                  | `DIRECT_STORAGE_CALL` observations (violations), `TYPED_STORAGE_CALL` (compliant) |

## Report Policy

### AST-confirmed tagging

An observation or assessment qualifies for `[AST-confirmed]` tagging when ALL of:

- Based on structural fact (count, graph edge, syntax detection) with no interpretive leap
- For assessments: confidence is `high`, `isCandidate: false`, `requiresManualReview: false`

Examples that qualify:

- `FUNCTION_COMPLEXITY` observation with complexity > threshold -> `[AST-confirmed]`
- `AS_ANY_CAST` observation -> `[AST-confirmed]`
- `DEAD_EXPORT` assessment with high confidence -> `[AST-confirmed]`
- `DIRECT_STORAGE_CALL` observation -> `[AST-confirmed]`
- `PROCESS_ENV_ACCESS` observation -> `[AST-confirmed]`

Examples that do NOT qualify:

- `POSSIBLY_DEAD_EXPORT` -- low confidence, may have dynamic consumers
- Any assessment where `requiresManualReview: true`

### Severity bumping

`[AST-confirmed]` findings get +1 concern-level bump:

- Bug/Low -> Bug/Medium
- Architecture/Medium -> Architecture/High

### Complexity thresholds (report policy)

These thresholds are presentation decisions, not tool configuration:

- **FAIL**: cyclomatic complexity > 7 (from `FUNCTION_COMPLEXITY` observation)
- **WARN**: cyclomatic complexity > 5
- **Flag**: nesting depth > 2, line count > 40

### Type safety concentration (report policy)

Flag files for priority when `AS_ANY_CAST` observation count >= 5. This
threshold is a skill-level escalation rule, not an interpreter judgment.

## Step 1: Read the module and build context

Read the target file. Then:

- Read every file it imports (other local modules, types, utilities)
- Find all consumers of this module (use `ast-imports` STATIC_IMPORT observations from Step 0, or `sg -p 'exportedName' src/` for call-site matching)
- Identify whether this module is re-exported through a barrel file

Build a map of what this module depends on and what depends on it.

## Step 2: Classify the module

Determine what kind of module this is:

| Classification       | Criteria                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Utility**          | Pure functions that transform data. No I/O, no side effects. Lives in `src/shared/utils/` or a domain-specific utils directory.                                       |
| **Server processor** | Fetches, transforms, or aggregates data on the server side. Lives in `src/server/`. May mix I/O with transformation (a G6 concern).                                   |
| **API schema**       | Zod schemas defining request/response shapes for an API endpoint. Lives alongside API handlers.                                                                       |
| **API handler**      | Next.js API route handler. Parses requests, calls logic, returns responses. Lives in `src/pages/api/`. **Redirect to `audit-api-handler` for a more targeted audit.** |
| **Type module**      | Type definitions, branded types, or `as const` enums. Lives in `src/shared/types/`.                                                                                   |
| **Fixture**          | Test data builders. Lives in `src/fixtures/`.                                                                                                                         |
| **Script**           | One-off or periodic Node.js script. Lives in `scripts/`.                                                                                                              |
| **Constant**         | Static configuration values, lookup tables, test IDs. Lives in `src/constants/`.                                                                                      |
| **Infrastructure**   | fetchApi, storage wrappers, analytics, auth utilities. Lives in `src/shared/lib/`.                                                                                    |

## Step 3: Audit against G1-G10

For each principle, score the module: **PASS**, **WARN**, or **FAIL**. Record specific
line numbers and evidence for every WARN or FAIL.

### G1 -- Single Job Per Module

- Does the file do one thing?
- Can you name its job in under 8 words?
- Does it mix unrelated responsibilities (e.g., data fetching AND formatting AND error handling)?
- Are there functions in this file that belong in a different module?

FAIL if the module has 2+ distinct responsibilities that would make sense as separate files.
WARN if there is one function that feels out of place but the rest is cohesive.

### G2 -- Explicit Inputs, Explicit Outputs

For each exported function:

- Are all dependencies passed as parameters (not pulled from closures, globals, or env vars)?
- Is the return type explicitly annotated (or unambiguously inferrable)?
- Does any function mutate its arguments?
- Are there hidden dependencies on module-level mutable state?

FAIL if a function reads from ambient state without it being a parameter or documented
module-scope singleton.
WARN if return types are inferred but complex enough that explicit annotation would help.

### G3 -- Duplication Over Bad Abstraction

- Are there abstractions with boolean flags or mode parameters?
- Are there wrapper functions that add no value (call through to another function with
  the same signature)?
- Are there "helper" functions that are harder to understand than inlining would be?
- Is there a function that handles 2+ distinct cases via parameters when separate
  functions would be clearer?

FAIL if a function has a `mode`, `type`, or boolean flag parameter that fundamentally
changes its behavior (two functions masquerading as one).
WARN if a utility abstraction is used only once (premature extraction).

### G4 -- Low Cyclomatic Complexity

For each function, estimate cyclomatic complexity by counting:

- `if` / `else if` / `else` branches
- `switch` cases
- `&&` / `||` / `??` in conditionals
- `try` / `catch` blocks
- Ternary expressions
- Loop bodies with conditional breaks/continues

FAIL if any function exceeds complexity of roughly 7.
WARN if any function exceeds complexity of roughly 5.

Flag specific patterns:

- Nested if/else deeper than 2 levels
- Switch statements with 5+ cases (candidate for lookup map)
- Functions longer than 40 lines (complexity often correlates with length)

### G5 -- Parse, Don't Validate

Identify trust boundaries in the module:

- `JSON.parse` calls
- `fetch` response handling
- `localStorage`/`sessionStorage` reads
- Environment variable reads (`process.env`)
- CSV/external data parsing
- Supabase query results
- URL parameter reads

For each:

- Is the data validated/parsed into typed values at the boundary?
- Is there a Zod schema, type guard, or branded type constructor?
- Does downstream code re-check the same conditions (defensive programming)?

FAIL if external data is used with `as T` casts without runtime validation.
WARN if downstream code re-validates data that was already parsed at the boundary.

### G6 -- Pure Core, Effects at the Edge

Identify side effects in the module:

- Database/API calls (fetch, Supabase client calls)
- File system operations
- Console output (console.log/warn/error)
- Storage reads/writes
- Analytics calls (PostHog, etc.)
- Timer setup (setTimeout, setInterval)

For each side effect:

- Is it in a separate function from the data transformation logic?
- Could the transformation be extracted into a pure function that the side-effectful
  function calls?

FAIL if a function mixes data transformation with I/O in a way that makes the
transformation untestable without mocking.
WARN if side effects are isolated but could be further separated.

### G7 -- Narrow Exports

- List every export from the module.
- For each export, check if it has consumers (use `ast-interpret-dead-code` DEAD_EXPORT assessments from Step 0, or `ast-imports` DEAD_EXPORT_CANDIDATE observations).
- Are there internal helper functions that are exported unnecessarily?
- Does the module export types/values that no other module imports?

FAIL if the module exports functions/types with zero consumers outside the file.
WARN if the module exports more than consumers use (over-broad public API).

### G8 -- Types as Documentation

For each exported function:

- Does the type signature fully describe the contract?
- Are parameter types specific enough (branded types for IDs, literal types for
  discriminants, discriminated unions for variants)?
- Would someone need to read the function body to understand what it accepts/returns?
- Are there bare `string` or `number` parameters that should be branded?
- Are there `any` types?

FAIL if the module uses `any`, or if bare primitives are used where branded types exist.
WARN if type signatures are correct but could be more precise (e.g., `string` where a
union of literal types would be accurate).

### G9 -- Composition Over Configuration

- Are there functions with options objects that have mutually exclusive fields?
- Are there functions with boolean flags that create two distinct code paths?
- Could any configurable function be split into 2-3 simpler, focused functions?

FAIL if a function has 3+ configuration options that create meaningfully different
behavior paths.
WARN if a function has an options object with 2 fields where separate functions would
be clearer.

### G10 -- Fail Loud, Fail Fast

- Are there empty `catch` blocks?
- Are there `catch` blocks that log but do not rethrow or return an error type?
- Are there fallback defaults that silently hide invalid data (e.g., `?? []`, `?? 0`,
  `|| 'default'` at trust boundaries)?
- Does the module distinguish between "expected missing" (optional field) and
  "unexpectedly missing" (data corruption)?

FAIL if errors are silently swallowed (empty catch, catch-and-log-only at boundaries).
WARN if fallback defaults could mask bugs (but may be intentional for resilience).

## Step 4: Additional checks

### Test coverage assessment

Before recommending refactoring, assess the safety net:

1. **Co-located spec file.** Check for `<basename>.spec.ts`, `<basename>.spec.tsx`,
   `<basename>.test.ts`, `<basename>.test.tsx` in the same directory and in sibling
   `__tests__/` or `tests/` directories.

2. **Indirect coverage.** Grep for the module's exports across all spec files in the
   project. If another module's tests import from this file, it has indirect coverage.

3. **Classify coverage level:**

| Level                 | Criteria                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| **TESTED**            | A dedicated spec file exists for this module                                      |
| **INDIRECTLY_TESTED** | No dedicated spec, but other spec files import and exercise this module's exports |
| **UNTESTED**          | No spec file exists and no other spec imports from this module                    |

4. **If UNTESTED:** Add a prominent warning to every item in the refactor checklist:
   "WARNING: No test coverage -- write tests before refactoring." Flag refactor risk
   as HIGH for complex functions (complexity >5) and MEDIUM for simpler ones.

5. **If TESTED:** Check whether the spec is current -- does it import the module's
   current exports, or is it stale (references deleted functions or old signatures)?

Record in the report under a "Test coverage" section with the classification, the
spec file path (if any), and which exports are covered vs uncovered.

### Dead exports

Use `DEAD_EXPORT` and `POSSIBLY_DEAD_EXPORT` assessments from ast-interpret-dead-code.
`DEAD_EXPORT` assessments (high confidence, zero consumers) are dead code -- flag for
deletion, not refactoring. `POSSIBLY_DEAD_EXPORT` assessments need manual review (may
have dynamic consumers in API routes or scripts).

### Debug artifacts

Scan for:

- `console.log` / `console.debug` / `console.info` (not `console.error` or `console.warn`)
- Commented-out code blocks longer than 3 lines
- `// TODO` / `// HACK` / `// FIXME` markers
- `eslint-disable` without explanatory comment

### Type violations

Apply the same type audit as `audit-react-feature` Step 3d:

- Duplicate type definitions (exists in `src/shared/types/`)
- Bare primitives that should be branded
- `enum` that should be `as const`
- Explicit `any`
- Non-null assertions without guard
- `as unknown as X` double casts
- Trust boundaries without runtime validation
- `catch (error: any)` that should be `catch (error: unknown)`

## Step 5: Produce the report

Output a structured report:

```
## Module Audit: <filename>

### Classification
<utility | server processor | API schema | type module | fixture | script | constant | infrastructure>

### Job (G1)
<8-word-or-less description of what this module does>

### Consumers
<list of files that import from this module, or "none (dead module)">

### G1-G10 Scorecard

| Principle | Score | Evidence |
|-----------|-------|----------|
| G1 Single Job | PASS/WARN/FAIL | ... |
| G2 Explicit I/O | PASS/WARN/FAIL | ... |
| G3 No Bad Abstractions | PASS/WARN/FAIL | ... |
| G4 Low Complexity | PASS/WARN/FAIL | ... |
| G5 Parse Don't Validate | PASS/WARN/FAIL | ... |
| G6 Pure Core | PASS/WARN/FAIL | ... |
| G7 Narrow Exports | PASS/WARN/FAIL | ... |
| G8 Types as Docs | PASS/WARN/FAIL | ... |
| G9 Composition | PASS/WARN/FAIL | ... |
| G10 Fail Fast | PASS/WARN/FAIL | ... |

### Overall: <N>/10 PASS, <N> WARN, <N> FAIL

### Violations (prioritized by impact)

1. **[G<N> -- <Principle>]** <file>:<line>
   What: <description>
   Fix: <what to do>
   Impact: <what improves if fixed>

2. ...

### Complexity hotspots

| Function | Estimated complexity | Lines | Recommendation |
|----------|---------------------|-------|----------------|
| ... | ... | ... | ... |

### Dead exports
| Export | Type | Action |
|--------|------|--------|
| ... | function/type/const | Delete |

### Debug artifacts
| Line | Type | Content |
|------|------|---------|
| ... | console.log | ... |

### Type violations
| Line | Violation | Action |
|------|-----------|--------|
| ... | bare string for userId | Use UserId from brand.ts |

### Test coverage
| Level | Spec file | Covered exports | Uncovered exports |
|-------|-----------|-----------------|-------------------|
| TESTED/INDIRECTLY_TESTED/UNTESTED | <path or "none"> | ... | ... |

Refactor risk: HIGH/MEDIUM/LOW (based on coverage level + complexity)

### Refactor checklist (in order)

1. [ ] <highest-impact fix>
2. [ ] <next fix>
3. [ ] ...
```

## Interpreter Calibration Feedback

If `ast-interpret-dead-code` misclassifies during this audit (e.g.,
classifies a live export as DEAD_EXPORT, or misses a dead barrel
re-export), create a calibration fixture.

**Important:** Classify ALL dead exports and circular dependencies in the
fixture, not just the misclassified one. The calibration skill needs the
full picture to tune weights without regressing other classifications.

a. Create a directory:
`scripts/AST/ground-truth/fixtures/feedback-<date>-<brief-description>/`

b. Copy the misclassified source files into the directory. Dead code needs
an import graph -- include barrel files, consumer files, and any other
files needed to reproduce the graph structure. The interpreter runs on the
entire directory, not per-file.

c. Write a `manifest.json` with expected classifications for ALL dead
exports and circular dependencies in the fixture:

```json
{
  "tool": "dead-code",
  "created": "<ISO date>",
  "source": "feedback",
  "files": ["<filename1>", "<filename2>", "..."],
  "expectedClassifications": [
    {
      "file": "<filename>",
      "line": <line>,
      "symbol": "<exportName>",
      "expectedKind": "<correct-kind>",
      "notes": "<why the tool was wrong>"
    }
  ],
  "status": "pending"
}
```

d. Note in the summary: "Created calibration fixture:
feedback-<date>-<description>. Run /calibrate-ast-interpreter --tool
dead-code when 3+ pending fixtures accumulate."
