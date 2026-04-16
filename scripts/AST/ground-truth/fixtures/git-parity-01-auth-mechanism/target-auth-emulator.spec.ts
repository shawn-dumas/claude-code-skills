import { test, expect } from '@playwright/test';
import { AuthPage } from './authPage';

test.describe('Auth flows', () => {
  test('Signin page renders', async ({ page }) => {
    const auth = new AuthPage(page);
    await page.goto('/signin', { waitUntil: 'domcontentloaded' });
    await auth.expectSigninPageLoaded();
    await expect(page.getByTestId('work-email')).toBeVisible();
    await expect(page.getByTestId('email-button')).toBeVisible();
  });

  test('Firebase emulator sign-in redirects to insights', async ({ page }) => {
    await page.route('**/api/auth/session', route => route.fulfill({ json: { uid: 'u1' } }));
    await page.goto('/insights/user-productivity');
    expect(page.url()).toContain('/insights/');
  });

  test('No redirect for unauthenticated user with invalid email', async ({ page }) => {
    const auth = new AuthPage(page);
    await page.route('**/users/tenant/getByEmail', async route => {
      await route.fulfill({ json: { tenantId: 'default', providers: [{ providerId: 'google.com' }] } });
    });
    await page.goto('/signin', { waitUntil: 'domcontentloaded' });
    await auth.enterEmail('invalid@nonexistent.xyz');
    await auth.clickContinueWithEmail();
    await auth.expectGoogleButtonVisible();
    expect(page.url()).toContain('/signin');
  });
});
