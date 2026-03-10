---
name: refactor-playwright-test
description: Audit an existing Playwright integration spec against the current page structure, fix stale selectors, remove hardcoded waits, extract page objects, and align with testing philosophy principles P8 (user outcomes), P9 (determinism), and P10 (cleanup).
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/integration-spec.spec.ts>
---

Refactor the Playwright integration spec at `$ARGUMENTS`. Read the spec, audit it
against the current page structure and testing philosophy, then fix it.

## Background: Playwright integration test conventions

This project uses Playwright with:

- Custom `test` fixture from `integration/fixture.ts` (stealth chromium, persistent context)
- Test IDs from `integration/constants.ts` and `src/constants/testIds.ts`
- Helper functions in `integration/utils/` (auth, insights, general, mock data)
- `page.route()` for network interception in mock-data tests
- Config: Chromium only, 180s timeout, monocart reporter, `integration/tests/` dir
- Two modes: real-auth tests (Okta/OneLogin/Google) and mock-data tests

Relevant testing philosophy principles for integration tests:

- **P8 User Outcomes**: Assert on visible text, roles, states — not DOM structure
- **P9 Determinism**: No flaky waits, mock time if needed, seed data
- **P10 Total Cleanup**: Route handlers cleaned between tests

## Step 1: Read the spec and its target pages

Read the integration spec completely. For each route the spec navigates to:

- Read the corresponding page component in `src/pages/` and its container
  in `src/ui/page_blocks/`
- Record all `data-testid` attributes used in the spec
- Record all `getByRole`, `getByText`, `getByLabel` selectors
- Check whether test IDs referenced in the spec still exist in production

## Step 2: Audit for stale references

### Stale test IDs

For each `getByTestId('some-id')` in the spec:

- Grep the production codebase for `data-testid="some-id"` or
  `testIds.SOME_ID` or the constant from `integration/constants.ts`
- If the test ID no longer exists in any production file: **STALE_SELECTOR**
- If the test ID was renamed: note the new name

### Stale page structure

Check whether the spec's interaction flow still matches the page:

- Tab names changed?
- Button labels changed?
- Form structure changed?
- Modal/panel components added or removed?
- Filter controls changed?

### Stale auth flow

If the spec uses auth utils (`signInAsOKTAAdmin`, etc.):

- Check that the auth flow still works with the current login page structure
- Flag if the spec uses `signInAs*` for a mock-data test that could use
  emulator sign-in instead

## Step 3: Audit for anti-patterns

### Hardcoded waits (flakiness)

Flag every `page.waitForTimeout(N)` -- these are the #1 source of flaky
integration tests. For each:

| Pattern                                        | Replacement                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `waitForTimeout(N)` before element interaction | `element.waitFor({ state: 'visible' })`                                     |
| `waitForTimeout(N)` after navigation           | `page.waitForLoadState('networkidle')` or wait for specific element         |
| `waitForTimeout(N)` for data to load           | Wait for specific data element: `page.getByText('expected text').waitFor()` |

### Repeated setup boilerplate

Check for repeated locator creation across tests. The same `page.getByTestId()`
calls appearing in 5+ tests should be extracted to:

- A `beforeEach` block (for setup locators)
- A helper function (for assertion patterns)
- A page object (for complex pages with many locators)

### Hardcoded mock data with magic user IDs

Flag mock data that uses hardcoded Firebase UIDs as object keys
(e.g., `highlightEventMockData.dnLgyVbftyNsExYqaMYqWb08Klf2`). These
are brittle — if the mock data shape changes, every test breaks. Extract
the user selection to a helper:

```typescript
const user = Object.values(mockData)[0];
```

### Missing `page.unrouteAll()` in cleanup

If the spec uses `page.route()` for network interception, check that
routes are cleaned up between tests. Without cleanup, one test's route
handler leaks into the next.

```typescript
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
```

### Redundant mock-data tests

If the spec has 15+ near-identical tests that differ only in mock data
(common in `mockDataRealTime.spec.ts` pattern), flag for consolidation.
Parameterized tests are better:

```typescript
const eventTypes = [
  { name: 'highlight', data: highlightEventMockData, expected: { ... } },
  { name: 'autofill', data: autofillEventMockData, expected: { ... } },
];

for (const { name, data, expected } of eventTypes) {
  test(`renders ${name} event correctly`, async ({ page }) => {
    // single test body, parameterized
  });
}
```

### Remediation audit checks

These checks address patterns that caused repeated agent failures during
Playwright remediation. Check each one during the audit pass.

| ID | Check | What to verify |
|----|-------|----------------|
| B1 | Sort test accounts for `sortDescFirst` | For every `assertColumnSortToggles` call: read the column definition in the production container. Verify `firstOrder` matches the TanStack toggle cycle (`sortDescFirst: true` = desc-first, `false` = asc-first). Verify the column is not pre-sorted on page load (if so, needs a pre-clear click on a different column first). |
| B2 | Fixture data matches Zod schema | For specs using inline fixture data or `page.route()` interceptors: read the Zod schema for each intercepted API response. Verify no `null` values where schema uses `.optional()` (not `.nullable()`). Verify fixture matches the pre-mapped shape, not the post-mapped UI type. |
| B3 | Modal assertions target visible children | For specs asserting on modals/dialogs: verify assertions target the heading or a visible child, NOT the Dialog wrapper element. Verify "modal closed" assertions wait for the heading to be hidden, not the wrapper. Headless UI Dialog wrappers can have zero dimensions. |
| B4 | CRUD tests call `__reset` in beforeEach | For specs testing create/update/delete: verify `beforeEach` calls the mock server's `__reset` endpoint (`page.request.post('.../api/mock/__reset')`). Without reset, state from previous tests leaks and causes false failures. |
| B5 | Empty array guard in custom assertion helpers | For specs using custom sort/comparison helpers: verify helpers throw on empty input instead of returning vacuous true via `Array.every([])`. Check for `expect(values.length).toBeGreaterThan(0)` before sort assertions. |
| B6 | nuqs URL parameter stability | For specs navigating between tabs/views using nuqs URL params: verify the spec does NOT assume URL params persist across full-page navigations (nuqs Pages Router does not preserve params across `router.push` in some edge cases). If testing URL-param-backed state, verify the spec waits for URL to stabilize before asserting. |
| B7 | Check session history for known flaky tests | Before diagnosing a failing test, query the session database for its run history. A test that passes individually but fails at position 100+ in a long serial run is resource contention, not a code bug. A test that fails only after a specific preceding spec is cross-test pollution. A test that has never passed in any session is a real bug. See build-playwright-test A8 for the exact SQL query. |

## Step 4: Apply fixes

### 4a. Fix stale selectors

- Update test IDs to current names
- Replace removed test IDs with `getByRole` or `getByText` alternatives
- Remove tests for components/features that no longer exist

### 4b. Replace hardcoded waits

Replace every `waitForTimeout` with a specific wait condition. If no
specific condition exists, the test is flaky by design — flag for review.

### 4c. Extract repeated patterns

If the spec has:

- 3+ tests with identical locator setup → extract to `beforeEach` or helper
- 5+ near-identical tests → parameterize
- Complex multi-step flows → extract assertion helpers

### 4d. Add cleanup

```typescript
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
```

### 4e. Fix assertion style (P8)

Replace implementation-detail assertions:

| Before                                                             | After                                     |
| ------------------------------------------------------------------ | ----------------------------------------- |
| `expect(url.endsWith('/path'))`                                    | `await expect(page).toHaveURL(/\/path$/)` |
| `const text = await el.innerText(); expect(text).toBe(...)`        | `await expect(el).toHaveText(...)`        |
| `const visible = await el.isVisible(); expect(visible).toBe(true)` | `await expect(el).toBeVisible()`          |

Prefer Playwright's auto-waiting assertions (`expect(locator).toHaveText()`)
over manual `innerText()` + `expect().toBe()`.

## Step 5: Verify

1. Run ONLY the refactored spec -- never the full suite:
   `bash scripts/run-integration.sh spec integration/tests/<file>.spec.ts`
   Or target specific tests by name:
   `bash scripts/run-integration.sh grep "<test-name>"`
   All tests must pass. If the environment cannot run Playwright (no
   Firebase emulator, no dev server), STOP. Do not commit unverified
   changes to spec files. Report the environment issue and what is
   needed to run.
2. Report: what was stale, what was fixed, what remains flaky, and
   the pass/fail result with counts (not "not run").

## What NOT to do

- Do not change the auth flow (SSO providers, credentials) — those are
  infrastructure concerns.
- Do not add Playwright page objects unless the spec has 20+ unique
  locators. Helper functions are sufficient for most specs.
- Do not remove `test.skip` annotations — those are intentional.
- Do not change `page.route()` mock data shapes -- those are the "fixture"
  for integration tests. If the shape is wrong, the production API changed.
