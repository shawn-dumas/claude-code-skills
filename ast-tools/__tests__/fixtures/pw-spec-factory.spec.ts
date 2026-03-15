/**
 * Factory-pattern fixture for ast-pw-test-parity.
 * Tests that a wrapper function calling test() with a template literal
 * name is expanded into individual test blocks per invocation.
 */

import { test, expect } from '../fixture';

function testEventType(name: string, data: Record<string, unknown>) {
  test(`event: ${name}`, async ({ page }) => {
    await page.route('**/api/events', async route => {
      await route.fulfill({ status: 200, body: JSON.stringify(data) });
    });

    await expect(page.getByRole('cell')).toBeVisible();
    await expect(page.getByRole('cell')).toHaveText(name);
  });
}

testEventType('click', { type: 'click' });
testEventType('hover', { type: 'hover' });
testEventType('scroll', { type: 'scroll' });

test('standalone sorting test', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('table')).toBeVisible();
});
