import { test, expect } from '@playwright/test';

test('emulator login with email and password', async ({ page }) => {
  await page.goto('/login');
  await page.route('**/api/auth/emulator', route => route.fulfill({ json: { token: 'fake-jwt', uid: 'u1' } }));
  await page.getByLabel('Email').fill('test@test.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Dashboard')).toBeVisible();
});

test('emulator user persists across navigation', async ({ page }) => {
  await page.route('**/api/auth/emulator', route => route.fulfill({ json: { token: 'fake-jwt', uid: 'u1' } }));
  await page.goto('/settings');
  await expect(page.getByText('test@test.com')).toBeVisible();
});
