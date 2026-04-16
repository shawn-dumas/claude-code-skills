/**
 * Playwright fixture for ast-vitest-parity.
 * Should be skipped by the tool (imports from @playwright/test).
 */

import { test, expect } from '@playwright/test';

test('loads the page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading')).toHaveText('Dashboard');
});
