import { test, expect } from '@playwright/test';

test('displays user email in table', async ({ page }) => {
  await page.goto('/users');
  await page.route('**/api/users', route => route.fulfill({ json: [{ id: '1', email: 'a@b.com' }] }));
  await expect(page.getByText('a@b.com')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
});

test('filters users by role', async ({ page }) => {
  await page.goto('/users');
  await page.route('**/api/users', route => route.fulfill({ json: [{ id: '1', role: 'admin' }] }));
  await page.getByRole('combobox').selectOption('admin');
  await expect(page.getByText('admin')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
});

test('navigates to user detail', async ({ page }) => {
  await page.goto('/users');
  await page.getByText('View').click();
  await expect(page).toHaveURL(/\/users\/\d+/);
});
