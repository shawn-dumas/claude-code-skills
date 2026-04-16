import { expect, type Page } from '@playwright/test';

export class InsightsPage {
  constructor(private page: Page) {}

  async selectTeamAndSubmit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Select team' }).click();
    await this.page.getByRole('option').first().click();
    await this.page.getByTestId('update-button').click();
  }

  async expectColumnsVisible(testIds: string[]): Promise<void> {
    for (const id of testIds) {
      await expect(this.page.getByTestId(id)).toBeVisible();
    }
  }

  async assertColumnSortToggles(
    button: import('@playwright/test').Locator,
    cell: import('@playwright/test').Locator,
  ): Promise<void> {
    await button.click();
    await expect(cell.first()).toBeVisible();
    await button.click();
    await expect(cell.first()).toBeVisible();
  }
}
