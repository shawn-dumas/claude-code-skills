import { expect, type Page } from '@playwright/test';

export class InsightsPage {
  constructor(private page: Page) {}

  async selectFirstUser(): Promise<void> {
    const selectUser = this.page.getByRole('button', { name: 'Select users +' });
    await selectUser.click();
    await this.page.getByRole('option').first().click();
    await this.page.getByTestId('search-button').click();
  }

  async expectColumnsVisible(testIds: string[]): Promise<void> {
    for (const id of testIds) {
      await expect(this.page.getByTestId(id)).toBeVisible();
    }
  }
}
