import { test, expect } from '@playwright/test';

interface CrudConfig {
  entityLabel: string;
  settingsTab: string;
  cellTestId: string;
  existingEntityName: string;
}

export function defineSettingsCrudTests({ entityLabel }: CrudConfig): void {
  test.describe.configure({ mode: 'serial' });

  test(`Create ${entityLabel}, delete ${entityLabel}`, async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('add-bpo-button').click();
    await page.getByTestId('bpo-name-input').fill('Test');
    await page.getByTestId('submit-button').click();
    await expect(page.getByRole('cell', { name: 'Test' })).toBeVisible();
    await page.getByTestId('delete-bpo-button').click();
  });

  test(`Create ${entityLabel}, edit ${entityLabel} name, delete ${entityLabel}`, async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('add-bpo-button').click();
    await page.getByTestId('bpo-name-input').fill('Original');
    await page.getByTestId('submit-button').click();
    await page.getByTestId('edit-bpo-button').click();
    await page.getByTestId('bpo-name-input').fill('Edited');
    await expect(page.getByRole('cell', { name: 'Edited' })).toBeVisible();
  });

  test(`Unable to create blank ${entityLabel}s`, async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('add-bpo-button').click();
    await page.getByTestId('bpo-name-input').fill('   ');
    await expect(page.getByTestId('submit-button')).toBeDisabled();
  });
}
