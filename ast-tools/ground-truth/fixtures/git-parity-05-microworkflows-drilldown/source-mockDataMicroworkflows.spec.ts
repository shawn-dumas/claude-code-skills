import { test } from '@playwright/test';

test('Expect columns to be visible when filled with data - Systems tab', async ({ page }) => {
  await page.route('**/data-api/microworkflows/overview', route => route.fulfill({ json: [] }));
  await page.route('**/data-api/microworkflows/by-user', route => route.fulfill({ json: [] }));
  await page.goto('/insights/microworkflows');
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('microworkflow-type-cell').waitFor({ state: 'visible' });
  await page.getByTestId('source-system-cell').waitFor({ state: 'visible' });
  await page.getByRole('cell', { name: 'autofill@8flow.com' }).click();
  await page.getByTestId('user-email-cell').waitFor({ state: 'visible' });
  await page.getByRole('cell', { name: 'autofill@8flow.com' }).click();
  await page.getByTestId('timestamp-cell').waitFor({ state: 'visible' });
});

test('Expect table to be empty if a team is not selected - Systems tab', async ({ page }) => {
  await page.goto('/insights/microworkflows');
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
  await page.getByTestId('update-button').click();
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
  await page.route('**/data-api/microworkflows/overview', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Select team' }).click();
  await page.getByTestId('update-button').click();
  await page.getByTestId('microworkflow-type-cell').waitFor({ state: 'visible' });
  await page.reload();
  await page.getByTestId('not-found-message').waitFor({ state: 'visible' });
});
