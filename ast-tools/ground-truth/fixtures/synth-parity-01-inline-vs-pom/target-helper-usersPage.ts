import { expect, type Page } from '@playwright/test';

export class UsersPage {
  constructor(private page: Page) {}

  async verifyUserRow(text: string) {
    await expect(this.page.getByText(text)).toBeVisible();
    await expect(this.page.getByRole('row')).toHaveCount(2);
  }

  async filterByRole(role: string) {
    await this.page.getByRole('combobox').selectOption(role);
  }
}
