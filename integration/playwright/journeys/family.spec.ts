/**
 * Family journeys J10–J20: web render tests. Verifies family screens render correctly in Chromium.
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

test.describe('J10: Check-in alert (family home)', () => {
  test('family home screen renders with child info', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await expect(page.getByTestId('family-home')).toBeVisible();
    await journeyScreenshot(page, 'J10', 'family-home');
  });
});

test.describe('J11: New assessment clip', () => {
  test('progress screen shows session list', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('progress-tab').click();
    await journeyScreenshot(page, 'J11', 'progress-list');
  });

  test.skip(true, 'PARTIAL:no-clip – clip playback needs device');
});

test.describe('J12: Review progress', () => {
  test('progress detail renders scores', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('progress-tab').click();
    await journeyScreenshot(page, 'J12', 'progress-detail');
  });
});

test.describe('J13: Switch child', () => {
  test('child switcher visible for multi-child guardian', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await journeyScreenshot(page, 'J13', 'child-switcher');
  });
});

test.describe('J14: Passport / rank', () => {
  test.skip(true, 'BLOCKED:D15 – passport/rank feature not approved');
});

test.describe('J15: Hall of Valour', () => {
  test('passport screen renders', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('passport-tab').click();
    await journeyScreenshot(page, 'J15', 'passport');
  });
});

test.describe('J16: Daily Spark', () => {
  test('spark card visible on family home', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await journeyScreenshot(page, 'J16', 'spark-card');
  });

  test.skip(true, 'PARTIAL:no-audio – audio playback needs device');
});

test.describe('J17: Horse / stall camera', () => {
  test.skip(true, 'BLOCKED:SD-04/D23 – horse detail / stall camera not available');
});

test.describe('J18: RSVP event', () => {
  test('events list renders with RSVP button', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('events-tab').click();
    await journeyScreenshot(page, 'J18', 'events-list');
  });
});

test.describe('J19: Change consent', () => {
  test('consent screen renders toggles', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('account-tab').click();
    await page.getByTestId('consent-settings').click();
    await journeyScreenshot(page, 'J19', 'consent-screen');
  });
});

test.describe('J20: Compare clips', () => {
  test.skip(true, 'BLOCKED:D24 – clip comparison feature not approved');
});
