import { test, expect } from '@playwright/test';

test('Expect columns to be visible when filled with data - Favorites Usage tab', async ({ page }) => {
  await page.route('**/favorite-usage/system-aggregate', route => route.fulfill({ json: [] }));
  await page.route('**/favorite-usage/kpis', route => route.fulfill({ json: {} }));
  await page.goto('/insights/favorites');
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('destination-system-cell').waitFor({ state: 'visible' });
  const metricsHeader = page.getByTestId('metric-header');
  await expect(metricsHeader).toHaveText('Unique Users:5Time Saved:34h 25mTotal Usage:4,130');
});

test('Expect table to be empty if a team is not selected - Favorites Usage tab', async ({ page }) => {
  await page.goto('/insights/favorites');
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
  await page.getByTestId('update-button').click();
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
  await page.route('**/favorite-usage/system-aggregate', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('destination-system-cell').waitFor({ state: 'visible' });
  await page.reload();
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
});

test('Test columns sorting - Favorites Usage tab', async ({ page }) => {
  await page.route('**/favorite-usage/system-aggregate', route => route.fulfill({ json: [] }));
  await page.goto('/insights/favorites');
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('destination-system-cell').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'DESTINATION SYSTEM' }).click();
  await page.getByRole('button', { name: 'LABEL' }).click();
  await page.getByRole('button', { name: 'TOTAL USAGE' }).click();
  await page.getByRole('button', { name: 'UNIQUE USERS' }).click();
  await page.getByRole('button', { name: 'TIME SAVED' }).click();
});
