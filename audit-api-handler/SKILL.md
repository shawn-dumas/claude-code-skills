---
name: audit-api-handler
description: Audit a Next.js API route handler and its schema file against G1-G10 principles and API-specific structural rules. Checks schema completeness, handler structure, error handling, and type alignment.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/api/handler.ts>
---

Audit the API handler at `$ARGUMENTS`. This is a read-only diagnostic -- do not modify
any files. Produce a complete violation report.

## Step 0: Run AST analysis tools and interpreters

```bash
# --- Observation-producing tools ---

# Authorization patterns (emits RAW_ROLE_CHECK observations)
npx tsx scripts/AST/ast-authz-audit.ts $ARGUMENTS --pretty

# Dependency graph (emits STATIC_IMPORT, DEAD_EXPORT_CANDIDATE observations)
npx tsx scripts/AST/ast-imports.ts $ARGUMENTS --pretty

# Complexity (emits FUNCTION_COMPLEXITY observations)
npx tsx scripts/AST/ast-complexity.ts $ARGUMENTS --pretty

# Type safety (emits AS_ANY_CAST, TRUST_BOUNDARY_CAST, NON_NULL_ASSERTION observations)
npx tsx scripts/AST/ast-type-safety.ts $ARGUMENTS --pretty

# Environment access (emits PROCESS_ENV_ACCESS, ENV_WRAPPER_ACCESS observations)
npx tsx scripts/AST/ast-env-access.ts $ARGUMENTS --pretty

# Side effects (emits CONSOLE_CALL, TOAST_CALL, TIMER_CALL observations)
npx tsx scripts/AST/ast-side-effects.ts $ARGUMENTS --pretty

# Data layer (emits FETCH_API_CALL, QUERY_HOOK_DEFINITION, API_ENDPOINT observations)
npx tsx scripts/AST/ast-data-layer.ts $ARGUMENTS --pretty

# --- Interpreters ---

# Dead code detection (emits DEAD_EXPORT, CIRCULAR_DEPENDENCY assessments)
npx tsx scripts/AST/ast-interpret-dead-code.ts $ARGUMENTS --pretty
```

### Using observations and assessments

**Observations** are structural facts with no classification. Use them for:

- Import graph tracing (handler -> schema -> server module -> consumer chain)
- Complexity scoring (G4)
- Trust boundary cast detection (G5) via `TRUST_BOUNDARY_CAST` observations
- Env access patterns (G2) via `PROCESS_ENV_ACCESS` vs `ENV_WRAPPER_ACCESS` observations
- Side effect detection (G6) via `CONSOLE_CALL`, `TOAST_CALL`, `TIMER_CALL` observations
- Endpoint cross-reference (Step 5) via `FETCH_API_CALL`, `API_ENDPOINT` observations

**Assessments** are interpretations over observations. `DEAD_EXPORT` assessments
identify unused handler exports (rare but possible in API handlers).

### Tool-to-principle mapping

| Principle               | Tool             | Observations used                                                      |
| ----------------------- | ---------------- | ---------------------------------------------------------------------- |
| G4 Low Complexity       | ast-complexity   | `FUNCTION_COMPLEXITY` observations                                     |
| G5 Parse Don't Validate | ast-type-safety  | `TRUST_BOUNDARY_CAST` observations with `trustBoundarySource` evidence |
| G6 Pure Core            | ast-side-effects | `CONSOLE_CALL`, `TOAST_CALL`, `TIMER_CALL` observations                |
| G2 Explicit I/O         | ast-env-access   | `PROCESS_ENV_ACCESS` (violation) vs `ENV_WRAPPER_ACCESS` (compliant)   |
| Endpoint tracing        | ast-data-layer   | `FETCH_API_CALL` observations with `url` evidence                      |

## Report Policy

### AST-confirmed tagging

An observation or assessment qualifies for `[AST-confirmed]` tagging when ALL of:

- Based on structural fact with no interpretive leap
- For assessments: confidence is `high`, `isCandidate: false`, `requiresManualReview: false`

Examples that qualify:

- `FUNCTION_COMPLEXITY` observation -> `[AST-confirmed]`
- `TRUST_BOUNDARY_CAST` observation with `trustBoundarySource: 'JSON.parse'` -> `[AST-confirmed]`
- `PROCESS_ENV_ACCESS` observation -> `[AST-confirmed]`

### Severity bumping

`[AST-confirmed]` findings get +1 concern-level bump.

### Trust boundary cast detection

`TRUST_BOUNDARY_CAST` observations include `trustBoundarySource` evidence
identifying the source (`JSON.parse`, `.json()`, `localStorage`, etc.).
Use this to populate the G5 violations table.

## Step 1: Locate handler and schema

Given the handler path (e.g., `src/pages/api/users/user-data.ts`), find:

- The handler file itself
- The companion schema file (e.g., `src/server/handlers/users/user-data.schema.ts`)
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

## Step 4b: Audit data-api authorization (ClickHouse handlers only)

If the handler is under `src/pages/api/users/data-api/`, apply these additional
checks. These are the most critical security checks for insights endpoints.

### Role-level gating

- Does the middleware chain include `withRole(NON_MEMBER_ROLES)`?
- FAIL if `withRole` is missing -- members can call the endpoint.

### ClickHouse-side data scoping

- Does every ClickHouse query include an authorization CTE?
- Is `ctx.userId` passed as the `callerUid` parameter (not a client-supplied UID)?
- For handlers that receive `teams` from the client: are real team IDs passed to
  `allowed_uids_for_user`? Is the `-1` sentinel stripped and
  `include_unassigned_users` set accordingly?
- For handlers that receive `uids` from the client (UID-based queries): does the
  query use inline authz via `logged_in_user_ctx` + dictionary lookups? Are the
  client UIDs intersected with the authorized set?
- For broad-scan queries (no client UIDs or teams): does the query use inline
  authz via `logged_in_user_ctx` + `FROM events.users AS u CROSS JOIN caller`?
- For handlers that use parameterized views (systems, opportunities): is
  `uid = ctx.userId` passed to the view?

FAIL if any ClickHouse query lacks an authorization CTE or view parameter.
FAIL if client-supplied UIDs are trusted without intersection.
FAIL if `resolveTeamIdsToUids` or `filterOutAdminUids` are used (deleted; these
performed BFF-side UID resolution that bypasses ClickHouse authorization).
FAIL if `allowed_uids_for_user` is called with **empty teams** (`CAST(array()
AS Array(UInt32))`). The view has a logic gap: admin callers with empty teams +
`include_unassigned_users=true` only see users with no team assignments. Users
assigned to teams are silently excluded. Replace with inline authz via
`logged_in_user_ctx`. See CLAUDE.md "Data scoping" for the correct patterns.

### Post-query Postgres enrichment

- If the handler queries Postgres for user profiles/teams/groups, do the UIDs
  come from the ClickHouse result set (safe) or from client input (unsafe)?

FAIL if Postgres enrichment uses client-supplied UIDs directly.

### Shared CTE authorization

- For relay-usage handlers: does `RELAY_EVENTS_CTE` include the `allowed_uids` CTE?
- For favorite-usage handlers: does `FAVORITE_EVENTS_CTE` include the `allowed_uids` CTE?
- For productivity handlers using `fetchProductivityAggregates`: does the shared
  function include the `allowed_uids` CTE?

WARN if the handler defines its own inline authorization CTE when a shared one
exists in the domain.

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

<!-- role: emit -->

## Step 8: Emit structured findings

Write a `.findings.yaml` file next to the raw report. The filename pattern is the same as the raw report but with `.findings.yaml` extension (e.g., `api-handler--user-data--raw.findings.yaml`).

### FindingsFile schema

The YAML must validate against the FindingsFile Zod schema in `scripts/audit/schema.ts`.

```yaml
meta:
  auditTimestamp: "<timestamp from artifacts directory name>"
  auditType: "api-handler"
  target: "<target handler file>"
  agentId: "<agent ID from orchestrator>"
  track: "<fe|bff|cross-cutting>"
  filesAudited: <number>
  date: "<YYYY-MM-DD>"

headline:
  handlers: <number>
  g1to10Pass: <number>
  g1to10Warn: <number>
  g1to10Fail: <number>
  deadRoutes: <number>

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

### Headline fields for api-handler

| Field | Type | Description |
|-------|------|-------------|
| handlers | number | Count of HTTP method handlers in the file |
| g1to10Pass | number | Count of G1-G10 principles scored PASS |
| g1to10Warn | number | Count of G1-G10 principles scored WARN |
| g1to10Fail | number | Count of G1-G10 principles scored FAIL |
| deadRoutes | number | Count of handler exports with zero consumers |

### Canonical kind vocabulary

| kind | Source | Maps from |
|------|--------|-----------|
| dead-export | ast-interpret-dead-code | DEAD_EXPORT assessment |
| dead-file | ast-interpret-dead-code | Handler file with zero consumers |
| complexity-hotspot | ast-complexity | FUNCTION_COMPLEXITY observation (complexity > 7) |
| as-any | ast-type-safety | AS_ANY_CAST, EXPLICIT_ANY_ANNOTATION observations |
| non-null-assertion | ast-type-safety | NON_NULL_ASSERTION observation (unguarded) |
| trust-boundary-gap | ast-type-safety | TRUST_BOUNDARY_CAST observation; missing request/response schemas |
| architecture-smell | Manual | G1-G10 violations, missing schema file, mixed parse/process/respond layers |
| bug | Manual | Authorization gaps, silent error swallowing, missing error handling |
| style | Manual | Debug artifacts, unstructured error responses |

### Rules

1. Every finding from the Violations / Refactor Checklist section MUST appear in the YAML.
2. Assign `priority` (P1-P5) based on severity. Do NOT assign `concern` -- it is assigned during the triage pass after all agents complete.
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

## Interpreter Calibration Gate

If any interpreter classification is wrong and the misclassification
affected a decision in this skill's workflow:

1. Confirm you investigated and the interpreter is genuinely wrong.
2. Run `/create-feedback-fixture --tool <name> --file <path> --expected <correct-kind> --actual <wrong-kind>`.
3. Note the fixture in the summary output.

Do NOT create a fixture if you are unsure or the error did not affect
a decision.
