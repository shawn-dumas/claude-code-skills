import { test, expect } from '@playwright/test';

test('SSO redirect initiates on login button click', async ({ page }) => {
  await page.goto('/sso-entry');
  await page.getByRole('button', { name: 'Sign in with SSO' }).click();
  await expect(page).toHaveURL(/sso\.provider\.com/);
});

test('SSO callback processes token exchange', async ({ page }) => {
  await page.goto('/auth/callback?code=abc123');
  await expect(page.getByText('Welcome')).toBeVisible();
});

test('SSO session timeout redirects to provider', async ({ page }) => {
  await page.goto('/sso-portal');
  await expect(page).toHaveURL(/sso\.provider\.com\/expired/);
});
