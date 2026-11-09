/**
 * @jest-environment node
 *
 * Field Ops journeys J21–J33: scan→grade→publish, offline publish, correction, wrong scan, no-consent,
 * batch, care tasks, horse timeline, punch in/out, overdue escalation, stuck recovery, rank proposal, review.
 * Exercises fieldApp, fieldOps (outbox + transport), fieldWorkflow, fieldToday against the local staging stack.
 *
 * The server allows one check-in per cadet per day and one published session per check-in, so J23 (correct)
 * and J25 (no-consent) continue J21's session instead of publishing a second one for cadet A.
 */
import { randomUUID } from 'node:crypto';

import { exposeFieldSchema, seedScreens, type ScreensWorld } from '../seedScreens';
import { seedWorld, type Account } from '../stack';
import { cachedSession, clearSessionCache, errOf } from './helpers';

jest.setTimeout(120_000);

let w: ScreensWorld;
const as = (name: keyof ScreensWorld & string) => cachedSession(name, w[name] as Account);

/** J21's published session, corrected by J23 and inspected by J25. */
let j21: { checkInOperationId: string; sessionId: string; version: number } | null = null;

beforeAll(async () => {
  w = await seedScreens(await seedWorld());
  await exposeFieldSchema(true);
});
afterAll(() => clearSessionCache());

// ──────────────────────────────────────────────────────────── J21: Scan → grade → clip → publish
describe('J21: Core lesson (scan→grade→publish)', () => {
  test('check in cadet A by passport code', async () => {
    const s = await as('instructorA');
    const cmds = s.repos.fieldApp.commands(s.field);
    const result = await cmds.checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() });
    expect(result).toMatchObject({ cadetId: w.cadetA, isToday: true });
    expect(result.checkInId).toBeTruthy();
    j21 = { checkInOperationId: result.checkInOperationId, sessionId: '', version: 0 };
  });

  test('fieldToday shows today check-in', async () => {
    const s = await as('instructorA');
    const today = await s.repos.fieldToday.getToday(s.field);
    expect(today.source).toBe('server');
    expect(today.checkIns?.some((ci) => ci.cadetId === w.cadetA)).toBe(true);
  });

  test('publish assessment with scores', async () => {
    const s = await as('instructorA');
    if (!j21) throw new Error('J21 check-in must run first');
    const cmds = s.repos.fieldApp.commands(s.field);
    const result = await cmds.publish({
      checkInOperationId: j21.checkInOperationId,
      assessment: { riding: 8, ground: 7, stable: 9, notes: 'Synthetic journey test J21', skillIds: w.skills },
      operationId: randomUUID(),
    });
    expect(result.sessionId).toBeTruthy();
    j21 = { ...j21, sessionId: result.sessionId, version: result.version };
  });

  test('guardian reads published session in progress', async () => {
    const s = await as('guardianA');
    const progress = await s.repos.familyApp.progress.get(s.family, w.cadetA);
    expect(progress.sessions.some((x) => x.id === j21?.sessionId)).toBe(true);
  });

  test.skip('PARTIAL:no-camera – clip upload needs device camera', () => {});
});

// ──────────────────────────────────────────────────────────── J22: Publish offline (outbox)
describe('J22: Publish offline (outbox replay safety)', () => {
  test('outbox exists for instructor with fieldOps', async () => {
    const s = await as('instructorA');
    expect(s.repos.fieldOps).toBeDefined();
    expect(s.repos.fieldOps!.outbox).toBeDefined();
  });

  test('replay-safe: same operationId does not duplicate', async () => {
    const s = await as('instructorA');
    const cmds = s.repos.fieldApp.commands(s.field);
    const opId = randomUUID();
    const req = { passportCode: w.passportA, observedAt: new Date(), operationId: opId };
    const first = await cmds.checkIn(req);
    const replay = await cmds.checkIn(req);
    expect(replay.checkInId).toBe(first.checkInId);
  });
});

// ──────────────────────────────────────────────────────────── J23: Correct assessment
describe('J23: Correct assessment', () => {
  test('correct the published session with updated scores', async () => {
    const s = await as('instructorA');
    if (!j21?.sessionId) throw new Error('J21 publish must run first');
    const cmds = s.repos.fieldApp.commands(s.field);
    const correction = await cmds.correct({
      sessionId: j21.sessionId,
      expectedVersion: j21.version,
      scores: { riding: 9, ground: 8, stable: 8 },
      notes: 'Corrected J23',
      reason: 'Synthetic journey correction',
      operationId: randomUUID(),
    });
    expect(correction.version).toBe(j21.version + 1);
  });
});

// ──────────────────────────────────────────────────────────── J24: Wrong scan / missing
describe('J24: Wrong scan / missing passport', () => {
  test('invalid passport code is rejected by server', async () => {
    const s = await as('instructorA');
    const cmds = s.repos.fieldApp.commands(s.field);
    const e = await errOf(cmds.checkIn({ passportCode: 'INVALID-CODE-999', observedAt: new Date(), operationId: randomUUID() }));
    expect(e.kind).toBe('notFound');
  });

  test('hub B passport rejected at hub A', async () => {
    const s = await as('instructorA');
    const cmds = s.repos.fieldApp.commands(s.field);
    const e = await errOf(cmds.checkIn({ passportCode: w.passportB, observedAt: new Date(), operationId: randomUUID() }));
    expect(e.kind).toBe('notFound');
  });
});

// ──────────────────────────────────────────────────────────── J25: No video consent
describe('J25: No video consent → scores publish, clip disabled', () => {
  test('consent for cadet A is not allowed (nothing granted in this world)', async () => {
    const s = await as('instructorA');
    const consent = await s.repos.fieldApp.consent.forCadet(s.field, w.cadetA);
    expect(consent.sessionVideo).not.toBe('allowed');
  });

  test('scores published without consent; the session carries no clip', async () => {
    const s = await as('instructorA');
    if (!j21?.sessionId) throw new Error('J21 publish must run first');
    const rec = await s.repos.fieldApp.sessions.record(s.field, j21.sessionId);
    expect(rec.published).toBe(true);
    expect(rec.hasClip).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────── J26: Batch session
describe('J26: Batch session', () => {
  test.skip('BLOCKED:Q7 – batch session flow not implemented', () => {});
});

// ──────────────────────────────────────────────────────────── J27: Due care task
describe('J27: Due care task', () => {
  test('care timeline returns occurrences for groom', async () => {
    const s = await as('groomA');
    const today = w.today;
    const timeline = await s.repos.fieldOps!.care.timeline(s.ops, today, today);
    expect(timeline.kind).toBe('ok');
    if (timeline.kind === 'ok') {
      expect(timeline.occurrences.length).toBeGreaterThanOrEqual(1);
    }
  });

  test.skip('PARTIAL:no-GPS – evidence photo with GPS needs device location', () => {});
});

// ──────────────────────────────────────────────────────────── J28: Care by horse
describe('J28: Care by horse (horse list)', () => {
  test('horses.listHorses returns hub A horses', async () => {
    const s = await as('groomA');
    const horses = await s.repos.fieldOps!.horses.listHorses(s.ops);
    expect(horses.length).toBeGreaterThanOrEqual(1);
    expect(horses.some((h) => h.name.includes('Badal'))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────── J29: Punch in/out
describe('J29: Punch in/out (shift attendance)', () => {
  test('shift status for instructor', async () => {
    const s = await as('instructorA');
    const status = await s.repos.fieldOps!.shift.status(s.ops);
    expect(status).toBeDefined();
  });

  test.skip('PARTIAL:no-GPS – punch-in needs device GPS for accuracy threshold', () => {});
});

// ──────────────────────────────────────────────────────────── J30: Overdue escalation
describe('J30: Overdue care escalation', () => {
  test('fieldToday shows overdue care count', async () => {
    const s = await as('instructorA');
    const today = await s.repos.fieldToday.getToday(s.field);
    expect(typeof today.overdueCareCount).toBe('number');
  });
});

// ──────────────────────────────────────────────────────────── J31: Recover stuck item
describe('J31: Recover stuck outbox item', () => {
  test('outbox queue store is accessible', async () => {
    const s = await as('instructorA');
    expect(s.repos.fieldOps!.outbox).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────── J32: Propose / approve rank
describe('J32: Propose/approve rank', () => {
  test.skip('BLOCKED:D15 – rank proposals not approved', () => {});
});

// ──────────────────────────────────────────────────────────── J33: Review posture
describe('J33: Review posture analysis', () => {
  test.skip('BLOCKED:D24/D34 – posture analysis not available', () => {});

  test('posture capability returns unavailable', async () => {
    const s = await as('instructorA');
    const cap = await s.repos.fieldOps!.posture.capability(s.ops);
    expect(cap).toMatchObject({ status: 'unavailable' });
  });
});