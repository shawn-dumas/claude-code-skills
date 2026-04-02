/**
 * Fixture for ast-pw-test-parity: exercises isFileSkipGuard detection.
 * test.skip(true) / test.skip(false) are file-level skip guards that
 * should be filtered out when extracting test blocks.
 */

import { test, expect } from '@playwright/test';

// This is a file-level skip guard -- should be ignored by the extractor
test.skip(true);

test('this test should still be extracted', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading')).toBeVisible();
});

test('another test in the file', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByText('Settings')).toBeVisible();
});
