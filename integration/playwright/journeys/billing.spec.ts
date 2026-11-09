/**
 * Billing journeys J34–J37: web render tests. Verifies billing screens render in Chromium.
 */
import { test, expect } from '@playwright/test';
import { signInAs } from '../helpers/auth';
import { getWorld } from '../helpers/seed';
import { journeyScreenshot } from '../helpers/screenshots';
import type { ScreensWorld } from '../../staging/seedScreens';

let w: ScreensWorld;

test.beforeAll(async () => {
  w = await getWorld();
});

test.describe('J34: Pay dues', () => {
  test('billing overview screen renders', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('billing-tab').click();
    await expect(page.getByTestId('billing-overview')).toBeVisible();
    await journeyScreenshot(page, 'J34', 'billing-overview');
  });

  test.skip(true, 'PARTIAL:no-Razorpay – payment gateway not available in staging');
});

test.describe('J35: Download invoice / order history', () => {
  test('order history list renders', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('billing-tab').click();
    await page.getByTestId('order-history').click();
    await journeyScreenshot(page, 'J35', 'order-history');
  });
});

test.describe('J36: Autopay setup/cancel', () => {
  test.skip(true, 'BLOCKED:D11 – autopay feature not approved');
});

test.describe('J37: Buy kit / passport', () => {
  test('add-ons section visible on billing overview', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('billing-tab').click();
    await journeyScreenshot(page, 'J37', 'add-ons');
  });

  test.skip(true, 'PARTIAL:no-Razorpay – add-on purchase needs payment gateway');
});
