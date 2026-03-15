import { test, expect } from '@playwright/test';
import { InsightsPage } from './insightsPage';

test.beforeEach(async ({ page }) => {
  await page.goto('/insights/microworkflows');
});

test('overview table columns are visible with data', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/microworkflows/overview', route => route.fulfill({ json: [] }));
  await insights.selectTeamAndSubmit();
  await insights.expectColumnsVisible(['microworkflow-type-cell', 'source-system-cell']);
});

test('drill-down to by-user table shows correct columns', async ({ page }) => {
  const insights = new InsightsPage(page);
  await page.route('**/data-api/microworkflows/overview', route => route.fulfill({ json: [] }));
  await page.route('**/data-api/microworkflows/by-user', route => route.fulfill({ json: [] }));
  await insights.selectTeamAndSubmit();
  await page.getByRole('cell', { name: 'autofill@8flow.com' }).click();
  await insights.expectColumnsVisible(['user-email-cell', 'name-cell']);
});

test('empty table state when overview returns no data', async ({ page }) => {
  const emptyMessage = page.getByText('Select a team');
  await emptyMessage.waitFor({ state: 'visible' });
  await page.route('**/data-api/microworkflows/overview', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('microworkflow-type-cell').waitFor({ state: 'visible' });
});
