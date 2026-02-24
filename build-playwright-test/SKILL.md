---
name: build-playwright-test
description: Generate a Playwright E2E spec for a page route. Uses page.route() for network interception in local mode, fixture data from src/fixtures/, proper wait conditions, and user-centric assertions.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <route-path-or-page-file> [description]
---

Generate a Playwright E2E test for the route or page at `$ARGUMENTS`.

The first token is the route path (e.g., `/insights/productivity`) or the
page file path (e.g., `src/pages/insights/productivity.tsx`). Everything
after the first whitespace is an optional description of what interactions
to test.

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

## Step 2: Survey existing E2E conventions

Read 1-2 existing E2E specs to match conventions:

- `e2e/tests/mockDataRealTime.spec.ts` — mock-data pattern with `page.route()`
- `e2e/tests/screenshot-tripwire.spec.ts` — simple smoke test pattern

Also read:
- `e2e/fixture.ts` — the custom test fixture (stealth chromium, auth setup)
- `e2e/constants.ts` — shared test ID constants
- `e2e/config.ts` — environment config

Match the existing import style, test structure, and helper patterns.

## Step 3: Design the test plan

### Identify API endpoints

From the container's service hooks, list every API endpoint the page calls.
Each endpoint needs a `page.route()` handler with fixture data.

### Identify user flows

List the primary user interactions for this page:

| Priority | Flow type | Example |
|----------|----------|---------|
| P0 | Page loads with data | Smoke test: route → data visible |
| P1 | Filter/form submission | Select team → submit → table updates |
| P2 | Drill-down selection | Click row → detail panel appears |
| P3 | Cross-page navigation | Click "View in X" → navigates to correct route |
| P4 | Edge cases | Empty state, error state, loading state |

### Decide: mock-data or real-auth

- **Mock-data** (preferred for new tests): Uses `page.route()` to intercept
  API calls and return fixture data. No real auth needed. Deterministic.
  Skip in production with `if (BUILD_ENV === 'production') { test.skip(true, '...'); }`.
- **Real-auth**: Tests SSO flow end-to-end. Only for auth-specific tests.
  Uses `signInAs*` helpers from `e2e/utils/authUtils.ts`.

New tests should prefer mock-data unless explicitly testing auth flows.

## Step 4: Generate fixture data for route handlers

For each API endpoint the page calls, prepare fixture data:

```typescript
import { teamFixtures, productivityFixtures } from '@/fixtures';

const mockTeams = teamFixtures.buildMany(3);
const mockProductivity = productivityFixtures.buildMany(10);
```

If no fixture builder exists for a needed type, create inline typed data.
Do NOT import from `e2e/utils/mockData.ts` — that file uses hardcoded
objects with magic UIDs. New tests use the centralized fixture system.

## Step 5: Generate the spec file

Create `e2e/tests/<route-name>.spec.ts`.

### File structure

```typescript
import { test } from '../fixture';
import { expect } from '@playwright/test';
import { BUILD_ENV } from 'e2e/config';
import { signInAsONELOGINAdmin } from 'e2e/utils/authUtils';
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
- Never import mock data from another E2E test file

**No hardcoded waits:**

| Instead of | Use |
|-----------|-----|
| `page.waitForTimeout(8000)` | `element.waitFor({ state: 'visible' })` |
| `page.waitForTimeout(3000)` after click | `await expect(target).toBeVisible()` |
| Sleep after navigation | `page.waitForLoadState('networkidle')` |

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
    await page.route('**/api/endpoint', route =>
      route.fulfill({ body: JSON.stringify(data) })
    );
    await page.getByRole('button', { name: /refresh/i }).click();
    await expect(page.getByText(expected)).toBeVisible();
  });
}
```

## Step 6: Verify

1. Run `npx tsc --noEmit` on the new spec (it imports from `@/fixtures`
   which resolves via vitest aliases — check if Playwright config also
   resolves these, and add a `tsconfig` path if needed).
2. If local mode is available (`NEXT_PUBLIC_LOCAL=true` + `pnpm dev`):
   `pnpm e2e:test:local -- --grep "<test-name>"`
3. Report: file path, test count, verification result.

## What NOT to do

- Do not create page object classes unless the page has 20+ unique locators.
  Helper functions are sufficient for most specs.
- Do not test auth flows in mock-data specs. Auth tests are separate.
- Do not use `page.evaluate()` to read React state or context — that is
  implementation detail testing.
- Do not import from `e2e/utils/mockData.ts` for new tests — use
  `src/fixtures/` builders instead.
- Do not use `page.waitForTimeout()` for anything.
- Do not hardcode Firebase UIDs as object keys in mock data.
