## {{FEATURE_NAME}} (`{{BRANCH_NAME}}`)

**Branch:** `{{BRANCH_NAME}}` (branched from `{{BASE_BRANCH}}`)
**Status:** Frontend complete (mocked mode only). BFF stubs return 501.
**Cleanup file:** [FILL IN if applicable]

### What exists today

[FILL IN: Brief description of the feature's UI and data flow.]

### BFF endpoints that need to be built

All endpoints below exist as stub routes returning 501 with middleware
chains. Each needs a real implementation with ClickHouse queries.

{{ENDPOINT_GROUPS}}

### Zod schemas (already built)

{{SCHEMA_INVENTORY}}

### Mock routes (already built)

{{MOCK_ROUTE_COUNT}} mock routes exist under `src/pages/api/mock/`
and serve fixture data. These are the reference implementation for what
the BFF endpoints should return.

{{MOCK_ROUTE_LIST}}

### Frontend changes needed when BFF is implemented

[FILL IN: Changes needed when stubs become real endpoints.]

### ClickHouse table/view requirements

[FILL IN: Required ClickHouse schema for the queries. Register all queries
in `src/server/db/queries.ts` (CH_QUERIES registry) and run
`npx tsx scripts/codegen-ch-types.ts` to generate row types in
`queries.generated.ts`. See AGENTS.md "ClickHouse Type Codegen" section.]

### Production readiness checklist

- [ ] ClickHouse tables/views exist with required columns
      {{CHECKLIST_ENDPOINTS}}
- [ ] Co-located `*.schema.ts` request body schemas for each endpoint
- [ ] Multi-tenancy: all queries scoped to `ctx.organizationId`
      {{CHECKLIST_COLLAPSE}}
- [ ] Vitest API integration tests for all endpoints
- [ ] Playwright integration tests updated
- [ ] Feature flag gating (if shipping incrementally)
- [ ] PR review against `REVIEW.md` criteria
- [ ] Performance: ClickHouse query latency under 2s for each endpoint
- [ ] Error handling: all endpoints return structured error responses via `withErrorHandler`

### Files with TODO(blocked) comments

{{TODO_BLOCKED_FILES}}
