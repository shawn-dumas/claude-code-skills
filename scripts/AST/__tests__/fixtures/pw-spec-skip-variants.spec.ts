/**
 * Fixture for skip variant detection in ast-pw-test-parity.
 * Tests: test.skip, test.fixme, test.todo (1-arg and 2-arg forms),
 * describe.skip transitive propagation.
 */

import { test, expect } from '../fixture';

// Direct test.skip with body (2-arg)
test.skip('skipped test with body', async ({ page }) => {
  await page.goto('/skipped');
  await expect(page.getByRole('heading')).toHaveText('Skipped');
});

// Direct test.fixme with body (2-arg)
test.fixme('fixme test with body', async ({ page }) => {
  await page.goto('/fixme');
  await expect(page.getByRole('heading')).toHaveText('Fixme');
});

// Direct test.todo (1-arg, no body)
test.todo('todo test placeholder');

// Normal active test
test('active test', async ({ page }) => {
  await page.goto('/active');
  await expect(page.getByRole('heading')).toHaveText('Active');
});

// describe.skip: all tests inside should be transitively skipped
test.describe.skip('skipped describe block', () => {
  test('inside skipped describe', async ({ page }) => {
    await page.goto('/inside-skipped');
    await expect(page.getByRole('heading')).toHaveText('Inside');
  });

  test('also inside skipped describe', async ({ page }) => {
    await page.goto('/also-inside');
  });
});

// describe.fixme: all tests inside should be transitively skipped
test.describe.fixme('fixme describe block', () => {
  test('inside fixme describe', async ({ page }) => {
    await page.goto('/inside-fixme');
    await expect(page.getByRole('heading')).toHaveText('Fixme');
  });
});
