---
name: build-playwright-test
description: Generate a Playwright integration spec for a page route. Uses page.route() for network interception with fixture data from src/fixtures/, proper wait conditions, and user-centric assertions.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <route-path-or-page-file> [description]
---

Generate a Playwright integration test for the route or page at `$ARGUMENTS`.

The first token is the route path (e.g., `/insights/productivity`) or the
page file path (e.g., `src/pages/insights/productivity.tsx`). Everything
after the first whitespace is an optional description of what interactions
to test.

## Step 0: Run AST analysis on the page and container

After identifying the page and container files (see Step 1), run:

```bash
npx tsx scripts/AST/ast-data-layer.ts <container-path> --pretty
npx tsx scripts/AST/ast-react-inventory.ts <container-path> --pretty
npx tsx scripts/AST/ast-interpret-ownership.ts <container-path> --pretty
```

Use data-layer observations to systematically identify every API endpoint
the page calls:

- `API_ENDPOINT` observations list the endpoints to intercept with `page.route()`
- `QUERY_HOOK_DEFINITION` and `MUTATION_HOOK_DEFINITION` observations show
  which service hooks the container uses

Use react-inventory to extract component and hook observations:

- `COMPONENT_DECLARATION` and `PROP_FIELD` observations show what props
  flow from container to children
- `HOOK_CALL` observations enumerate which hooks the container calls

Use ast-interpret-ownership to verify the container classification:

- `CONTAINER` assessment confirms this is the data orchestration boundary
- Hook assessments (`LIKELY_SERVICE_HOOK`, `LIKELY_CONTEXT_HOOK`) identify
  which hooks drive the page's data flow

## Step 1: Map the route to its page and container

If given a route path, find the corresponding:

- Page file in `src/pages/` (Next.js Pages Router file-based routing)
- Container in `src/ui/page_blocks/` (the page file imports it)
- Sub-components the container renders

If given a page file path, derive the route from the file system path.

Read the container to understand:

- What data the page fetches (service hooks, API endpoints)
- What user interactions are possible (filters, tables, drill-downs, nav)
- What test IDs exist (`data-testid` attributes)
- What loading/error/empty states exist

## Step 2: Survey existing integration test conventions

Read 1-2 existing integration specs to match conventions:

- `integration/tests/mockDataRealTime.spec.ts` -- mock-data pattern with `page.route()`
- `integration/tests/screenshot-tripwire.spec.ts` -- simple smoke test pattern

Also read:

- `integration/fixture.ts` -- the custom test fixture (stealth chromium, auth setup)
- `integration/constants.ts` -- shared test ID constants
- `integration/config.ts` -- environment config

Match the existing import style, test structure, and helper patterns.

## Step 3: Design the test plan

### Identify API endpoints

From the container's service hooks, list every API endpoint the page calls.
Each endpoint needs a `page.route()` handler with fixture data.

### Identify user flows

List the primary user interactions for this page:

| Priority | Flow type              | Example                                        |
| -------- | ---------------------- | ---------------------------------------------- |
| P0       | Page loads with data   | Smoke test: route → data visible               |
| P1       | Filter/form submission | Select team → submit → table updates           |
| P2       | Drill-down selection   | Click row → detail panel appears               |
| P3       | Cross-page navigation  | Click "View in X" → navigates to correct route |
| P4       | Edge cases             | Empty state, error state, loading state        |

### Decide: mock-data or real-auth

- **Mock-data** (preferred for new tests): Uses `page.route()` to intercept
  API calls and return fixture data. No real auth needed. Deterministic.
  Skip in production with `if (BUILD_ENV === 'production') { test.skip(true, '...'); }`.
- **Real-auth**: Tests SSO flow through the full auth boundary. Only for auth-specific tests.
  Uses `signInAs*` helpers from `integration/utils/authUtils.ts`.

New tests should prefer mock-data unless explicitly testing auth flows.

## Step 4: Generate fixture data for route handlers

For each API endpoint the page calls, prepare fixture data:

```typescript
import { teamFixtures, productivityFixtures } from '@/fixtures';

const mockTeams = teamFixtures.buildMany(3);
const mockProductivity = productivityFixtures.buildMany(10);
```

If no fixture builder exists for a needed type, create inline typed data.
Do NOT import from `integration/utils/mockData.ts` -- that file uses hardcoded
objects with magic UIDs. New tests use the centralized fixture system.

## Step 5: Generate the spec file

Create `integration/tests/<route-name>.spec.ts`.

### File structure

```typescript
import { test } from '../fixture';
import { expect } from '@playwright/test';
import { BUILD_ENV } from 'integration/config';
import { signInAsONELOGINAdmin } from 'integration/utils/authUtils';
// Import from centralized fixtures for mock data
import { teamFixtures, productivityFixtures } from '@/fixtures';

if (BUILD_ENV === 'production') {
  test.skip(true, 'Mock-data tests do not run in production');
}

// ── Mock data ──────────────────────────────────────────────────────────

const mockTeams = teamFixtures.buildMany(3);
// ... other fixture data

// ── Setup / teardown ───────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Intercept API calls with fixture data
  await page.route('**/api/endpoint', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockTeams),
    });
  });

  // Sign in and navigate
  await signInAsONELOGINAdmin(page);
  await page.goto('/route-path');
  await page.waitForLoadState('networkidle');
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// ── Tests ──────────────────────────────────────────────────────────────

test('page loads and displays data', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /page title/i })).toBeVisible();
  await expect(page.getByText(mockTeams[0].name)).toBeVisible();
});

test('filter submission updates table', async ({ page }) => {
  // Interact with filters
  await page.getByRole('button', { name: /select team/i }).click();
  await page.getByLabel(mockTeams[0].name).click();
  await page.getByRole('button', { name: /update/i }).click();

  // Verify table updated
  await expect(page.getByText('expected-data')).toBeVisible();
});
```

### Rules

**P8 — User Outcomes:**

- Use Playwright auto-waiting assertions: `await expect(locator).toBeVisible()`
- Prefer `getByRole` > `getByText` > `getByLabel` > `getByTestId`
- Never assert on DOM structure, CSS classes, or implementation details
- Use `toHaveURL()` for navigation assertions, not `page.url().includes()`
- Use `toHaveText()` not `innerText()` + `toBe()`

**P9 — Determinism:**

- NEVER use `page.waitForTimeout()` — always wait for a specific condition
- Use `page.waitForLoadState('networkidle')` after navigation
- Use `element.waitFor({ state: 'visible' })` before interaction
- All mock data comes from seeded fixtures — no `Math.random()` or `Date.now()`
- Pin timezone if time-dependent: `test.use({ timezoneId: 'America/Los_Angeles' })`

**P10 — Total Cleanup:**

- `test.afterEach` must call `page.unrouteAll({ behavior: 'ignoreErrors' })`
- If the test writes to localStorage via the page, clear it in afterEach

**Data Ownership:**

- Each spec file owns its mock data (defined at file scope)
- Use fixture builders, not hardcoded objects with magic UIDs
- Never import mock data from another integration test file

**No hardcoded waits:**

| Instead of                              | Use                                     |
| --------------------------------------- | --------------------------------------- |
| `page.waitForTimeout(8000)`             | `element.waitFor({ state: 'visible' })` |
| `page.waitForTimeout(3000)` after click | `await expect(target).toBeVisible()`    |
| Sleep after navigation                  | `page.waitForLoadState('networkidle')`  |

**Parameterize repetitive tests:**

If the same interaction with different data produces 5+ near-identical tests,
use a data-driven loop:

```typescript
const cases = [
  { name: 'highlight', data: buildRealtimeEvent('highlight'), expected: 'Highlighted on' },
  { name: 'click', data: buildRealtimeEvent('click'), expected: 'Clicked on' },
];

for (const { name, data, expected } of cases) {
  test(`renders ${name} event`, async ({ page }) => {
    await page.route('**/api/endpoint', route => route.fulfill({ body: JSON.stringify(data) }));
    await page.getByRole('button', { name: /refresh/i }).click();
    await expect(page.getByText(expected)).toBeVisible();
  });
}
```

## Patterns from Production

These patterns were extracted from 6 work agent sessions that remediated
~178 Playwright integration tests. Each pattern caused multiple agents to
waste significant diagnostic time when not documented.

**A1. TanStack Table sort behavior with `sortDescFirst`**

Before writing sort assertions, READ the column definition in the
production container. The `firstOrder` parameter must match the TanStack
toggle cycle for that column:

- `sortDescFirst: true` (default for numeric): unsorted -> desc -> asc -> unsorted
- `sortDescFirst: false` (default for string): unsorted -> asc -> desc -> unsorted
- If a column has `initialSorting` set (e.g., to desc), the first
  click toggles to the NEXT state in the cycle, not the first state

Do NOT guess `firstOrder` based on column type alone. Read the actual
column definition.

**A2. Pre-clear initial sort before sort assertions**

If a column starts pre-sorted on page load, click a DIFFERENT column
first to clear the initial sort, then click back to the target column.
The `assertColumnSortToggles` helper expects the column to start
unsorted.

**A3. Headless UI Dialog visibility**

Target the dialog HEADING for visibility assertions, not
`getByRole('dialog')`. Headless UI renders its Dialog wrapper with
`position: fixed` and potentially zero dimensions. The heading is the
reliable visibility indicator:

```typescript
const heading = page.getByRole('heading', { name: 'Edit URLs' });
await heading.waitFor({ state: 'visible' });
// ... interact ...
await heading.waitFor({ state: 'hidden' }); // dialog closed
```

**A4. Zod schema validation silently drops data**

Fixture data passed via `page.route()` still goes through the app's
Zod `.parse()` layer. If fixture data does not match the Zod schema
exactly, records are silently dropped:

- `null` for a field using `.optional()` (not `.nullable()`) causes
  the record to be dropped
- Fixture shaped as the post-mapped type (e.g., `MappedUserStats`)
  when the Zod schema expects the pre-mapped type (e.g., `UserStats`)
  causes all records to be dropped

Always read the Zod schema file before writing fixture data.

**A5. Ambiguous locator resolution**

When Playwright's strict mode reports "resolved to N elements":

- Use `{ exact: true }` when the button label is a substring of
  another label (e.g., "PRODUCTIVE TIME/DAY" vs "UNPRODUCTIVE TIME/DAY")
- Use `.first()` when the same element appears in multiple sub-tables
- Scope locators to a parent container (`panel.getByRole(...)`) when
  possible

**A6. Guard against pagination in sort assertions**

`assertColumnSortToggles` reads `allInnerTexts()`, which only returns
rendered cells. If the table is paginated:

- Call `selectAllPageSize()` before sort assertions to show all rows
- Only skip `selectAllPageSize()` when the fixture data is smaller
  than the default page size

**A7. Guard against vacuous truth in sort helpers**

Custom sort helpers (`isChronologicalDurations`, `isNumericSorted`,
etc.) return `true` for empty arrays via `Array.every([])`. Add a
length guard:

```typescript
expect(values.length).toBeGreaterThan(0);
```

Add this before every `toPass()` block that checks sort order.

**A8. Check session history before chasing a test failure**

When a test fails and the cause is not immediately obvious, query the
OpenCode/Claude session database for prior runs of that test before
assuming it is a code problem:

```sql
-- Find all runs of a specific test (pass and fail)
SELECT
  substr(json_extract(data, '$.state.output'), -400) as tail,
  json_extract(data, '$.state.metadata.exit') as exit_code,
  datetime(time_created/1000, 'unixepoch', 'localtime') as ts,
  p.session_id
FROM part p
WHERE json_extract(data, '$.type') = 'tool'
  AND json_extract(data, '$.tool') = 'bash'
  AND json_extract(data, '$.state.status') = 'completed'
  AND data LIKE '%test name or grep pattern%'
ORDER BY time_created;
```

Look for:

- Does it fail only during long serial runs (position 100+)?
  That is resource contention, not a code bug.
- Does it fail only when preceded by a specific other spec?
  That is cross-test state pollution.
- Does it fail intermittently with the same error regardless
  of context? That is a genuine flaky test (timing, race condition).
- Has it ever passed? If it has never passed in any session, it is
  likely a real bug, not flakiness.

This avoids wasting diagnostic cycles on known intermittent failures.
The database at `~/.local/share/opencode/opencode.db` (or
`~/.local/share/Claude/Claude.db` for Claude Code) contains the full
history of every command run in every session.

## Step 6: Verify

1. Run `npx tsc --noEmit` on the new spec (it imports from `@/fixtures`
   which resolves via vitest aliases -- check if Playwright config also
   resolves these, and add a `tsconfig` path if needed).
2. Run `npx tsx scripts/AST/ast-complexity.ts <new-spec-file> --pretty`.
   Every function must have cyclomatic complexity <= 10. If any function
   exceeds 10, decompose it before proceeding.
3. Run `npx tsx scripts/AST/ast-type-safety.ts <new-spec-file> --pretty`.
   Zero `as any` casts. Non-null assertions are acceptable only with a
   comment explaining why the value is guaranteed non-null. Note:
   Playwright's `page.evaluate()` return values sometimes require type
   assertions -- use `as unknown as T` with a comment, not `as any`.
4. Run ONLY the new spec -- never the full suite:
   `bash scripts/run-integration.sh spec integration/tests/<new-file>.spec.ts`
   Or target specific tests by name:
   `bash scripts/run-integration.sh grep "<test-name>"`
   All tests must pass. If the environment cannot run Playwright (no
   Firebase emulator, no dev server), STOP. Do not commit unverified
   test files. Report the environment issue and what is needed to run.
5. Report: file path, test count, verification result (pass/fail with
   counts, not "not run").

## What NOT to do

- Do not create page object classes unless the page has 20+ unique locators.
  Helper functions are sufficient for most specs.
- Do not test auth flows in mock-data specs. Auth tests are separate.
- Do not use `page.evaluate()` to read React state or context — that is
  implementation detail testing.
- Do not import from `integration/utils/mockData.ts` for new tests -- use
  `src/fixtures/` builders instead.
- Do not use `page.waitForTimeout()` for anything.
- Do not hardcode Firebase UIDs as object keys in mock data.
