import { test, expect } from '@playwright/test';
import { UsersPage } from './usersPage';

test('displays user email in table', async ({ page }) => {
  const usersPage = new UsersPage(page);
  await page.goto('/users');
  await page.route('**/api/users', route => route.fulfill({ json: [{ id: '1', email: 'a@b.com' }] }));
  await usersPage.verifyUserRow('a@b.com');
});

test('filters users by role', async ({ page }) => {
  const usersPage = new UsersPage(page);
  await page.goto('/users');
  await page.route('**/api/users', route => route.fulfill({ json: [{ id: '1', role: 'admin' }] }));
  await usersPage.filterByRole('admin');
  await usersPage.verifyUserRow('admin');
});

test('navigates to user detail', async ({ page }) => {
  await page.goto('/users');
  await page.getByText('View').click();
  await expect(page).toHaveURL(/\/users\/\d+/);
});
