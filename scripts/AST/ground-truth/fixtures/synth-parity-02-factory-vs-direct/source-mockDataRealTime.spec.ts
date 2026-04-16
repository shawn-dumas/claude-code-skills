import { test, expect } from '@playwright/test';

function testEventType(eventType: string) {
  test(`displays ${eventType} events in feed`, async ({ page }) => {
    await page.goto('/realtime');
    await page.route('**/api/events', route => route.fulfill({ json: [{ type: eventType, ts: Date.now() }] }));
    await expect(page.getByText(eventType)).toBeVisible();
  });
}

testEventType('click');
testEventType('scroll');
testEventType('submit');
testEventType('navigate');
