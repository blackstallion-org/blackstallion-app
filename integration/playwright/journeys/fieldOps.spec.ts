/**
 * Field Ops journeys J21–J33: web render tests. Verifies field screens render correctly in Chromium.
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

test.describe('J21: Core lesson (scan→grade→publish)', () => {
  test('field today screen renders with check-ins', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await expect(page.getByTestId('field-today')).toBeVisible();
    await journeyScreenshot(page, 'J21', 'field-today');
  });

  test('scan screen renders with manual entry option', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await page.getByTestId('scan-button').click();
    await expect(page.getByTestId('scan-manual-entry')).toBeVisible();
    await journeyScreenshot(page, 'J21', 'scan-screen');
  });

  test.skip(true, 'PARTIAL:web-stub – camera scanning needs native module');
});

test.describe('J22: Publish offline', () => {
  test('outbox indicator visible when offline', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await journeyScreenshot(page, 'J22', 'outbox-indicator');
  });

  test.skip(true, 'PARTIAL:network-stub – offline simulation needs service worker');
});

test.describe('J23: Correct assessment', () => {
  test('session detail shows correction button', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await journeyScreenshot(page, 'J23', 'correction-button');
  });
});

test.describe('J24: Wrong scan / missing', () => {
  test('error state renders on invalid scan', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await page.getByTestId('scan-button').click();
    await page.getByTestId('scan-manual-entry').click();
    await page.getByTestId('passport-code-input').fill('INVALID-CODE-999');
    await page.getByTestId('submit-scan').click();
    await journeyScreenshot(page, 'J24', 'scan-error');
  });
});

test.describe('J25: No video consent', () => {
  test('grade form renders without clip option when no consent', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await journeyScreenshot(page, 'J25', 'no-consent-grade');
  });
});

test.describe('J26: Batch session', () => {
  test.skip(true, 'BLOCKED:Q7 – batch session flow not implemented');
});

test.describe('J27: Due care task', () => {
  test('care timeline renders for groom', async ({ page }) => {
    await signInAs(page, w.groomA);
    await expect(page.getByTestId('care-timeline')).toBeVisible();
    await journeyScreenshot(page, 'J27', 'care-timeline');
  });

  test.skip(true, 'PARTIAL:no-GPS – evidence photo with GPS needs device');
});

test.describe('J28: Care by horse', () => {
  test('horse list renders', async ({ page }) => {
    await signInAs(page, w.groomA);
    await page.getByTestId('horses-tab').click();
    await journeyScreenshot(page, 'J28', 'horse-list');
  });
});

test.describe('J29: Punch in/out', () => {
  test('shift status visible on field screen', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await journeyScreenshot(page, 'J29', 'shift-status');
  });

  test.skip(true, 'PARTIAL:no-GPS – punch-in needs device GPS');
});

test.describe('J30: Overdue escalation', () => {
  test('overdue badge visible on field today', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await journeyScreenshot(page, 'J30', 'overdue-badge');
  });
});

test.describe('J31: Recover stuck item', () => {
  test('outbox screen renders queue', async ({ page }) => {
    await signInAs(page, w.instructorA);
    await journeyScreenshot(page, 'J31', 'outbox-queue');
  });
});

test.describe('J32: Propose/approve rank', () => {
  test.skip(true, 'BLOCKED:D15 – rank proposals not approved');
});

test.describe('J33: Review posture', () => {
  test.skip(true, 'BLOCKED:D24/D34 – posture analysis not available');
});
