import { test, expect } from '@playwright/test';
import { InsightsPage } from './insightsPage';

test.beforeEach(async ({ page }) => {
  await page.goto('/insights/favorites');
});

test('columns visible and non-null with KPI metrics - Favorites System Aggregate', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/favorite-usage/system-aggregate', route => route.fulfill({ json: [] }));
  await page.route('**/favorite-usage/kpis', route => route.fulfill({ json: {} }));
  await insights.selectTeamAndSubmit();
  await insights.expectColumnsVisibleAndNonNull(['destination-system-cell', 'label-cell']);
  const metricsHeader = page.getByTestId('metric-header');
  await expect(metricsHeader.locator('[title="Unique Users: 5"]')).toBeVisible();
  await expect(metricsHeader.locator('[title="Total Usage: 144"]')).toBeVisible();
});

test('empty state without team selection - Favorites', async ({ page }) => {
  const emptyMessage = page.getByText('Select a team');
  await emptyMessage.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Update' }).click();
  await emptyMessage.waitFor({ state: 'visible' });
});

test('sorting DESTINATION SYSTEM column - Favorites', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/favorite-usage/system-aggregate', route => route.fulfill({ json: [] }));
  await page.route('**/favorite-usage/kpis', route => route.fulfill({ json: {} }));
  await insights.selectTeamAndSubmit();
  await insights.expectColumnsVisibleAndNonNull(['destination-system-cell']);
  await insights.assertColumnSortToggles(
    page.getByRole('button', { name: 'DESTINATION SYSTEM' }),
    page.getByTestId('destination-system-cell'),
  );
});
