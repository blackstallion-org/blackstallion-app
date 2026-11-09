import type { Page } from '@playwright/test';
import path from 'node:path';

const evidenceDir = path.resolve(__dirname, '../../../../MOBILE_APP_PLANNING/evidence/playwright');

export async function journeyScreenshot(page: Page, journeyId: string, stepName: string): Promise<void> {
  await page.screenshot({
    path: path.join(evidenceDir, `${journeyId}-${stepName}.png`),
    fullPage: false,
  });
}
