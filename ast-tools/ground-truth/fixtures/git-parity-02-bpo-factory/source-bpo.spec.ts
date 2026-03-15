import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Create BPO, Delete BPO', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('add-bpo-button').click();
  await page.getByTestId('bpo-name-input').fill('Test BPO');
  await page.getByTestId('submit-button').click();
  await expect(page.getByRole('cell', { name: 'Test BPO' })).toBeVisible();
  await page.getByRole('row', { name: 'Test BPO' }).getByRole('checkbox').check();
  await page.getByTestId('delete-bpo-button').click();
});

test('Create BPO, Edit BPO Name, Delete BPO', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('add-bpo-button').click();
  await page.getByTestId('bpo-name-input').fill('Original');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('edit-bpo-button').click();
  await page.getByTestId('bpo-name-input').fill('Edited');
  await page.getByTestId('submit-button').click();
  await expect(page.getByRole('cell', { name: 'Edited' })).toBeVisible();
});

test('Unable to create blank bpos', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('add-bpo-button').click();
  await page.getByTestId('bpo-name-input').fill('   ');
  await page.getByTestId('submit-button').click();
  await expect(page.getByTestId('bpo-name-input')).toBeVisible();
});
