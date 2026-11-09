/**
 * Shared journeys J01–J09, J38: web render tests. Verifies sign-in screens, navigation, experience
 * switching and account screens render correctly in Chromium via Expo web.
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

test.describe('J01: First sign-in', () => {
  test('sign-in screen renders with email and password fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('email-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
    await journeyScreenshot(page, 'J01', 'sign-in-screen');
  });

  test('instructor signs in and lands on field tab', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await expect(page.getByTestId('field-tab')).toBeVisible();
    await journeyScreenshot(page, 'J01', 'instructor-home');
  });

  test('guardian signs in and lands on family tab', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await expect(page.getByTestId('family-tab')).toBeVisible();
    await journeyScreenshot(page, 'J01', 'guardian-home');
  });
});

test.describe('J02: Returning cold start', () => {
  test('sign-in again loads the same home', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await expect(page.getByTestId('field-tab')).toBeVisible();
  });
});

test.describe('J03: Dual-role experience switch', () => {
  test('tab bar shows experience tabs', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await journeyScreenshot(page, 'J03', 'tab-bar');
  });
});

test.describe('J04: Appearance/language', () => {
  test('settings screen renders', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('account-tab').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await journeyScreenshot(page, 'J04', 'settings');
  });
});

test.describe('J05: Sign out', () => {
  test('sign out button visible on account screen', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('account-tab').click();
    await expect(page.getByTestId('sign-out-button')).toBeVisible();
    await journeyScreenshot(page, 'J05', 'sign-out');
  });
});

test.describe('J06: Notification preferences', () => {
  test('notification settings screen renders', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await page.getByTestId('account-tab').click();
    await page.getByTestId('notification-settings').click();
    await journeyScreenshot(page, 'J06', 'notification-settings');
  });
});

test.describe('J07: Account deletion', () => {
  test.skip(true, 'BLOCKED:D12 – account deletion flow not approved');
});

test.describe('J08: Help / support', () => {
  test('help screen renders with contact info', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await page.getByTestId('account-tab').click();
    await page.getByTestId('help-support').click();
    await journeyScreenshot(page, 'J08', 'help-screen');
  });
});

test.describe('J09: Outdated build gate', () => {
  test('app loads without version gate blocking', async ({ page }) => {
    await signInAs(page, w.guardianA);
    await expect(page.getByTestId('family-tab')).toBeVisible();
  });
});

test.describe('J38: Notification settings', () => {
  test.skip(true, 'BLOCKED:D05/M15 – push notification provider not integrated');
});
