import { test } from '@playwright/test';

test('Expect columns to be visible when filled with data - Systems tab', async ({ page }) => {
  await page.route('**/data-api/systems/overview', route => route.fulfill({ json: [] }));
  await page.route('**/data-api/systems/pages', route => route.fulfill({ json: [] }));
  await page.goto('/insights/systems');
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('system-cell').waitFor({ state: 'visible' });
  await page.getByTestId('users-cell').waitFor({ state: 'visible' });
  await page.getByRole('cell', { name: 'salesforce.com' }).click();
  await page.getByTestId('page-cell').waitFor({ state: 'visible' });
});

test('Expect table to be empty if a team is not selected - Systems tab', async ({ page }) => {
  await page.goto('/insights/systems');
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
  await page.getByTestId('update-button').click();
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
});

test('Test columns sorting - Systems tab', async ({ page }) => {
  await page.route('**/data-api/systems/overview', route => route.fulfill({ json: [] }));
  await page.goto('/insights/systems');
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('system-cell').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'USERS' }).click();
  await page.getByRole('button', { name: 'WORKSTREAMS' }).click();
  await page.getByRole('button', { name: 'ACTIVE TIME' }).click();
  await page.getByRole('button', { name: 'MICROWORKFLOWS' }).click();
});
