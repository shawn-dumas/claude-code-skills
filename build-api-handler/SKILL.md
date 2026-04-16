---
name: build-api-handler
description: Generate a new Next.js API route handler with co-located schema, pure-core extraction, and middleware composition. Enforces G4 complexity limits with AST verification.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
argument-hint: The API endpoint path and HTTP methods (e.g., '/api/users/teams POST,PUT')
tier: open
---

Generate a new Next.js BFF API route handler. `$ARGUMENTS`

The argument format is: `<endpoint-path> <HTTP-methods> [description]`

- **endpoint-path**: The route path under `src/pages/api/` (e.g., `/api/users/teams`
  or `/api/users/teams/[id]`).
- **HTTP-methods**: Comma-separated methods the handler serves (e.g., `GET,POST`).
- **description** (optional): What the endpoint does. Used to inform schema design
  and business logic extraction.

## Step 1: Parse the argument

Extract:

- **Route path** -- determines the file location under `src/pages/api/`. A path like
  `/api/users/teams` maps to `src/pages/api/users/teams/getByOrgId.ts`. A path like
  `/api/users/teams/[id]` maps to `src/pages/api/users/teams/update.ts`.
- **HTTP methods** -- determines the `withMethod` allowlist and how many per-method
  branches the handler needs.
- **Dynamic segments** -- any `[param]` in the path requires a Zod param schema.
- **Description** -- informs the schema field names and business logic shape.

If the argument is ambiguous (no methods specified, unclear whether the endpoint
is a collection or single resource), ask the user before proceeding.

## Step 2: Survey the codebase

Read the following to understand existing patterns and the target domain:

1. **2-3 existing handlers** in the same domain directory (e.g., if building
   `/api/users/teams`, read other files under `src/pages/api/users/`). Note the
   middleware composition order, schema import patterns, and DB access patterns.

2. **Middleware files:**

   - `src/server/middleware/withAuth.ts` -- understand `AuthedContext` shape
   - `src/server/middleware/withErrorHandler.ts` -- understand which errors are caught
   - `src/server/middleware/withMethod.ts` -- understand the method guard signature
   - `src/server/middleware/withRole.ts` -- understand role constants and `withRole` usage

3. **Error envelope:** `src/server/errors/ApiErrorResponse.ts` -- understand the
   error classes (`NotFoundError`, `ForbiddenError`, `BadRequestError`,
   `ConflictError`) and the envelope factory functions.

4. **Drizzle schema** for the relevant domain: check `src/server/db/schema.ts` for
   table definitions that the handler will query.

5. **Existing shared types:** Check `src/shared/types/` for domain schemas that the
   handler's response should align with. The handler validates its output against
   these schemas before returning (G5 at the output boundary).

6. **Existing service hooks:** Grep `src/ui/services/hooks/` for hooks that will
   consume this endpoint. If a consumer already exists, the handler's response shape
   must match the client-side Zod schema.

## Step 3: Design the handler architecture

Plan the separation of concerns before writing any code. The handler follows a
three-layer structure:

```
Request --> [Parse] --> [Process] --> [Respond] --> Response
             |              |              |
         Zod schemas    Pure logic    Validated output
```

### Parse layer (trust boundary)

Every value from `req.body`, `req.query`, and `req.params` passes through a Zod
schema. No `as UserId`, `as TeamId`, or `as T` casts on request data. The parse
layer produces typed, trusted values for the process layer.

### Process layer (business logic)

Database queries and data transformation. For non-trivial logic (3+ branches,
complex joins, data aggregation), extract to a separate module that can be tested
without `req`/`res`. For simple CRUD (single query + response mapping), inline
processing in the handler is acceptable.

**When to extract a logic module:**

- The handler has 3+ database queries with conditional branching between them
- The handler performs data transformation that is independently testable
- The handler's cyclomatic complexity would exceed 10 without extraction
- The same logic is needed by multiple handlers

**When inline is acceptable:**

- Single CRUD operation (insert/update/delete + return)
- Simple list query with optional filtering
- The handler body stays under ~50 lines

### Respond layer (output boundary)

The handler validates its output against the domain's Zod schema before returning.
This catches shape drift between the DB layer and the client contract.

### Middleware composition

Every handler uses this composition pattern:

```ts
export default withErrorHandler(withMethod(['GET', 'POST'], withAuth(handler)));
```

With role-based access control:

```ts
export default withErrorHandler(withMethod(['GET', 'POST'], withAuth(withRole(READ_MANAGEMENT_ROLES, handler))));
```

**Composition order (outermost to innermost):**

1. `withErrorHandler` -- always outermost. Catches all thrown errors and maps them
   to the error envelope. Must wrap everything.
2. `withMethod` -- second. Rejects disallowed HTTP methods before auth runs (avoids
   unnecessary Firebase token verification for wrong methods).
3. `withAuth` -- third. Verifies the Firebase ID token and resolves user context.
4. `withRole` -- innermost (optional). Checks caller roles against an allowlist.

**When to use `withRole`:** When the endpoint requires specific roles beyond
"authenticated user." Use the convenience constants from `withRole.ts`:
`READ_MANAGEMENT_ROLES`, `MODIFY_ROLES`, `NON_MEMBER_ROLES`, `ASSIGN_PROJECT_ROLES`.

**When to skip `withRole`:** When any authenticated user can access the endpoint.
The handler receives `AuthedContext` from `withAuth` and can do its own fine-grained
authorization if needed.

**Public endpoints (no auth):** Omit `withAuth`. The handler receives raw
`(req, res)` instead of `(ctx, req, res)`. This is rare in the BFF.

### ClickHouse data-api authorization

Data-api handlers (under `src/pages/api/users/data-api/`) query ClickHouse for
insights data. They enforce authorization **inside ClickHouse**, restricting
results to UIDs the caller may see based on their role and team ownership.

There are two patterns depending on how the handler receives its scope:

**Team-based queries** (handler receives `teams` from the client) use
`allowed_uids_for_user` with real team IDs:

```sql
WITH allowed_uids AS (
  SELECT uid
  FROM events.allowed_uids_for_user(
    uid = {callerUid:String},
    include_unassigned_users = {includeUnassigned:Bool},
    teams = CAST({teamIds:Array(UInt32)} AS Array(UInt32))
  )
)
SELECT ...
FROM events.some_table
WHERE uid IN (SELECT uid FROM allowed_uids)
  AND ...
```

Strip the `-1` sentinel from the teams array and set `includeUnassigned`
accordingly.

**UID-based or broad-scan queries** (handler receives `uids` from the client,
or scans all authorized UIDs) use inline authz via `logged_in_user_ctx`:

```sql
-- Single-UID pattern
WITH
  caller AS (SELECT * FROM events.logged_in_user_ctx(uid = {callerUid:String})),
  target_authorized AS (
    SELECT {uid:String} AS uid
    WHERE dictHas('events.users', {uid:String})
      AND dictGetOrDefault('events.users', 'customer', {uid:String}, '') =
          (SELECT customer FROM caller)
      AND dictGetOrDefault('events.users', 'active', {uid:String}, false) = true
      AND NOT has(
            dictGetOrDefault('events.users', 'roles', {uid:String},
              CAST([], 'Array(LowCardinality(String))')),
            'admin')
      AND (
        (SELECT is_admin FROM caller)
        OR (
          (SELECT is_teamowner FROM caller)
          AND hasAny(
            dictGetOrDefault('events.users', 'team_ids', {uid:String},
              CAST([], 'Array(UInt32)')),
            (SELECT owned_team_ids FROM caller))
        )
      )
  )
SELECT ... WHERE uid IN (SELECT uid FROM target_authorized)
```

```sql
-- Multi-UID / broad-scan pattern
WITH
  caller AS (SELECT * FROM events.logged_in_user_ctx(uid = {callerUid:String})),
  authorized_uids AS (
    SELECT u.uid
    FROM events.users AS u
    CROSS JOIN caller c
    WHERE u.customer = c.customer
      AND u.active = true
      AND NOT has(u.roles, 'admin')
      AND (c.is_admin OR (c.is_teamowner AND hasAny(u.team_ids, c.owned_team_ids)))
  )
SELECT ... WHERE uid IN (SELECT uid FROM authorized_uids)
```

**CRITICAL: Do NOT use `allowed_uids_for_user` with empty teams for UID-based
queries.** The view has a logic gap: admin callers with empty teams +
`include_unassigned_users=true` only see users with no team assignments.
Users assigned to teams are silently excluded. Use the inline patterns above.

**Middleware chain for data-api handlers:**

```ts
export default withErrorHandler(withMethod(['POST'], withAuth(withRole(NON_MEMBER_ROLES, handler))));
```

All data-api routes use `NON_MEMBER_ROLES`. Never skip `withRole` on data-api.

**Post-query Postgres enrichment:** If the handler needs user profiles, team
names, or group assignments, extract UIDs from the ClickHouse result set and
fetch from Postgres. Never resolve UIDs from Postgres first — that bypasses
ClickHouse-side authorization.

**Shared queries:** When the same ClickHouse query is used by multiple handlers,
extract it to `src/server/productivity/` (e.g., `fetchProductivityAggregates`).
For domain-specific shared CTEs (relay-usage, favorite-usage), embed the
`allowed_uids` CTE in the shared CTE constant.

## Step 4: Generate the files

Create the target directory with `mkdir -p` if it does not exist.

### 4a. Schema file (`<handler>.schema.ts`)

Co-locate the schema file next to the handler. Name it to match the handler:
`index.schema.ts` for `index.ts`, `[id].schema.ts` for `[id].ts`.

If a suitable schema already exists in `src/shared/types/`, import and re-use it
instead of creating a new one. Only create a handler-local schema when:

- The request shape is endpoint-specific (query params, body) and not shared
- The response shape differs from the shared domain type (e.g., includes computed
  fields like `user_count` that are not on the base entity)

**Schema file structure:**

```ts
import { z } from 'zod';

// Request schemas -- one per HTTP method if shapes differ
export const CreateBodySchema = z.object({
  name: z.string().min(1),
  // ...
});

export const QueryParamsSchema = z.object({
  type: z.enum(['BPO', 'PROJECT']),
  // ...
});

// Dynamic route param schema (for [id] routes)
export const RouteParamsSchema = z.object({
  id: z.coerce.number().int(),
});

// Response schemas -- import from shared types when possible
// If the response matches a shared type, re-export:
export { GroupSchema, GroupArraySchema } from '@/shared/types/bpo-projects';

// If the response needs endpoint-specific fields:
export const EndpointResponseSchema = z.object({
  // ...
});

// Derive types from schemas
export type CreateBody = z.infer<typeof CreateBodySchema>;
export type QueryParams = z.infer<typeof QueryParamsSchema>;
```

**Rules:**

- Use branded type constructors in schemas where applicable (e.g.,
  `z.string().transform(UserId)` for user ID fields).
- Use `z.coerce.number()` for numeric route/query params (they arrive as strings).
- Every field the handler reads from the request MUST be in a schema.
- Every field the handler includes in the response MUST be validated.

### 4b. Business logic module (when extraction is warranted)

If Step 3 determined that logic extraction is needed, create a logic module
co-located with the handler: `<handler>.logic.ts`.

**Structure:**

```ts
import { db } from '@/server/db/postgres';
import { someTable } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { NotFoundError, ConflictError } from '@/server/errors/ApiErrorResponse';
import type { CreateBody, QueryParams } from './handler-name.schema';

/**
 * Fetches groups for an organization, including user counts.
 * Pure data retrieval -- no req/res dependency.
 */
export async function fetchGroupsForOrg(organizationId: number, type: QueryParams['type']) {
  // DB queries and data transformation here
}

/**
 * Creates a new group, checking for duplicate names.
 * Throws ConflictError if a duplicate exists.
 */
export async function createGroup(organizationId: number, body: CreateBody, type: QueryParams['type']) {
  // DB queries and business logic here
}
```

**Rules:**

- Functions accept typed parameters, not `req`/`res`.
- Functions return typed values, not `void` with `res.json()` side effects.
- Throw error classes from `src/server/errors/ApiErrorResponse.ts` for business
  rule violations. `withErrorHandler` catches and maps them.
- Pure data transformation functions (no DB access) should be separate from
  I/O functions that query the database.
- Every function has explicit parameter types and return type annotation.
- **ClickHouse mappers**: All numeric coercion on display fields MUST go
  through `gmork()` from `@/server/lib/gmork`. No inline `?? 0`, `|| 0`,
  `!= null ? Number(x) : 0`. Add an entry in `src/shared/constants/theNothing.ts`
  for each numeric display field. Use `notApplicable` if null should display as
  "-", `measuredZero` if 0 is a valid measurement.

### 4c. Handler file (`index.ts` or `[id].ts`)

The handler is a thin I/O shell. It parses the request, delegates to business
logic, validates the output, and responds.

**Structure for an authed handler with role check:**

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthedContext } from '@/server/middleware/withAuth';
import { withMethod } from '@/server/middleware/withMethod';
import { withErrorHandler } from '@/server/middleware/withErrorHandler';
import { withRole, MODIFY_ROLES } from '@/server/middleware/withRole';
import { db } from '@/server/db/postgres';
import { someTable } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@/server/errors/ApiErrorResponse';
import { ResponseSchema } from '@/shared/types/<domain>';
import { BodySchema, ParamSchema } from './handler-name.schema';

async function handler(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse) {
  // 1. Parse -- trust boundary
  const { id } = ParamSchema.parse(req.query);
  const body = BodySchema.parse(req.body);

  // 2. Process -- business logic (inline for simple CRUD)
  const rows = await db.select().from(someTable).where(eq(someTable.id, id));

  if (rows.length === 0) throw new NotFoundError('Resource');

  // 3. Respond -- validate output
  const validated = ResponseSchema.parse(rows[0]);
  return res.status(200).json(validated);
}

export default withErrorHandler(withMethod(['PUT'], withAuth(withRole(MODIFY_ROLES, handler))));
```

**Structure for multi-method handlers (GET + POST):**

```ts
async function handler(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(ctx, req, res);
  }
  return handlePost(ctx, req, res);
}

async function handleGet(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse) {
  // Parse, process, respond for GET
}

async function handlePost(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse) {
  // Parse, process, respond for POST
}

export default withErrorHandler(withMethod(['GET', 'POST'], withAuth(handler)));
```

**Rules:**

- The handler signature is `(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse)`
  when using `withAuth`. Without `withAuth`, it is `(req: NextApiRequest, res: NextApiResponse)`.
- For multi-method handlers, split into per-method functions to keep complexity low (G4).
  The router function dispatches on `req.method`.
- If method-specific role checks are needed (e.g., GET is read-only but POST requires
  admin), check roles inline rather than using `withRole` (which applies to all methods).
  Use the role constants from `withRole.ts`.
- All error paths throw typed error classes. Never write `res.status(N).json({ error: '...' })`
  directly -- `withErrorHandler` handles the mapping.
- Response bodies pass through Zod validation before `res.json()`.
- Scope all DB queries to `ctx.organizationId` for multi-tenancy.
- No `console.log` in handler code. `withErrorHandler` logs unknown errors.
- The only export is the default export (the composed middleware chain).

### 4d. Test file (`<handler>.spec.ts`)

Generate tests for the business logic. If a logic module was extracted (4b), write
unit tests for its pure functions. If logic is inline in the handler, write HTTP-level
integration test shells.

**For extracted logic modules (unit tests):**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGroup } from '@/fixtures';

// Mock the DB module at the boundary
vi.mock('@/server/db/postgres', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
  },
}));

describe('fetchGroupsForOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns groups with user counts', async () => {
    // Arrange with fixture data
    const group = buildGroup();
    // ... mock DB responses
    // Act
    const result = await fetchGroupsForOrg(1, 'BPO');
    // Assert on the public return value
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: group.id })]));
  });

  it('throws NotFoundError when resource does not exist', async () => {
    // ... mock empty DB response
    await expect(fetchForId(999)).rejects.toThrow(NotFoundError);
  });
});
```

**For HTTP-level integration tests (when using `pnpm test:integration`):**

The Vitest API integration tests in `src/tests/integration/` test handlers at the
HTTP level with real containers. If the handler warrants integration testing, add a
note about which spec file to create. Do not generate the integration test directly
-- it requires the Docker-based test infrastructure.

**Test rules:**

- Use fixture builders from `src/fixtures/` for test data (P5).
- Mock only at boundaries: the database module, not internal helpers (P2).
- No `as any`. Use `satisfies` and fixture `build()` for type safety (P6).
- Each test owns its data -- no shared mutable fixtures (P5).
- Assert on return values and thrown errors, not internal state (P1).
- `beforeEach` resets mocks. The global `vitest.setup.ts` handles
  `afterEach(() => vi.restoreAllMocks())` (P10).

## Type touchpoints

Before defining any new type:

1. Check `src/shared/types/` for existing domain type modules. Import from
   `@/shared/types/<module>`, not from internal paths.
2. Check `src/shared/types/<domain>/schemas.ts` (or `<domain>/index.ts`) for existing Zod schemas. If the
   handler's response matches an existing schema, import and use it.
3. Use branded types for IDs: `UserId`, `TeamId`, `WorkstreamId`, `OrganizationId`
   from `@/shared/types/brand`.
4. If a new shared type is needed (used by 2+ files in different directories), add it
   to `src/shared/types/` with a barrel export.
5. Handler-local types (request body shapes, query param shapes) stay in the co-located
   schema file.

## Step 5: Verify

1. **TypeScript:** Run `pnpm tsc --noEmit -p tsconfig.check.json`. Fix any type errors in generated files.

2. **Authorization patterns:** Run `npx tsx scripts/AST/ast-query.ts authz <generated-files> --pretty`.
   Flag any `RAW_ROLE_CHECK` observations -- new handlers must use the canonical
   authorization utilities, not inline role checks.

3. **Complexity:** Run `npx tsx scripts/AST/ast-query.ts complexity <generated-files> --pretty`.
   Every function must have cyclomatic complexity <= 10. Target CC <= 5 for each
   function. If any function exceeds 10, decompose it (extract per-method handlers,
   split complex queries into separate functions, use lookup maps instead of branching).

4. **Type safety:** Run `npx tsx scripts/AST/ast-query.ts type-safety <generated-files> --pretty`.
   Zero `as any` casts. Zero bare `as T` casts at trust boundaries. The only acceptable
   casts are `as const` and type narrowing after runtime checks.

5. **Tests:** Run `pnpm vitest run <test-file>`. All tests must pass.

6. **Lint:** Run `npx eslint <generated-files> --max-warnings 0`. Zero errors, zero
   warnings.

7. **BFF gap closure** (if replacing a 501 stub): Run
   `npx tsx scripts/AST/ast-bff-gaps.ts <api-directory> --kind BFF_STUB_ROUTE --no-cache`
   and verify the endpoint no longer appears as a stub.

Report all results in the summary. A generation is not complete until tsc passes and
all functions have CC <= 10.

## Step 6: Fixture Fidelity Check

After verification passes, check fixture alignment for the handler's response domain.
This prevents drift between handler output shape and test fixture data.

### 6a. Check for an existing fixture builder

Search `src/fixtures/domains/` for a fixture file covering the handler's response
domain. If no fixture builder exists, note in the summary that `/build-fixture`
should be run for this domain.

### 6b. Verify field-by-field fidelity (when a fixture builder exists)

Trace the handler's data pipeline end-to-end:

1. **CH wire format:** Run the handler's ClickHouse query against describe:
   ```
   curl -s 'http://localhost:8133/' --data-binary "DESCRIBE events.<table> FORMAT JSONEachRow"
   ```
   Compare CH column types against the row type in `queries.types.ts`.

2. **UInt64 fields:** ClickHouse serializes UInt64 as a JSON string. Verify
   that the row type in `queries.types.ts` types these fields as `string`,
   not `number`. If the handler converts them via `Number()`, the fixture
   must produce numbers (post-mapping shape), not strings.

3. **Percentage fields:** Check whether the SQL multiplies by 100 (0-100
   scale) or returns a raw fraction (0-1 scale). Document the scale in a
   type comment on the row type field. The fixture must match the
   post-mapping scale.

4. **Duration fields:** Check whether the SQL returns milliseconds or
   seconds. Document the unit in a type comment on the row type field.
   If the handler formats via `formatDuration()` or similar, the
   fixture must produce formatted duration strings (post-mapping shape).

5. **Fixture builder shape:** Verify that the fixture builder produces
   values matching the handler's post-mapping output shape, not just the
   raw CH wire format. The handler may rename fields, convert types, or
   compute derived values -- the fixture must reflect these transforms.

### 6c. Fidelity checklist

Add this block to the handler's reconciliation output:

```
Fixture Fidelity:
  Row type matches CH wire format: <yes|no>
  Fixture builder matches handler output shape: <yes|no|no fixture>
  Percentage scale documented: <yes|N/A>
  Duration units documented: <yes|N/A>
```
