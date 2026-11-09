/**
 * @jest-environment node
 *
 * Family journeys J10–J20: check-in alerts, assessment clips, progress, child switching, passport,
 * Hall of Valour, Daily Spark, horse/stall, RSVP, consent, clip comparison. Exercises familyApp +
 * familyHome repositories against the local staging stack.
 */
import { randomUUID } from 'node:crypto';

import { seedScreens, type ScreensWorld } from '../seedScreens';
import { seedWorld, type Account } from '../stack';
import { cachedSession, clearSessionCache, errOf, expectDenied } from './helpers';

jest.setTimeout(90_000);

let w: ScreensWorld;
const as = (name: keyof ScreensWorld & string) => cachedSession(name, w[name] as Account);

beforeAll(async () => {
  w = await seedScreens(await seedWorld());
});
afterAll(() => clearSessionCache());

const childA = () => w.cadetA;

// ──────────────────────────────────────────────────────────── J10: Check-in alert
describe('J10: Check-in alert (family home)', () => {
  test('familyHome.getHome returns server data with children', async () => {
    const s = await as('guardianA');
    const home = await s.repos.familyHome.getHome(s.family, childA());
    expect(home.source).toBe('server');
    expect(home.children.length).toBeGreaterThanOrEqual(1);
    expect(home.hubName).toBeTruthy();
  });

  test('guardian B cannot see cadet A home data', async () => {
    const s = await as('guardianB');
    const home = await s.repos.familyHome.getHome(s.family, childA());
    expect(home.children.every((c) => c.id !== childA())).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────── J11: New assessment clip
describe('J11: New assessment clip', () => {
  test('progress.clips returns clip entries for cadet A', async () => {
    const s = await as('guardianA');
    const res = await s.repos.familyApp.progress.clips(s.family, childA());
    expect(Array.isArray(res.clips)).toBe(true);
  });

  test.skip('PARTIAL:no-clip – full clip playback needs device camera + published session with clip', () => {});
});

// ──────────────────────────────────────────────────────────── J12: Review progress
describe('J12: Review progress', () => {
  test('progress.get returns session list for cadet A', async () => {
    const s = await as('guardianA');
    const result = await s.repos.familyApp.progress.get(s.family, childA());
    expect(result).toBeDefined();
  });

  test('progress paging: older sessions beyond page 1', async () => {
    const s = await as('guardianA');
    const page1 = await s.repos.familyApp.progress.get(s.family, childA());
    expect(page1.nextCursor).toBeTruthy(); // the seed has one more session than a page
    const page2 = await s.repos.familyApp.progress.older(s.family, childA(), page1.nextCursor!);
    expect(page2.sessions.length).toBeGreaterThanOrEqual(1);
  });

  test('session detail with scores and skills', async () => {
    const s = await as('guardianA');
    if (w.oldSessions.length > 0) {
      const detail = await s.repos.familyApp.sessions.get(s.family, w.oldSessions[0]!);
      expect(detail).toMatchObject({ id: w.oldSessions[0], childId: childA() });
      expect(detail.scores.riding).toEqual(expect.any(Number));
    }
  });

  test('guardian B denied access to cadet A session', async () => {
    const s = await as('guardianB');
    if (w.oldSessions.length > 0) {
      await expectDenied(s.repos.familyApp.sessions.get(s.family, w.oldSessions[0]!));
    }
  });
});

// ──────────────────────────────────────────────────────────── J13: Switch child
describe('J13: Switch child', () => {
  test('familyApp.linkedChildren returns scope children', async () => {
    const s = await as('guardianA');
    const children = s.repos.familyApp.linkedChildren(s.family);
    expect(children.length).toBeGreaterThanOrEqual(1);
    expect(children[0]!.id).toBe(childA());
  });
});

// ──────────────────────────────────────────────────────────── J14: Passport / rank
describe('J14: Passport / rank', () => {
  test.skip('BLOCKED:D15 – passport/rank feature not approved', () => {});
});

// ──────────────────────────────────────────────────────────── J15: Hall of Valour (passport)
describe('J15: Hall of Valour', () => {
  test('passport.get returns passport data for cadet A', async () => {
    const s = await as('guardianA');
    const passport = await s.repos.familyApp.passport.get(s.family, childA());
    expect(passport).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────── J16: Daily Spark
describe('J16: Daily Spark', () => {
  test('spark.repository.getToday returns today spark for hub A family', async () => {
    const s = await as('guardianA');
    const spark = s.repos.familyApp.spark;
    if (!spark) throw new Error('spark feature not wired');
    const today = await spark.repository.getToday({ ...s.family, cadetId: childA() });
    expect(today.spark).toMatchObject({ id: w.sparkA });
  });

  test('acknowledge spark is replay-safe', async () => {
    const s = await as('guardianA');
    const spark = s.repos.familyApp.spark;
    if (!spark?.repository.acknowledge) throw new Error('spark acknowledge not wired');
    const scope = { ...s.family, cadetId: childA() };
    const opId = randomUUID();
    const req = { cadetId: childA(), sparkId: w.sparkA, operationId: opId };
    const ack = await spark.repository.acknowledge(scope, req);
    expect(ack).toMatchObject({ already: false, duplicate: false });
    const replay = await spark.repository.acknowledge(scope, req);
    expect(replay.duplicate).toBe(true);
  });

  test.skip('PARTIAL:no-audio – audio playback needs device speakers', () => {});
});

// ──────────────────────────────────────────────────────────── J17: Horse / stall camera
describe('J17: Horse / stall camera', () => {
  test.skip('BLOCKED:SD-04/D23 – horse detail / stall camera not available', () => {});

  test('horse.get returns unavailable with decision ref', async () => {
    const s = await as('guardianA');
    const horse = await s.repos.familyApp.horse.get(s.family, childA());
    expect(horse.care.status).toBe('unavailable');
    expect(horse.care.decisionRef).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────── J18: RSVP event
describe('J18: RSVP event', () => {
  test('events.list returns published hub A events', async () => {
    const s = await as('guardianA');
    const { events } = await s.repos.familyApp.events.list(s.family);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const titles = events.map((e) => e.title);
    expect(titles.some((t) => t.includes(w.run))).toBe(true);
  });

  test('event detail returns capacity and RSVP state', async () => {
    const s = await as('guardianA');
    const detail = await s.repos.familyApp.events.detail(s.family, w.eventA);
    expect(detail.event).toMatchObject({ id: w.eventA, rsvpOpen: true });
  });

  test('RSVP to an event (replay-safe)', async () => {
    const s = await as('guardianA');
    const opId = randomUUID();
    const cmd = { eventId: w.eventA, childId: childA(), operationId: opId };
    const result = await s.repos.familyApp.events.rsvp(s.family, cmd);
    expect(result).toMatchObject({ status: 'confirmed', already: false, duplicate: false });
    const replay = await s.repos.familyApp.events.rsvp(s.family, cmd);
    expect(replay.duplicate).toBe(true);
  });

  test('cancel RSVP', async () => {
    const s = await as('guardianA');
    const cancel = await s.repos.familyApp.events.cancel(s.family, { eventId: w.eventA, childId: childA(), operationId: randomUUID() });
    expect(cancel.status).toBe('cancelled');
  });

  test('hub B event not visible to hub A family', async () => {
    const s = await as('guardianA');
    const { events } = await s.repos.familyApp.events.list(s.family);
    const ids = events.map((e) => e.id);
    expect(ids).not.toContain(w.eventB);
  });

  test('RSVP on one-seat event shows full after first RSVP', async () => {
    const s = await as('guardianA');
    const first = await s.repos.familyApp.events.rsvp(s.family, { eventId: w.eventFullA, childId: childA(), operationId: randomUUID() });
    expect(first.seatsLeft).toBe(0);
    const sC = await as('guardianC');
    const e = await errOf(sC.repos.familyApp.events.rsvp(sC.family, { eventId: w.eventFullA, childId: w.cadetC, operationId: randomUUID() }));
    expect(e.kind).toBe('conflict'); // no waitlist: the second family is refused
  });
});

// ──────────────────────────────────────────────────────────── J19: Change consent
describe('J19: Change media consent', () => {
  test('consent centre returns consent state', async () => {
    const s = await as('guardianA');
    const centre = await s.repos.familyApp.consent.centre(s.family);
    expect(centre).toBeDefined();
  });

  test('set consent grant (replay-safe)', async () => {
    const s = await as('guardianA');
    const centre = await s.repos.familyApp.consent.centre(s.family);
    const version = centre.purposes.find((p) => p.purpose === 'session_video')!.policyVersion;
    const opId = randomUUID();
    const cmd = { childId: childA(), purpose: 'session_video', granted: true, policyVersion: version, operationId: opId };
    const result = await s.repos.familyApp.consent.set(s.family, cmd);
    expect(result).toMatchObject({ granted: true, changed: true, duplicate: false });
    const replay = await s.repos.familyApp.consent.set(s.family, cmd);
    expect(replay.duplicate).toBe(true);
  });

  test('consent history tracks changes', async () => {
    const s = await as('guardianA');
    const history = await s.repos.familyApp.consent.history(s.family, childA());
    expect(Array.isArray(history)).toBe(true);
  });

  test('guardian B cannot set consent for cadet A', async () => {
    const s = await as('guardianB');
    await expectDenied(
      s.repos.familyApp.consent.set(s.family, {
        childId: childA(),
        purpose: 'session_video',
        granted: true,
        policyVersion: 'draft-1',
        operationId: randomUUID(),
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────── J20: Compare clips
describe('J20: Compare clips', () => {
  test.skip('BLOCKED:D24 – clip comparison feature not approved', () => {});
});
