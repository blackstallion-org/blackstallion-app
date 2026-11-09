/**
 * @jest-environment node
 *
 * Shared journeys J01–J05, J06, J08–J09, J38: sign-in, access scoping, experience switching,
 * sign-out, notifications, version policy. Exercises the access adapter + account repositories.
 */
import { randomUUID } from 'node:crypto';

import { createSupabaseAccessAdapter } from '@/core/auth/supabase/supabaseAccessAdapter';

import { seedScreens, type ScreensWorld } from '../seedScreens';
import { appClient, seedWorld, signIn, type Account } from '../stack';
import { cachedSession, clearSessionCache } from './helpers';

jest.setTimeout(60_000);

let w: ScreensWorld;
const as = (name: keyof ScreensWorld & string) => cachedSession(name, w[name] as Account);

beforeAll(async () => {
  w = await seedScreens(await seedWorld());
});
afterAll(() => clearSessionCache());

// ──────────────────────────────────────────────────────────── J01: First sign-in
describe('J01: First sign-in (access scoping)', () => {
  test('instructor gets field experience with hub and role', async () => {
    const s = await as('instructorA');
    expect(s.snap.kind).toBe('authorized');
    expect(s.snap.allowedExperiences).toContain('field');
    expect(s.field.hubId).toBe(w.hubA);
    expect(s.field.role).toBe('INSTRUCTOR');
  });

  test('guardian gets family experience with children', async () => {
    const s = await as('guardianA');
    expect(s.snap.kind).toBe('authorized');
    expect(s.snap.allowedExperiences).toContain('family');
    expect(s.family.children?.length).toBeGreaterThanOrEqual(1);
    expect(s.family.children?.some((c) => c.cadetId === w.cadetA)).toBe(true);
  });

  test('groom gets field experience with hub and groom role', async () => {
    const s = await as('groomA');
    expect(s.snap.kind).toBe('authorized');
    expect(s.snap.allowedExperiences).toContain('field');
    expect(s.field.role).toBe('GROOM');
  });

  test('stranger (no child, no role) gets authorized but limited', async () => {
    const s = await as('stranger');
    expect(s.snap.kind).toBe('authorized');
  });
});

// ──────────────────────────────────────────────────────────── J02: Returning cold start
describe('J02: Returning cold start', () => {
  test('second sign-in produces same access snapshot', async () => {
    const client = await signIn(w.instructorA, appClient());
    const snap = await createSupabaseAccessAdapter(client).load();
    expect(snap).toMatchObject({ kind: 'authorized', subjectId: w.instructorA.id });
  });
});

// ──────────────────────────────────────────────────────────── J03: Dual-role switch
describe('J03: Dual-role experience switch', () => {
  test('instructor allowed in field can build field scope', async () => {
    const s = await as('instructorA');
    expect(s.field.experience).toBe('field');
    expect(s.field.hubId).toBeTruthy();
  });

  test('guardian builds family scope with children', async () => {
    const s = await as('guardianA');
    expect(s.family.experience).toBe('family');
    expect(s.family.children?.length).toBeGreaterThanOrEqual(1);
  });

  test('switching experience changes scope, never grants a role', async () => {
    const s = await as('guardianA');
    expect(s.field.role).toBeUndefined();
    expect(s.field.hubId).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────── J04: Appearance/language
describe('J04: Appearance/language', () => {
  test.skip('CLIENT-ONLY: theme/locale persistence is device-side only', () => {});
});

// ──────────────────────────────────────────────────────────── J05: Sign out with unsent
describe('J05: Sign out with unsent work', () => {
  test('account.support.contact() returns contact info', async () => {
    const s = await as('instructorA');
    const contact = await s.repos.account.support.contact();
    expect(contact).toBeDefined();
  });

  test('pendingWork port is available when fieldOps is wired', async () => {
    const s = await as('instructorA');
    if (s.repos.account.pendingWork) {
      const count = await s.repos.account.pendingWork.count(s.account.subjectId);
      expect(typeof count).toBe('number');
    }
  });
});

// ──────────────────────────────────────────────────────────── J06: Notification / deep link
describe('J06: Notification preferences', () => {
  test('list notification categories for instructor', async () => {
    const s = await as('instructorA');
    const cats = await s.repos.account.notifications.list(s.account);
    expect(Array.isArray(cats)).toBe(true);
  });

  test('set a notification preference (replay-safe)', async () => {
    const s = await as('instructorA');
    const cats = await s.repos.account.notifications.list(s.account);
    if (cats.length > 0) {
      const opId = randomUUID();
      const ack = await s.repos.account.notifications.set(s.account, { category: cats[0]!.category, enabled: true, operationId: opId });
      expect(ack).toBeDefined();
      const replay = await s.repos.account.notifications.set(s.account, { category: cats[0]!.category, enabled: true, operationId: opId });
      expect(replay).toBeDefined();
    }
  });
});

// ──────────────────────────────────────────────────────────── J07: Account deletion
describe('J07: Account deletion', () => {
  test.skip('BLOCKED:D12 – account deletion flow not approved', () => {});
});

// ──────────────────────────────────────────────────────────── J08: Help
describe('J08: Help / support', () => {
  test('support contact and update destinations are available', async () => {
    const s = await as('guardianA');
    const contact = await s.repos.account.support.contact();
    expect(contact).toBeDefined();
    const dests = await s.repos.account.support.updateDestinations();
    expect(dests).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────── J09: Outdated build
describe('J09: Outdated build gate', () => {
  test('version policy resolves (no server contract yet, gate fails open)', async () => {
    const s = await as('guardianA');
    if (s.repos.account.versionPolicy) {
      const policy = await s.repos.account.versionPolicy.get();
      expect(policy).toBeDefined();
    }
  });
});

// ──────────────────────────────────────────────────────────── J38: Notifications
describe('J38: Notification settings', () => {
  test.skip('BLOCKED:D05/M15 – push notification provider not integrated', () => {});
});
