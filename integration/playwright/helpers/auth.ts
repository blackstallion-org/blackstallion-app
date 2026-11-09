import type { Page } from '@playwright/test';

export type TestAccount = { email: string; password: string };

export async function signInAs(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/');
  await page.getByTestId('email-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('email-input').fill(account.email);
  await page.getByTestId('password-input').fill(account.password);
  await page.getByTestId('sign-in-button').click();
  await page.waitForURL(/\/(family|field|home)/, { timeout: 15_000 });
}
