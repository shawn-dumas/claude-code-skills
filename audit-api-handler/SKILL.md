---
name: audit-api-handler
description: Audit a Next.js API route handler and its schema file against G1-G10 principles and API-specific structural rules. Checks schema completeness, handler structure, error handling, and type alignment.
context: fork
allowed-tools: Read, Grep, Glob
argument-hint: <path/to/api/handler.ts>
---

Audit the API handler at `$ARGUMENTS`. This is a read-only diagnostic -- do not modify
any files. Produce a complete violation report.

## Step 1: Locate handler and schema

Given the handler path (e.g., `src/pages/api/productivity.ts`), find:
- The handler file itself
- The companion schema file (e.g., `src/pages/api/productivity.schema.ts`)
- The mock handler (if it exists) in `src/pages/api/mock/`

If no schema file exists, that is itself a violation (G5 -- no parsing at the boundary).

Read all located files. Also read:
- Any shared types referenced by the schema or handler (from `src/shared/types/`)
- Any server-side processing modules the handler calls (from `src/server/`)
- The fetchApi configuration if the handler is called by a service hook (trace the
  consumer chain)

## Step 2: Audit the schema file

### Schema completeness

For each endpoint the handler serves (it may handle multiple HTTP methods):
- Is there a Zod schema for the request parameters (query params, body)?
- Is there a Zod schema for the success response?
- Is there a Zod schema for error responses?
- Does the schema cover all fields the handler actually reads from the request?
- Does the schema cover all fields the handler actually includes in the response?

FAIL if request or response schemas are missing entirely.
WARN if schemas exist but are incomplete (miss fields the handler uses).

### Schema alignment with shared types

- Do the schema's inferred types (`z.infer<typeof Schema>`) align with types in
  `src/shared/types/`?
- Are there duplicate type definitions (schema defines a shape that already exists
  in a shared type module)?
- Does the schema use branded types where appropriate (IDs, timestamps)?

FAIL if the schema duplicates a shared type without importing it.
WARN if branded types are missing but the field semantics match a branded type.

### Schema organization

- Is the schema co-located with the handler (same directory, `.schema.ts` suffix)?
- Does the schema export named schemas with clear names (e.g., `ProductivityResponseSchema`)?
- Are shared sub-schemas (pagination, error shape) imported from a common location
  rather than redefined per endpoint?

WARN if shared shapes are redefined locally.

## Step 3: Audit the handler structure

### G5 -- Parse at the boundary

The handler should parse/validate incoming data immediately:
- Request body parsed with the Zod schema before any processing
- Query parameters parsed/validated before use
- No `as T` casts on request data
- No `req.body.someField` access without prior validation

FAIL if the handler uses request data without validation.

### G6 -- Pure core, effects at the edge

The handler should follow a three-layer structure:

1. **Parse** -- validate request, extract typed inputs
2. **Process** -- call pure functions or server-side processors for business logic
3. **Respond** -- format and return the response

Check whether business logic is mixed into the handler body or properly separated:
- Is data transformation done in the handler or delegated to a server module?
- Could the processing logic be tested without mocking `req`/`res`?

FAIL if the handler contains substantial data transformation mixed with I/O.
WARN if minor inline computation exists but could be extracted.

### G10 -- Error handling

- Does the handler catch errors and return appropriate HTTP status codes?
- Are error responses structured (not bare strings)?
- Does the handler distinguish between client errors (4xx) and server errors (5xx)?
- Are there empty catch blocks or catch-and-log-only patterns?
- Does the handler validate that required env vars / config exist before proceeding?

FAIL if errors are silently swallowed or all errors return 500.
WARN if error responses are unstructured (bare strings instead of `{ error: ... }`).

### G2 -- Explicit inputs/outputs

- Does the handler's function signature clearly declare its dependencies?
- Are there ambient dependencies (database clients, env vars) pulled from module scope
  without documentation?
- Is the response type inferable from the handler code?

WARN if ambient dependencies exist but are documented at module top.
FAIL if ambient dependencies are scattered throughout the handler body.

## Step 4: Audit against remaining G principles

### G1 -- Single job

- Does the handler handle one endpoint or multiple?
- If multiple HTTP methods, does each method handler have a clear single responsibility?
- Are there utility functions in the handler file that belong elsewhere?

### G3 -- No bad abstractions

- Is there a generic handler wrapper or middleware that obscures what the handler does?
- Are there configuration objects that create mode-switching behavior?

### G4 -- Low complexity

- Estimate cyclomatic complexity of the main handler function.
- Flag nested conditionals, long switch statements, deeply nested try/catch.

### G7 -- Narrow exports

- The handler should export the default handler function and nothing else.
- Are there exported helpers that should be in a separate utility module?

### G8 -- Types as documentation

- Does the handler's type signature (via schema inference) tell the full contract?
- Could a consumer understand the API contract from types alone?

### G9 -- Composition over configuration

- Does the handler compose focused functions or does it have a monolithic body?

## Step 5: Cross-reference with consumers

Trace the handler's consumer chain:
- Which service hooks call this endpoint?
- Does the service hook's Zod schema match the handler's response schema?
- Are there mismatches between what the handler returns and what the client expects?

FAIL if the client-side schema and server-side schema define different shapes for the
same data.
WARN if schemas are compatible but defined independently (duplication risk).

## Step 6: Check the mock handler

If a mock handler exists in `src/pages/api/mock/`:
- Does it return data shaped like the real handler's response?
- Does it use fixture builders from `src/fixtures/`?
- Is the mock response validated against the same schema?

WARN if the mock handler returns hardcoded data instead of fixture builders.
WARN if the mock response shape has drifted from the real handler's schema.

## Step 7: Produce the report

Output a structured report:

```
## API Handler Audit: <handler path>

### Endpoint(s)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/productivity | ... |

### Files analyzed
- Handler: <path>
- Schema: <path> (or "MISSING")
- Mock: <path> (or "none")
- Server modules: <list>
- Consumer service hooks: <list>

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

### Schema audit

| Check | Status | Detail |
|-------|--------|--------|
| Request schema exists | YES/NO | ... |
| Response schema exists | YES/NO | ... |
| Error schema exists | YES/NO | ... |
| Schema covers all request fields | YES/NO | Missing: ... |
| Schema covers all response fields | YES/NO | Missing: ... |
| Schema aligns with shared types | YES/NO | Duplicates: ... |
| Branded types used for IDs | YES/NO | Missing: ... |

### Handler structure

| Layer | Present | Quality |
|-------|---------|---------|
| Parse (validate request) | YES/NO | ... |
| Process (business logic) | INLINE/DELEGATED | ... |
| Respond (format response) | YES/NO | ... |
| Error handling | STRUCTURED/BARE/MISSING | ... |

### Client-server schema alignment

| Service hook | Client schema | Server schema | Aligned? |
|-------------|---------------|---------------|----------|
| ... | ... | ... | YES/DRIFT/INDEPENDENT |

### Mock handler
| Check | Status |
|-------|--------|
| Uses fixture builders | YES/NO/N/A |
| Shape matches real schema | YES/DRIFTED/N/A |

### Violations (prioritized)

1. **[G<N> -- <Principle>]** <file>:<line>
   What: <description>
   Fix: <what to do>
   Impact: <what improves if fixed>

2. ...

### Refactor checklist (in order)

1. [ ] <highest-impact fix>
2. [ ] <next fix>
3. [ ] ...
```
