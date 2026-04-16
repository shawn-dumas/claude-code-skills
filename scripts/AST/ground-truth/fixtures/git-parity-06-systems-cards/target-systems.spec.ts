import { test, expect } from '@playwright/test';
import { InsightsPage } from './insightsPage';

test.beforeEach(async ({ page }) => {
  await page.goto('/insights/systems');
});

test('cards view renders by default after filter submission', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/systems/overview', route => route.fulfill({ json: [] }));
  await insights.selectTeamAndSubmit();
  await expect(page.getByTestId('system-card')).toBeVisible();
});

test('toggle to table view', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/systems/overview', route => route.fulfill({ json: [] }));
  await insights.selectTeamAndSubmit();
  await page.getByRole('button', { name: 'Table' }).click();
  await insights.expectColumnsVisible(['system-cell', 'users-cell']);
});

test('system card click selects a system and shows pages table', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/systems/overview', route => route.fulfill({ json: [] }));
  await page.route('**/data-api/systems/pages', route => route.fulfill({ json: [] }));
  await insights.selectTeamAndSubmit();
  await page.getByTestId('system-card').first().click();
  await insights.expectColumnsVisible(['page-cell', 'users-cell']);
});

test('sorting USERS column - overview table', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/systems/overview', route => route.fulfill({ json: [] }));
  await insights.selectTeamAndSubmit();
  await page.getByRole('button', { name: 'Table' }).click();
  await insights.assertColumnSortToggles(page.getByRole('button', { name: 'USERS' }), page.getByTestId('users-cell'));
});
