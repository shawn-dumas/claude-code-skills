import { test, expect } from '@playwright/test';

test('Expect columns to be visible when filled with data - Workstreams tab', async ({ page }) => {
  await page.goto('/insights/workstreams');
  await page.route('**/data-api/analyzer/workstreams', async route => {
    await route.fulfill({ json: [{ user: 'dustin@8flow.com', workstream: 'dev' }] });
  });
  const selectUser = page.getByRole('button', { name: 'Select users +' });
  await selectUser.click();
  await page.getByRole('option').first().click();
  await page.getByTestId('search-button').click();
  await expect(page.getByTestId('user-cell')).toBeVisible();
  await expect(page.getByTestId('workstream-cell')).toBeVisible();
  await page.getByRole('cell', { name: 'dustin@8flow.com' }).click();
  await expect(page.getByTestId('action-cell')).toBeVisible();
});

test('Expect table to be empty if a team is not selected - Workstreams tab', async ({ page }) => {
  await page.goto('/insights/workstreams');
  const searchButton = page.getByTestId('search-button');
  const emptyMessage = page.getByText('Select a user or workstream');
  await searchButton.waitFor({ state: 'visible' });
  await emptyMessage.waitFor({ state: 'visible' });
  await searchButton.click();
  await emptyMessage.waitFor({ state: 'visible' });
  await page.route('**/data-api/analyzer/workstreams', async route => {
    await route.fulfill({ json: [{ user: 'dustin@8flow.com' }] });
  });
  const selectUser = page.getByRole('button', { name: 'Select users +' });
  await selectUser.click();
  await page.getByRole('option').first().click();
  await searchButton.click();
  await expect(page.getByTestId('user-cell')).toBeVisible();
});
