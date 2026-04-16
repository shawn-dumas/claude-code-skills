/**
 * Positive fixture for ast-pw-test-parity.
 * Contains all patterns the tool should detect.
 */

import { test, expect } from '../fixture';
import { signInWithEmulator } from '../utils/auth';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await signInWithEmulator(page);
});

test.describe('CRUD operations', () => {
  test('create and delete an item', async ({ page }) => {
    const nav = new NavigationPage(page);
    const users = new UsersPage(page);

    await page.goto('/settings/users');

    await page.route('**/api/users', async route => {
      await route.fulfill({ status: 200, body: '[]' });
    });

    await expect(page.getByRole('heading')).toHaveText('Users');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByTestId('count')).toContainText('10');
  });

  test('edit an item', async ({ page }) => {
    await page.goto('/settings/users/1');

    await expect(page.getByLabel('Name')).toHaveValue('John');
  });
});

test('standalone test outside describe', async ({ page, usersPage }) => {
  await page.route('**/api/teams', async route => {
    await route.fulfill({ status: 200, body: '{}' });
  });

  await page.route(/\/api\/data\/.*/, async route => {
    await route.fulfill({ status: 200 });
  });

  await verifyDashboardLayout(page);
  await usersPage.checkColumns();

  await expect(page.getByText('Dashboard')).toBeVisible();
});
