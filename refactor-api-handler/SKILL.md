---
name: refactor-api-handler
description: Refactor an existing API route handler to follow G1-G10 principles with handler-specific enforcement. Audits complexity, extracts pure core, adds Zod schemas, normalizes error handling.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
argument-hint: "The API handler file path (e.g., 'src/pages/api/users/update.ts')"
---

Refactor the API route handler at `$ARGUMENTS`.

## Prerequisite

If you have not run `audit-api-handler` on this file yet, consider doing so first. The audit
produces a scored report with a prioritized refactor checklist that prevents duplicate work.
If no audit exists, this skill runs the audit internally in Step 2.

## Rules

TOOL OUTPUT: When AST tool output is available for a file being
refactored, consume it as authoritative input. Do NOT re-evaluate
or second-guess tool-determined findings. The tool's observation
is the finding -- your job is to fix it, not to question whether
it is valid.

GAP.md ENFORCEMENT: If you assign `architecture-smell` as the finding
kind, you MUST append to scripts/AST/GAPS.md with pattern class,
file example, and what tool would detect it. No exceptions.

## Step 0: Run AST analysis tools

Before refactoring an API handler, run ast-handler-structure on the
file to get a deterministic assessment of inline logic and multi-method
violations. Use this output to guide the refactoring.

```bash
# Authorization patterns (emits RAW_ROLE_CHECK observations)
npx tsx scripts/AST/ast-query.ts authz $ARGUMENTS --pretty

# Complexity hotspots (emits FUNCTION_COMPLEXITY observations)
npx tsx scripts/AST/ast-query.ts complexity $ARGUMENTS --pretty

# Type safety (emits AS_ANY_CAST, TRUST_BOUNDARY_CAST, NON_NULL_ASSERTION observations)
npx tsx scripts/AST/ast-query.ts type-safety $ARGUMENTS --pretty

# Import graph (emits STATIC_IMPORT, DEAD_EXPORT_CANDIDATE, CIRCULAR_DEPENDENCY observations)
npx tsx scripts/AST/ast-query.ts imports $ARGUMENTS --pretty

# Side effects (emits CONSOLE_CALL, TOAST_CALL, TIMER_CALL observations)
npx tsx scripts/AST/ast-query.ts side-effects $ARGUMENTS --pretty
```

If a co-located schema file exists (`.schema.ts` sibling), run the same tools on it:

```bash
npx tsx scripts/AST/ast-query.ts complexity <schema-file> --pretty
npx tsx scripts/AST/ast-query.ts type-safety <schema-file> --pretty
```

Record the **before** cyclomatic complexity for every function in the handler.
This is the baseline for the mandatory before/after CC comparison in Step 7.

### Using observations

| Observation kind        | Informs principle | What to look for                                            |
| ----------------------- | ----------------- | ----------------------------------------------------------- |
| `FUNCTION_COMPLEXITY`   | G4                | CC > 10 is a hard fail, CC > 5 warrants review              |
| `TRUST_BOUNDARY_CAST`   | G5                | `as T` on `req.body`, `req.query`, `JSON.parse` without Zod |
| `AS_ANY_CAST`           | G8                | Every `as any` in handler code                              |
| `NON_NULL_ASSERTION`    | G8                | `!` assertions that bypass null safety                      |
| `CONSOLE_CALL`          | G6/G10            | Debug logging mixed into business logic                     |
| `DEAD_EXPORT_CANDIDATE` | G7                | Exports beyond the required default export                  |
| `CIRCULAR_DEPENDENCY`   | G1                | Handler participating in a circular import chain            |

New tools available for pre-refactor analysis:
- ast-handler-structure: run on API handlers before refactoring to
  identify inline logic that should be extracted to .logic.ts
- ast-test-coverage: run after refactoring to verify test coverage
  status hasn't degraded

## Step 1: Build the dependency picture

Read the handler file. Then read every file it imports -- schemas, server modules,
Drizzle schema tables, middleware, error classes, shared types.

Also find all consumers:

1. **Service hooks** that call this endpoint. Grep `src/ui/services/hooks/` for the
   API path string (e.g., `/api/users/user-data`). Note the client-side Zod schema
   used by `fetchApi` -- the handler's response shape must remain compatible.

2. **Mock handler** in `src/pages/api/mock/` (if one exists). The mock must stay
   compatible with the real handler's response shape after refactoring.

3. **Integration tests** in `src/tests/integration/` that hit this endpoint. These
   are behavioral contracts -- the refactored handler must pass them unchanged.

Build a map:

- **Upstream:** middleware chain, auth context, role requirements
- **Lateral:** schema file, shared types, Drizzle tables, server modules
- **Downstream:** service hooks (client-side Zod schemas), mock handler, integration tests

This map determines what changes are safe. The handler's HTTP API contract (request
shape, response shape, status codes, error format) must not change.

## Step 2: Audit (internal)

Run the same G1-G10 audit as `audit-api-handler`. Produce the scorecard and violation
list. If an `audit-api-handler` report was already produced, use that instead of
re-auditing. Output the audit results before proceeding to the rewrite.

### Handler-specific checks (in addition to G1-G10)

**Schema completeness:**

- Is there a Zod schema for request parameters (query params, body, route params)?
- Is there a Zod schema for the success response?
- Does the schema cover all fields the handler reads from the request?
- Does the schema cover all fields the handler includes in the response?
- Does the schema use branded types where appropriate (IDs, timestamps)?
- Does the schema align with shared types in `src/shared/types/`?

**Handler structure (parse/process/respond):**

- Parse: Does the handler validate all incoming data immediately via Zod?
- Process: Is business logic separated from I/O, or is it mixed into the handler body?
- Respond: Does the handler validate its output against a Zod schema before returning?

**Middleware composition:**

- Is the middleware composition order correct? (`withErrorHandler` outermost, then
  `withMethod`, then `withAuth`, then optionally `withRole` innermost)
- Is `withRole` used when the endpoint requires specific roles?
- Does the handler use `withErrorHandler`? (Required for all handlers.)

**Error handling:**

- Does the handler throw typed error classes (`NotFoundError`, `BadRequestError`,
  `ConflictError`, `ForbiddenError`) instead of raw `res.status(N).json()`?
- Are there empty catch blocks or catch-and-log-only patterns?
- Is `withErrorHandler` relied upon for error-to-HTTP mapping?

**Multi-tenancy:**

- Are all DB queries scoped to `ctx.organizationId`?

<!-- role: detect -->

## Step 3: Behavioral Preservation Checklist (MANDATORY)

Before rewriting, fill in the behavioral fingerprint for each applicable
category. This checklist prevents implicit behavior loss during refactoring.
Categories that do not apply to this file get "N/A" -- never omit a category.

If `ast-behavioral` is available, run it first to pre-populate categories
2, 3, 5, 6, 7, and 8. Categories 1 (state preservation across interactions),
4 (column/field parity), and 9 (export/download inclusion) require manual
inspection -- the tool provides partial signals but cannot fully cover them.

```bash
npx tsx scripts/AST/ast-query.ts behavioral $ARGUMENTS --pretty
```

| # | Category | Concrete values from this file | Preserved after rewrite? |
|---|----------|-------------------------------|------------------------|
| 1 | **State preservation** -- checkbox state, selection state, expanded/collapsed state that must survive filter changes or re-renders | | |
| 2 | **Null/empty display** -- exact fallback strings (N/A, dash, placeholder constant) for missing data | | |
| 3 | **Value caps/limits** -- render caps (.slice(0, N)), pagination limits, maxItems props | | |
| 4 | **Column/field parity** -- CSV export columns, table column definitions, header arrays | | |
| 5 | **String literal parity** -- exact button text, label wording, aria-labels, placeholder text | | |
| 6 | **Type coercion** -- String()/Number() calls, toString(), null-to-empty mappings at boundaries | | |
| 7 | **Default values** -- useState defaults, useQueryState defaults, prop defaults, function param defaults | | |
| 8 | **Conditional visibility** -- guards that control when UI elements appear/disappear (feature flags, role checks, data-dependent visibility) | | |
| 9 | **Export/download inclusion** -- which fields make it into CSV exports, download payloads, clipboard operations | | |

Fill in the "Concrete values" column with actual values from the file
being refactored (e.g., "useState(false) for isExpanded", "name ?? 'N/A'",
".slice(0, 5) render cap"). After the rewrite, confirm each row is
preserved (YES), intentionally changed (CHANGED -- explain), or not
applicable (N/A).

The reconciliation block must include the completed checklist.


## Step 4: Classify and plan

Based on the audit, determine the specific refactoring actions. For each failing
principle, plan the change:

### If G1 fails (mixed responsibilities)

The handler file contains utility functions, type definitions, or business logic
that belong in separate files. Plan file splits:

- Inline Zod schemas -> co-located `.schema.ts` file
- Business logic functions -> co-located `.logic.ts` file
- Shared utility functions -> appropriate module in `src/server/lib/` or `src/shared/utils/`

### If G2 fails (ambient dependencies)

Database clients, env vars, or config values accessed without being documented or
passed in. Plan:

- Ensure DB client imports are at the module top (acceptable for server modules)
- Replace any `process.env` access with `serverEnv` imports
- Document ambient dependencies at the module top if they cannot be parameterized

### If G4 fails (high cyclomatic complexity)

This is the most common failure in API handlers. Plan extraction by identifying
the complexity sources:

- **Multi-method handler without per-method split:** Split into `handleGet`,
  `handlePost`, etc. The router function dispatches on `req.method`.
- **Nested conditionals in business logic:** Extract to a pure function in a
  co-located `.logic.ts` file. The handler calls the pure function and handles I/O.
- **Complex data assembly:** Extract the assembly/transformation into a named
  function that takes typed inputs and returns typed output.
- **Role-based branching:** If the handler has different code paths per role,
  extract each path into a named function.

Target: every function in the refactored handler has CC <= 10. Aim for CC <= 5.

### If G5 fails (missing parse at boundary)

Add Zod schemas for all request data. Replace `as T` casts with `.parse()` calls.
Specific actions:

- `req.body` without validation -> add body schema, call `.parse(req.body)`
- `req.query` without validation -> add query schema, call `.parse(req.query)`
- `req.query.id as string` -> add route param schema with `z.coerce`
- `as UserId`, `as TeamId` on request data -> use branded type constructors in
  Zod schema transforms
- Response not validated -> add `.parse()` before `res.json()`

If no schema file exists, create one at `<handler>.schema.ts` (co-located, same
directory). Follow the schema file structure from `build-api-handler`.

### If G6 fails (mixed pure/impure code)

The handler body mixes database queries with data transformation. Plan separation:

- **Pure transformation functions** (data assembly, formatting, filtering) go into
  a co-located `.logic.ts` file. These functions accept typed parameters and return
  typed values. No `req`/`res` dependency.
- **I/O functions** (database queries) either stay in the handler (for simple CRUD)
  or go into the `.logic.ts` file as clearly-labeled async I/O functions.
- The handler becomes a thin shell: parse -> delegate to logic -> validate -> respond.

### If G7 fails (over-broad exports)

API handlers should export only the default export (the composed middleware chain).
Remove any named exports that leaked. If tests import internal functions, flag the
test as a candidate for rewriting to use the public API (HTTP-level testing).

### If G8 fails (loose types)

- Replace `any` with `unknown` and narrow
- Replace bare `string`/`number` for IDs with branded types
- Add explicit return type annotations to extracted functions
- Replace `as T` casts with Zod parsing or type guards

### If G9 fails (configuration over composition)

Flag parameters, mode switches, or option objects that create multi-path behavior.
Split into separate focused functions. Common in handlers that serve multiple
HTTP methods with a single monolithic function body.

### If G10 fails (error handling)

- Replace raw `res.status(N).json({ error: '...' })` with typed error classes:
  `throw new NotFoundError('Resource')`, `throw new BadRequestError('...')`, etc.
- Replace empty `catch {}` with appropriate error handling or rethrow
- Replace `catch (e: any)` with `catch (error: unknown)` and narrow
- Ensure `withErrorHandler` is in the middleware composition (it handles the mapping)

### If middleware is missing or misordered

Add or reorder the middleware composition. The correct order is:

```ts
export default withErrorHandler(withMethod(['GET'], withAuth(handler)));
// or with role check:
export default withErrorHandler(withMethod(['GET'], withAuth(withRole(ROLES, handler))));
```

### If data-api handler lacks ClickHouse-side authorization

Data-api handlers (under `src/pages/api/users/data-api/`) must enforce
authorization inside ClickHouse. Specific actions:

- **Add `withRole(NON_MEMBER_ROLES)`** if missing from the middleware chain.
- **Add an authorization CTE** to every ClickHouse query that lacks one.
  Use the pattern matching the query type:
  - **Team-based queries** (handler receives `teams` from client): use
    `allowed_uids_for_user` with real team IDs.
  - **UID-based or broad-scan queries** (handler receives `uids` or scans
    all users): use inline authz via `logged_in_user_ctx` and direct
    dictionary lookups on the target UIDs. Do NOT use
    `allowed_uids_for_user` with empty teams — it has a logic gap that
    silently drops team-assigned users for admin callers.
    See CLAUDE.md "Data scoping (ClickHouse authorization)" for the full
    CTE patterns.
- **Remove `resolveTeamIdsToUids` and `filterOutAdminUids`** if present. These
  perform BFF-side UID resolution that bypasses ClickHouse authorization.
- **If handler uses `allowed_uids_for_user` with empty teams**: replace with
  the inline `logged_in_user_ctx` + dictionary lookup pattern. This is the
  most common authorization bug in existing handlers.
- **Extract post-query UIDs for Postgres enrichment**: replace upfront Postgres UID
  resolution with `[...new Set(rows.map(r => r.uid))]` from the ClickHouse result.
- **Extract shared queries**: if the same ClickHouse query is used by multiple
  handlers, extract to `src/server/productivity/` or embed the authorization CTE
  in a shared CTE constant (relay-usage, favorite-usage pattern).

## Step 5: Rewrite

Apply all planned changes. Follow these rules:

### Behavior preservation is paramount

The handler's HTTP API contract must not change:

- Same request parameter names and types
- Same response shape (field names, nesting, types)
- Same HTTP status codes for success and error cases
- Same error response format

If a consumer's Zod schema (client-side `fetchApi` call) would break, the change
is wrong. After refactoring, all existing integration tests must pass unchanged.

### Do not change the file's default export signature

Next.js expects `export default` for API route files. The composed middleware chain
is always the default export. Do not add named exports to the handler file.

### Schema files are co-located

If the handler lacks a schema file, create one at the same directory level with the
naming convention `<handler-name>.schema.ts`:

- `index.ts` -> `index.schema.ts`
- `[id].ts` -> `[id].schema.ts`
- `user-data.ts` -> `user-data.schema.ts`

Schema file structure follows `build-api-handler`:

```ts
import { z } from 'zod';

// Request schemas
export const QueryParamsSchema = z.object({
  /* ... */
});
export const BodySchema = z.object({
  /* ... */
});

// Route param schema (for dynamic routes)
export const RouteParamsSchema = z.object({
  id: z.coerce.number().int(),
});

// Response schema -- import from shared types when possible
export { SomeDomainSchema } from '@/shared/types/<domain>';

// Derive types
export type QueryParams = z.infer<typeof QueryParamsSchema>;
export type Body = z.infer<typeof BodySchema>;
```

### Pure-core extraction creates a testable module

When extracting business logic to a `.logic.ts` file:

- Functions accept typed parameters, not `req`/`res`
- Functions return typed values, not `void` with `res.json()` side effects
- Throw typed error classes (`NotFoundError`, `ConflictError`, etc.) for business
  rule violations -- `withErrorHandler` catches and maps them
- Pure data transformation functions (no DB access) are separate from I/O functions
- Every function has explicit parameter types and return type annotation
- JSDoc on infrastructure-level functions (G8 + JSDoc conventions from CLAUDE.md)

Example structure for a high-CC handler like `user-data.ts`:

```ts
// user-data.logic.ts
import { db } from '@/server/db/postgres';
import {} from /* tables */ '@/server/db/schema';

/** Fetches and assembles user data for an organization. */
export async function fetchUsersForOrg(
  organizationId: number,
  userId: string,
  roles: string[],
  teamIdFilter?: number,
): Promise<AssembledUser[]> {
  // DB queries + assembly logic extracted from handler
}

/** Builds lookup maps from parallel query results for O(1) assembly. */
export function buildLookupMaps(roleRows: RoleRow[], teamRows: TeamRow[], groupRows: GroupRow[]): UserLookupMaps {
  // Pure transformation, independently testable
}
```

### Flattening complexity

When reducing CC:

- Replace nested if/else with guard clauses that return early
- Replace switch statements with `Record<Discriminant, Handler>` lookup maps
- Split multi-method handlers into per-method functions
- Extract complex data assembly into named functions
- Do not extract sub-functions purely to reduce line count -- only when the
  sub-function has a clear, nameable single job (G1)

### Error handling normalization

Replace all raw `res.status(N).json()` error responses with typed error classes:

```ts
// Before
if (!user) {
  return res.status(404).json({ error: 'User not found' });
}

// After
if (!user) throw new NotFoundError('User');
```

The typed error classes are in `src/server/errors/ApiErrorResponse.ts`.
`withErrorHandler` catches them and maps to the correct HTTP status and envelope.

### Consumer updates

If you extract schemas from inline definitions to a `.schema.ts` file, no consumer
updates are needed (the handler's HTTP contract is unchanged). If you change the
middleware composition (add `withRole`), verify that existing consumers handle the
new 403 case.

## Type touchpoints

Before defining any new type:

1. Check `src/shared/types/` for existing domain type modules. Import from
   `@/shared/types/<module>`, not from internal paths.
2. Check `src/shared/types/<domain>/schemas.ts` (or `<domain>/index.ts`) for existing Zod schemas. If the
   handler's response matches an existing schema, import and use it.
3. Use branded types for IDs: `UserId`, `TeamId`, `WorkstreamId`, `OrganizationId`
   from `@/shared/types/brand`.
4. Handler-local types (request body shapes, query param shapes) stay in the
   co-located schema file.

## Step 6: Verify

1.  **TypeScript:** Run `pnpm tsc --noEmit -p tsconfig.check.json`. Fix any type errors in changed files.

2.  **Intention matcher (MANDATORY -- do not skip):** After tsc and tests pass,
    run the intention matcher to verify the refactor preserved the handler's
    behavioral signals. **This step is mandatory.** Do not skip it. Do not
    report success without running it and including the output in your summary.
    A low score blocks the refactor until investigated and resolved.

    **`refactorType: 'api-handler'`**

    a. Collect the file lists:

    - **beforeFiles**: the handler file + schema file (if existed before)
    - **afterFiles**: the handler file + schema file + any `.logic.ts` file

    b. Run the intention matcher:

    ```bash
    npx tsx scripts/AST/ast-refactor-intent.ts \
      --before <beforeFiles...> \
      --after <afterFiles...> \
      > /tmp/signal-pair.json
    ```

    c. Run the interpreter:

    ```bash
    npx tsx scripts/AST/ast-query.ts interpret-intent \
      --signal-pair /tmp/signal-pair.json \
      --refactor-type api-handler \
      --pretty
    ```

    d. Check the interpreter's exit code:

    - **Exit 0** (score >= 90, zero ACCIDENTALLY_DROPPED): proceed.
    - **Exit 1** (score >= 70, has ACCIDENTALLY_DROPPED): review the
      pretty-printed output. List the dropped signals, assess whether each
      is truly accidental. If all are explained (e.g., dead code removal),
      proceed. If any are genuine drops, fix them before proceeding.
    - **Exit 2** (score < 70): stop and investigate. Something went wrong.

    e. If the intention matcher flags a signal as ACCIDENTALLY_DROPPED and
    investigation confirms it was actually intentional, run
    `/create-feedback-fixture --tool intent --file <before-file> --files <after-files> --expected INTENTIONALLY_REMOVED --actual ACCIDENTALLY_DROPPED`.

3.  **Complexity (mandatory before/after):** Run `npx tsx scripts/AST/ast-query.ts complexity <all-changed-files> --pretty`.
    Every function must have CC <= 10. Compare against the baseline recorded in Step 0.

4.  **Type safety:** Run `npx tsx scripts/AST/ast-query.ts type-safety <all-changed-files> --pretty`.
    Zero `as any` casts. Zero bare `as T` casts at trust boundaries (use Zod `.parse()` instead).

5.  **Tests:** If existing unit or integration tests cover the handler, run them.
    Report results. All tests must pass -- the refactoring is behavior-preserving.

6.  **Lint:** Run `npx eslint <all-changed-files> --max-warnings 0`. Zero errors,
    zero warnings.

Report all results in the summary. A refactoring is not complete until tsc passes,
all functions have CC <= 10, and existing tests pass.

## Step 7: Summary

Output a structured summary:

```markdown
## Refactor: <handler path>

### Classification

API route handler (<HTTP methods>, <auth level>)

### Before

| Function | CC  | G-Violations |
| -------- | --- | ------------ |
| handler  | 22  | G1, G4, G6   |

### After

| Function       | CC  | File               |
| -------------- | --- | ------------------ |
| handler        | 3   | user-data.ts       |
| buildUserQuery | 5   | user-data.logic.ts |
| formatUserData | 4   | user-data.logic.ts |

### Before/After Scorecard

| Principle               | Before | After |
| ----------------------- | ------ | ----- |
| G1 Single Job           | FAIL   | PASS  |
| G2 Explicit I/O         | PASS   | PASS  |
| G3 No Bad Abstractions  | PASS   | PASS  |
| G4 Low Complexity       | FAIL   | PASS  |
| G5 Parse Don't Validate | WARN   | PASS  |
| G6 Pure Core            | FAIL   | PASS  |
| G7 Narrow Exports       | PASS   | PASS  |
| G8 Types as Docs        | WARN   | PASS  |
| G9 Composition          | PASS   | PASS  |
| G10 Fail Fast           | FAIL   | PASS  |

### Changes Made

- Extracted N pure functions to `<logic-file>`
- Added/updated Zod schema at `<schema-file>`
- Normalized error handling to envelope pattern
- Added middleware composition (or: reordered middleware)
- Split multi-method handler into per-method functions

### Files Created

- `<path>` -- <its single job>

### Files Modified

- `<path>` -- <what changed>

### Consumer Impact

- No consumer changes required (HTTP contract preserved)
- OR: <list of consumer files updated and why>

### Files Changed
```

Before (read from HEAD):

- <file1>
- <file2>

After (written/modified):

- <file1> (modified)
- <file3> (created)

```

### Intent preservation

```

Intent preservation: <score>/100
Preserved: <N> | Intentionally removed: <N> | Dropped: <N> | Added: <N>

```

### Verification

- tsc: <PASS | FAIL (N errors)>
- ast-complexity: <all functions <= 10 | list violations>
- ast-type-safety: <zero unsafe casts | list violations>
- Tests: <PASS (N passed) | FAIL (N failed) | NO TESTS>
- ESLint: <clean | N errors, M warnings>
```
