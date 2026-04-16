---
name: build-nr-server-integration
description: Build New Relic server APM integration. Installs the newrelic package, creates config, adds noticeError to middleware, sets custom attributes, and wraps ClickHouse queries in custom segments.
context: fork
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
argument-hint: <gap-id> (e.g., S1, S2, S3, S4, S6 -- see audit-nr-observability output)
tier: open
---

Implement the New Relic server APM integration for the specified gap(s)
at `$ARGUMENTS`. Each gap ID corresponds to an entry from the
`/audit-nr-observability` output.

For any TS/TSX source query, use the ast-query dispatcher:
`npx tsx scripts/AST/ast-query.ts <query-type> <path>`
Do NOT run `npx tsx scripts/AST/ast-*.ts` directly. Do NOT use `rg`, `sg`,
or the Grep tool on TS/TSX source.

<!-- role: reference -->

## Gap implementations

### S1: Install newrelic package

```bash
pnpm add newrelic
```

The `@types/newrelic` package is already in devDependencies.

### S2: Create newrelic.js config

**Where:** Project root (`newrelic.js`)

```javascript
'use strict';

// Raw process.env is intentional here. newrelic.js loads before the app
// bootstraps, so the Zod-validated env modules (clientEnv/serverEnv) are
// not available yet. This is standard NR agent bootstrap -- do not
// refactor to use serverEnv.
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || '8flow-user-frontend'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || '',
  distributed_tracing: {
    enabled: true,
  },
  logging: {
    level: 'info',
  },
  allow_all_headers: true,
  attributes: {
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x-*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
    ],
  },
  // Auto-instrument postgres (via postgres.js/pg). ClickHouse needs
  // custom segments (see S6).
  transaction_tracer: {
    enabled: true,
    record_sql: 'obfuscated',
  },
};
```

This config uses environment variables for secrets and should be
committed to version control. Do NOT add `newrelic.js` to `.gitignore`.

### S3: Add noticeError to withErrorHandler

**Where:** `src/server/middleware/withErrorHandler.ts`

**What to change:** Add `newrelic.noticeError(err)` alongside each
`console.error` call in the catch block:

```typescript
import newrelic from 'newrelic';

// In the catch block, after each console.error:
if (err instanceof ConflictError) {
  console.error(JSON.stringify({ requestId, conflict: err.message }));
  newrelic.noticeError(err, { requestId, errorType: 'ConflictError' });
  // ...
}

// For the ZodError case:
console.error(JSON.stringify({ requestId, zodError: err.issues }));
newrelic.noticeError(err, { requestId, errorType: 'ZodError' });

// For the unknown error case:
console.error(JSON.stringify({ requestId, error: String(err) }));
newrelic.noticeError(err instanceof Error ? err : new Error(String(err)), { requestId });
```

### S4: Add custom attributes to withAuth

**Where:** `src/server/middleware/withAuth.ts`

**What to add:** After resolving the user context, set NR custom attributes:

```typescript
import newrelic from 'newrelic';

// After the handler call (or before, depending on preference):
newrelic.addCustomAttributes({
  userId: decoded.uid,
  organizationId: userContext.organizationId,
  company: userContext.company,
});
```

Place this before the `await handler(...)` call so the attributes are
set for the entire transaction.

### S5: Postgres auto-instrumentation

No code changes needed. Once `newrelic` is installed and configured
(S1/S2), the NR agent auto-instruments `postgres` queries via the
`postgres.js` driver. Verify after S1/S2 by checking the NR dashboard
for database transaction segments.

### S6: ClickHouse custom segments

**Where:** `src/server/db/clickhouse.ts` or individual query call sites

**What to add:** Wrap ClickHouse queries in `newrelic.startSegment`:

```typescript
import newrelic from 'newrelic';

// Wrapper function:
export async function queryClickHouse<T>(
  queryName: string,
  queryFn: () => Promise<T>,
): Promise<T> {
  return newrelic.startSegment(`clickhouse:${queryName}`, true, queryFn);
}

// Usage in handlers:
const result = await queryClickHouse('getTeamActivity', () =>
  clickhouse.query({ query: TEAM_ACTIVITY_QUERY, query_params: params })
);
```

`@clickhouse/client` is not in NR's auto-instrumentation list, so custom
segment wrapping is required.

<!-- role: guidance -->

## Rules

- Always run `/audit-nr-observability` first to confirm which gaps exist
- S1 and S2 must be implemented first -- all other server gaps depend on them
- Follow the existing error handling patterns in `withErrorHandler`
- Do NOT modify the error response shapes or HTTP status codes
- All new code must have corresponding tests
- Verify with: `npx tsx scripts/AST/ast-query.ts nr-server <modified-files> --pretty`

<!-- role: workflow -->

## Step 1: Identify the gap

Parse `$ARGUMENTS` to determine which gap(s) to implement (S1-S6).
S1 and S2 are prerequisites for S3-S6.

## Step 2: Read target files

Read the files listed in the gap's "Where" section.

## Step 3: Implement the integration

Apply the code changes described in the gap implementation section.

## Step 4: Write tests

Write or update tests for the modified files. For middleware changes,
test that `newrelic.noticeError` is called with the correct arguments.
Mock the `newrelic` module in tests.

## Step 5: Verify

```bash
# Typecheck
pnpm tsc --noEmit -p tsconfig.check.json

# Run tests for modified files
pnpm vitest run <modified-test-files>

# Verify NR integration detected
npx tsx scripts/AST/ast-query.ts nr-server <modified-files> --pretty

# Verify error flow improved
npx tsx scripts/AST/ast-query.ts error-flow <modified-files> --pretty
```
