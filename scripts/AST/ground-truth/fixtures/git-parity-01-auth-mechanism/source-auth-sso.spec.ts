import { test } from '@playwright/test';

// Real QA spec calls opaque utility functions (signInAsONELOGINAdmin,
// verifyAccessDeniedScreen, etc.) that hide navigation and assertions.
// The parity tool cannot extract signals from opaque helper calls --
// these produce zero assertions, zero route intercepts, zero navigations.

test('Gmail email, flow tenant, member sign in google, access denied', async ({ page }) => {
  // verifySignInPageLoadsCorrectly(page)
  // confirmMappingOfProviders({ page, email, tenant })
  // continueWithGoogleAuth(page, email, password)
  // verifyAccessDeniedScreen(page)
  await page.getByTestId('continue-with-google').click();
  await page.getByTestId('access-denied').waitFor({ state: 'visible' });
});

test('8flow email sign in as admin, okta sso', async ({ page }) => {
  // signInAsOKTAAdmin(page)
  // verifyInsightsPage(page, role)
  await page.getByTestId('continue-with-sso').click();
  await page.getByTestId('insight-table-tab-title').waitFor({ state: 'visible' });
});

test('8flow email, sign in as admin, one login sso', async ({ page }) => {
  // signInAsONELOGINAdmin(page)
  // verifyInsightsPage(page, role)
  await page.getByTestId('continue-with-sso').click();
  await page.getByTestId('insight-table-tab-title').waitFor({ state: 'visible' });
});
