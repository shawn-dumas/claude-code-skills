import { expect, type Page } from '@playwright/test';

export class AuthPage {
  constructor(private page: Page) {}

  async expectSigninPageLoaded(): Promise<void> {
    await this.page.getByTestId('work-email').waitFor({ state: 'visible' });
    await this.page.getByTestId('email-button').waitFor({ state: 'visible' });
  }

  async enterEmail(email: string): Promise<void> {
    await this.page.getByTestId('work-email').fill(email);
  }

  async clickContinueWithEmail(): Promise<void> {
    await this.page.getByTestId('email-button').click();
  }

  async expectGoogleButtonVisible(): Promise<void> {
    await expect(this.page.getByTestId('continue-with-google')).toBeVisible();
  }
}
