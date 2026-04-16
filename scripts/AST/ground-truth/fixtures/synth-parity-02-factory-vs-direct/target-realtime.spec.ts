import { test, expect } from '@playwright/test';

test('displays click events in feed', async ({ page }) => {
  await page.goto('/realtime');
  await page.route('**/api/events', route => route.fulfill({ json: [{ type: 'click', ts: Date.now() }] }));
  await expect(page.getByText('click')).toBeVisible();
});

test('displays scroll events in feed', async ({ page }) => {
  await page.goto('/realtime');
  await page.route('**/api/events', route => route.fulfill({ json: [{ type: 'scroll', ts: Date.now() }] }));
  await expect(page.getByText('scroll')).toBeVisible();
});

test('displays submit events in feed', async ({ page }) => {
  await page.goto('/realtime');
  await page.route('**/api/events', route => route.fulfill({ json: [{ type: 'submit', ts: Date.now() }] }));
  await expect(page.getByText('submit')).toBeVisible();
});

test('displays navigate events in feed', async ({ page }) => {
  await page.goto('/realtime');
  await page.route('**/api/events', route => route.fulfill({ json: [{ type: 'navigate', ts: Date.now() }] }));
  await expect(page.getByText('navigate')).toBeVisible();
});
