import { test, expect } from '@playwright/test';
import { InsightsPage } from './insightsPage';

test.beforeEach(async ({ page }) => {
  await page.goto('/insights/workstreams');
});

test('Expect columns to be visible when filled with data - Workstreams tab', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/analyzer/workstreams', async route => {
    await route.fulfill({ json: [{ user: 'dustin@8flow.com', workstream: 'dev' }] });
  });
  await page.route('**/data-api/analyzer/activity-timeline', async route => {
    await route.fulfill({ json: [{ action: 'click', timestamp: '2026-01-01' }] });
  });
  await insights.selectFirstUser();
  await insights.expectColumnsVisible(['user-cell', 'workstream-cell']);
  await page.getByRole('cell', { name: 'dustin@8flow.com' }).click();
  await insights.expectColumnsVisible(['action-cell', 'timestamp-cell']);
});

test('Expect table to be empty if a team is not selected - Workstreams tab', async ({ page }) => {
  const insights = new InsightsPage(page);
  const searchButton = page.getByTestId('search-button');
  const emptyMessage = page.getByText('Select a user or workstream');
  await searchButton.waitFor({ state: 'visible' });
  await emptyMessage.waitFor({ state: 'visible' });
  await page.route('**/data-api/analyzer/workstreams', async route => {
    await route.fulfill({ json: [{ user: 'dustin@8flow.com' }] });
  });
  await insights.selectFirstUser();
  await insights.expectColumnsVisible(['user-cell']);
  await page.goto('/insights/workstreams');
  await emptyMessage.waitFor({ state: 'visible' });
});
