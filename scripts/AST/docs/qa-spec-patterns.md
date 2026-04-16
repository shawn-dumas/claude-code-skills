# QA Spec Structural Patterns

How the QA E2E specs (production branch, `e2e/tests/`) are structured,
and why this matters for the AST parity tool.

## Overview

The QA specs follow a helper-heavy pattern where most Playwright API calls
are wrapped in utility functions and POM methods. Tests read as high-level
behavioral scripts rather than sequences of locator interactions.

This has direct consequences for the parity tool: most structural signals
(assertions, navigations, route intercepts) are hidden inside opaque
function calls that the observation layer cannot decompose.

## Utility function pattern

QA specs import standalone utility functions from `e2e/utils/`:

```ts
import { signInAsONELOGINAdmin } from 'e2e/utils/authUtils';
import { verifyInsightsPage, selectInsightsTab } from 'e2e/utils/insightsUtils';
import { switchSettingsTab } from 'e2e/utils/generalUtils';
```

A typical test body:

```ts
test('Admin can view insights', async ({ page }) => {
  await signInAsONELOGINAdmin(page);
  await verifyInsightsPage(page, 'admin');
});
```

This test has:
- **0 assertions** (the `expect()` calls are inside `verifyInsightsPage`)
- **0 route intercepts** (mock data setup is in a separate fixture or helper)
- **0 navigations** (`page.goto()` is inside `signInAsONELOGINAdmin`)
- **0 POM usage** (no `new XxxPage()`)
- **2 helper delegations** (the two function calls)

The observation layer records the function names as helper delegations but
cannot extract their internal signals.

## Contrast with integration specs

The integration specs (`integration/tests/`) use a POM-based pattern with
inline assertions and route intercepts:

```ts
test('Admin can view insights', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/api/insights/**', route => route.fulfill({ json: mockData }));
  await page.goto('/insights/user-productivity');
  await insights.expectColumnsVisible(['user-cell', 'team-cell']);
});
```

This test has:
- **1+ assertions** (via POM, resolved from helper index)
- **1 route intercept** (`page.route()`)
- **1 navigation** (`page.goto()`)
- **1 POM usage** (`new InsightsPage()`)

The structural signal density is much higher.

## Weight implications

Given the same behavioral coverage, a QA spec test will have a much lower
weight than its integration counterpart:

| Signal             | QA test (opaque helpers) | Integration test (inline + POM) |
| ------------------ | ------------------------ | ------------------------------- |
| Assertions         | 0                        | 3 (via POM resolution)          |
| Route intercepts   | 0                        | 1 (weight: 2)                   |
| Navigations        | 0                        | 1                               |
| POM usages         | 0                        | 1                               |
| Helper delegations | 2 (weight: 3 each = 6)  | 0                               |
| **Total weight**   | **6**                    | **7**                           |

The helper delegation flat weight of 3 partially compensates, but without
a helper index for the QA utilities, the tool cannot know how many
assertions are inside `verifyInsightsPage`.

## What this means for fixture authoring

When creating parity fixtures from real QA specs:

1. **Do not inline assertions.** If the real test calls
   `verifyInsightsPage(page, role)`, write an opaque function call in the
   fixture, not three inline `expect()` calls.

2. **Do not inline navigations.** If the real test calls
   `signInAsONELOGINAdmin(page)` which internally does `page.goto('/signin')`,
   do not add `page.goto()` to the fixture source. The parity tool would
   see a navigation signal that does not exist in the real code.

3. **Use locator actions for filler.** Real QA tests do have inline
   locator interactions (`getByTestId().click()`, `getByRole().fill()`).
   These produce zero signal and are safe to include for realism without
   affecting the weight calculation.

4. **Route intercepts are rare in QA specs.** The QA suite uses mock data
   fixtures passed through the Playwright test fixture system, not inline
   `page.route()` calls. Most QA tests have zero route intercepts.

## Auth pattern differences

The QA and integration suites use fundamentally different auth mechanisms:

| Aspect              | QA (production branch)                    | Integration                          |
| ------------------- | ----------------------------------------- | ------------------------------------ |
| Auth provider       | OneLogin SSO, Okta SAML, Google OAuth     | Firebase emulator                    |
| Sign-in function    | `signInAsONELOGINAdmin(page)`             | `signInWithEmulator(page, path)`     |
| Test scope          | Full SSO redirect flows                   | Emulated auth state injection        |
| Route intercepts    | None (real SSO endpoints)                 | `page.route('**/api/auth/**', ...)`  |
| Access denied tests | Navigate through SSO, verify denied page  | Not present (emulator skips authz)   |

SSO-specific tests (Okta SAML, Google OAuth, OneLogin redirect flows)
have no structural equivalent in the integration suite. The parity tool
should classify these as `NOT_PORTED`.

## POM conventions

Integration specs use Page Object Model classes following the `XxxPage`
naming convention:

- `AuthPage`, `InsightsPage`, `UsersPage`, `TeamsPage`, `NavigationPage`,
  `SettingsPage`, `RealtimePage`
- All live in `integration/pages/`
- Constructor takes `page: Page`
- Methods wrap locator chains, assertions, and route setup
- Methods containing `expect()` calls have their assertion counts indexed
  by the helper analysis
- The interpreter uses `resolveHelperWeight` with fuzzy class matching to
  bridge variable names (e.g., `insights.verifyExport`) to indexed class
  methods (e.g., `InsightsPage.verifyExport`), recovering actual assertion
  counts for weight calculation

QA specs do not use POM classes. They use standalone utility functions from
`e2e/utils/` which serve the same purpose but are not detected as POM
usage by the observation layer. Both QA and integration helpers are indexed
when their directories are listed in `helperDirs` config.
