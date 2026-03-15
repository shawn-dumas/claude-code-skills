/**
 * Helper/POM fixture for ast-test-parity helper inventory.
 * Contains a class with methods that have assertions, and
 * standalone functions with and without assertions.
 */

import { type Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async verifyHeader(): Promise<void> {
    await expect(this.page.getByRole('heading')).toHaveText('Dashboard');
    await expect(this.page.getByRole('navigation')).toBeVisible();
  }

  async clickTab(name: string): Promise<void> {
    await this.page.getByRole('tab', { name }).click();
  }

  async verifyTableData(): Promise<void> {
    await expect(this.page.getByRole('table')).toBeVisible();
    await expect(this.page.getByRole('row')).toHaveCount(10);
    await expect(this.page.getByTestId('total')).toContainText('100');
  }
}

export async function verifyPageLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading')).toBeDefined();
}

export async function navigateToPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
}

export const helperWithArrow = async (page: Page): Promise<void> => {
  await expect(page.getByRole('alert')).toBeVisible();
};
