---
name: audit-module
description: Audit a non-React TypeScript module against the G1-G10 general code principles. Scores each principle, classifies the module, and produces a prioritized violation report.
context: fork
allowed-tools: Read, Grep, Glob
argument-hint: <path/to/module.ts>
---

Audit the TypeScript module at `$ARGUMENTS`. This is a read-only diagnostic -- do not
modify any files. Produce a complete violation report.

## Step 1: Read the module and build context

Read the target file. Then:
- Read every file it imports (other local modules, types, utilities)
- Find all consumers of this module (grep for its exports across the codebase)
- Identify whether this module is re-exported through a barrel file

Build a map of what this module depends on and what depends on it.

## Step 2: Classify the module

Determine what kind of module this is:

| Classification | Criteria |
|----------------|----------|
| **Utility** | Pure functions that transform data. No I/O, no side effects. Lives in `src/shared/utils/` or a domain-specific utils directory. |
| **Server processor** | Fetches, transforms, or aggregates data on the server side. Lives in `src/server/`. May mix I/O with transformation (a G6 concern). |
| **API schema** | Zod schemas defining request/response shapes for an API endpoint. Lives alongside API handlers. |
| **API handler** | Next.js API route handler. Parses requests, calls logic, returns responses. Lives in `src/pages/api/`. **Redirect to `audit-api-handler` for a more targeted audit.** |
| **Type module** | Type definitions, branded types, or `as const` enums. Lives in `src/shared/types/`. |
| **Fixture** | Test data builders. Lives in `src/fixtures/`. |
| **Script** | One-off or periodic Node.js script. Lives in `scripts/`. |
| **Constant** | Static configuration values, lookup tables, test IDs. Lives in `src/constants/`. |
| **Infrastructure** | fetchApi, storage wrappers, analytics, auth utilities. Lives in `src/shared/lib/`. |

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
- For each export, check if it has consumers (grep across the codebase).
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

### Dead exports

For each export, verify it has at least one consumer. Exports with zero consumers are
dead code. Flag for deletion, not refactoring.

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

### Refactor checklist (in order)

1. [ ] <highest-impact fix>
2. [ ] <next fix>
3. [ ] ...
```
