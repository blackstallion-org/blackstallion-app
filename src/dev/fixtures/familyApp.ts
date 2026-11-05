/**
 * DEVELOPMENT-ONLY synthetic fixtures for the Family screens (FA-02..FA-13). Every name is invented and marked
 * "(sample)"; every result carries `source: 'synthetic-preview'`, so screens show the synthetic-data banner.
 * The fixtures mirror the server's scoping: a child id that is not linked to the persona is refused (never served),
 * commands are replay-safe by operation id, and RSVP capacity is enforced. There are NO media files: private clips,
 * event images and stall-camera video are reported as unavailable rather than faked.
 *
 * Persona `syn-guardian-err` simulates failures: progress/session/passport loads fail (error state) and
 * horse/community/consent loads look offline (offline state).
 */
import { ScopedLoadError } from '@/core/data/useScopedResource';
import {
  FamilyCommandError,
  type ConsentCentre,
  type ConsentHistoryEntry,
  type FamilyAppRepositories,
  type FamilyChild,
  type FamilyEvent,
  type HorseInfo,
  type SessionDetail,
  type SessionSummary,
} from '@/features/family/data/repositories';
import type { ConsentState } from '@/features/family/domain/consent';
import { dayLabel } from '@/features/family/domain/format';
import { toPassportInput } from '@/features/family/domain/passportLive';
import type { StreamCapability } from '@/features/family/domain/stream';
import { D18_PROPOSED } from '@/features/family/spark/domain/policy';
import type { SparkToday } from '@/features/family/spark/types';
import type { FamilyScope } from '@/features/family/types';

import { createSimulatedSparkAudio } from '../sparkFixture';

const SRC = 'synthetic-preview' as const;
const DEFAULT_LATENCY = process.env.NODE_ENV === 'test' ? 0 : 300;
const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const CHILDREN: Record<string, FamilyChild[]> = {
  'syn-guardian-a': [
    { id: 'syn-cadet-a1', firstName: 'Aarav (sample)', hubId: 'syn-hub-1' },
    { id: 'syn-cadet-a2', firstName: 'Meera (sample)', hubId: 'syn-hub-1' },
  ],
  'syn-guardian-b': [],
  'syn-dual': [{ id: 'syn-cadet-d1', firstName: 'Isha (sample)', hubId: 'syn-hub-2' }],
  'syn-guardian-err': [{ id: 'syn-cadet-e1', firstName: 'Rohan (sample)', hubId: 'syn-hub-1' }],
};
const HUB_NAME: Record<string, string> = { 'syn-hub-1': 'Demo Hub One', 'syn-hub-2': 'Demo Hub Two' };

// ------------------------------------------------------------------ sessions (published, current revisions)
type FxSession = SessionSummary & { notes: string | null; skills: SessionDetail['skills']; corrections: SessionDetail['corrections']; version: number };
const sk = (id: string, name: string, category: 'RIDING' | 'GROUND' | 'STABLE') => ({ id, name, category });
const s = (childId: string, id: string, date: string, r: number, g: number, st: number, extra: Partial<FxSession> = {}): FxSession => ({
  id,
  childId,
  date,
  scores: { riding: r, ground: g, stable: st },
  corrected: false,
  hasClip: false,
  notes: null,
  skills: [],
  corrections: [],
  version: 1,
  ...extra,
});

const SESSIONS: FxSession[] = [
  s('syn-cadet-a1', 'syn-ts-a1-01', '2026-09-05', 4, 5, 6, { hasClip: true, notes: 'First session on the lunge line. Calm and attentive. (sample)', skills: [sk('syn-sk-mount', 'Mounting (sample)', 'RIDING')] }),
  s('syn-cadet-a1', 'syn-ts-a1-02', '2026-09-12', 5, 5, 6),
  s('syn-cadet-a1', 'syn-ts-a1-03', '2026-09-19', 5, 6, 7, { skills: [sk('syn-sk-groom', 'Grooming (sample)', 'STABLE')] }),
  s('syn-cadet-a1', 'syn-ts-a1-04', '2026-09-26', 6, 6, 7),
  s('syn-cadet-a1', 'syn-ts-a1-05', '2026-10-03', 6, 5, 7, { hasClip: true, skills: [sk('syn-sk-walk', 'Halt and walk on (sample)', 'RIDING')] }),
  s('syn-cadet-a1', 'syn-ts-a1-06', '2026-10-10', 7, 6, 8),
  s('syn-cadet-a1', 'syn-ts-a1-07', '2026-10-17', 7, 6, 7, { notes: 'Good balance in sitting trot. (sample)' }),
  s('syn-cadet-a1', 'syn-ts-a1-08', '2026-10-24', 7, 7, 8),
  s('syn-cadet-a1', 'syn-ts-a1-09', '2026-10-31', 8, 6, 8, { hasClip: true }),
  s('syn-cadet-a1', 'syn-ts-a1-10', '2026-11-07', 8, 6, 8, {
    corrected: true,
    version: 2,
    hasClip: true,
    notes: 'Steady rising trot on the long side. Next: softer hands at the halt. (sample)',
    skills: [sk('syn-sk-trot', 'Rising trot (sample)', 'RIDING'), sk('syn-sk-tack', 'Tacking up (sample)', 'STABLE')],
    corrections: [{ at: '2026-11-08T05:40:00Z', reason: 'Riding score re-entered after the instructor’s review. (sample)' }],
  }),
  s('syn-cadet-d1', 'syn-ts-d1-01', '2026-10-19', 6, 7, 8, { hasClip: true }),
  s('syn-cadet-d1', 'syn-ts-d1-02', '2026-11-02', 7, 7, 9, { hasClip: true, skills: [sk('syn-sk-mount', 'Mounting (sample)', 'RIDING')] }),
];

const RANKS: Record<string, { rank: string; code: string; changes: { id: string; fromRank: string | null; toRank: string; promotedAt: string }[]; achievements: { id: string; type: string; title: string; awardedAt: string }[] }> = {
  'syn-cadet-a1': {
    rank: 'CADET_RIDER',
    code: 'BSAH-26-SAMPLE01',
    changes: [{ id: 'syn-rh-a1-1', fromRank: 'CADET_SQUIRE', toRank: 'CADET_RIDER', promotedAt: '2026-10-17T11:00:00Z' }],
    achievements: [{ id: 'syn-ach-a1-1', type: 'MILESTONE', title: 'First canter (sample)', awardedAt: '2026-10-24T10:30:00Z' }],
  },
  'syn-cadet-a2': { rank: 'CADET_SQUIRE', code: 'BSAH-26-SAMPLE02', changes: [], achievements: [] },
  'syn-cadet-d1': { rank: 'CADET_SQUIRE', code: 'BSAH-26-SAMPLE03', changes: [], achievements: [] },
};

const HORSES: Record<string, HorseInfo['horse']> = {
  'syn-cadet-a1': { id: 'syn-horse-1', name: 'Badal (sample)', breed: 'Marwari', heightHands: 15.1, temperament: 'Calm and curious (sample)', active: true },
  'syn-cadet-a2': null,
  'syn-cadet-d1': { id: 'syn-horse-3', name: 'Toofan (sample)', breed: 'Marwari', heightHands: 14.3, temperament: 'Lively, needs a quiet start (sample)', active: true },
};

// ------------------------------------------------------------------ consent (purposes are seed data, D09 PROPOSED)
const PURPOSES: ConsentCentre['purposes'] = [
  { purpose: 'session_video', title: 'Session video', description: 'Short training clips of your child recorded by the instructor', policyVersion: 'draft-1' },
  { purpose: 'care_photo', title: 'Care photos', description: 'Stable care photos in which your child may appear', policyVersion: 'draft-1' },
  { purpose: 'posture_analysis', title: 'Posture suggestions', description: 'Automated posture suggestions on session clips, reviewed by an instructor', policyVersion: 'draft-1' },
];
type FxConsent = { id: string; childId: string; purpose: string; granted: boolean; policyVersion: string; recordedAt: string };
const CONSENT_SEED: FxConsent[] = [
  { id: 'syn-cr-1', childId: 'syn-cadet-a1', purpose: 'session_video', granted: true, policyVersion: 'draft-1', recordedAt: '2026-09-01T02:00:00Z' },
  { id: 'syn-cr-2', childId: 'syn-cadet-a1', purpose: 'posture_analysis', granted: true, policyVersion: 'draft-1', recordedAt: '2026-09-01T02:00:30Z' },
  { id: 'syn-cr-3', childId: 'syn-cadet-a1', purpose: 'posture_analysis', granted: false, policyVersion: 'draft-1', recordedAt: '2026-10-20T13:15:00Z' },
  { id: 'syn-cr-4', childId: 'syn-cadet-d1', purpose: 'session_video', granted: true, policyVersion: 'draft-1', recordedAt: '2026-10-01T04:00:00Z' },
  { id: 'syn-cr-5', childId: 'syn-cadet-d1', purpose: 'session_video', granted: false, policyVersion: 'draft-1', recordedAt: '2026-11-03T15:20:00Z' },
];

// ------------------------------------------------------------------ events (dates relative to today, hub time)
const IST_MS = 330 * 60_000;
/** ISO instant for hub-local (IST) `hh:mm`, `days` from today. */
const at = (days: number, hh: number, mm = 0): string => {
  const now = new Date(Date.now() + IST_MS);
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hh, mm) - IST_MS;
  return new Date(utc).toISOString();
};
type FxEvent = Omit<FamilyEvent, 'children' | 'seatsLeft' | 'rsvpOpen' | 'cancellationOpen'> & { taken: number; seats: Record<string, boolean> };
const EVENT_SEED = (): FxEvent[] => [
  {
    id: 'syn-ev-open-day',
    hubId: 'syn-hub-1',
    title: 'Open day at the arena (sample)',
    description: 'Families watch a short display ride, meet the horses in the stable yard and see where cadets train. Sample text, not an academy event.',
    venue: 'Main arena, Demo Hub One',
    startsAt: at(9, 10),
    endsAt: at(9, 13),
    rsvpClosesAt: at(8, 18),
    capacity: 40,
    taken: 27,
    status: 'published',
    image: null,
    seats: { 'syn-cadet-a1': true },
  },
  {
    id: 'syn-ev-care-workshop',
    hubId: 'syn-hub-1',
    title: 'Stable care workshop (sample)',
    description: 'A hands-on hour on grooming kit, hoof picking and feed safety. Sample text.',
    venue: 'Stable yard, Demo Hub One',
    startsAt: at(16, 16),
    endsAt: at(16, 17, 30),
    rsvpClosesAt: at(15, 12),
    capacity: 12,
    taken: 12,
    status: 'published',
    image: null,
    seats: {},
  },
  {
    id: 'syn-ev-trail',
    hubId: 'syn-hub-1',
    title: 'Evening trail walk (sample)',
    description: 'Cancelled by the academy. Sample text.',
    venue: 'North paddock gate, Demo Hub One',
    startsAt: at(12, 17),
    endsAt: null,
    rsvpClosesAt: at(11, 12),
    capacity: 20,
    taken: 0,
    status: 'cancelled',
    image: null,
    seats: {},
  },
  {
    id: 'syn-ev-festival',
    hubId: 'syn-hub-1',
    title: 'Festival family evening (sample)',
    description: 'Lamps in the yard and a slow walk past the stalls. Sample text.',
    venue: 'Clubhouse lawn, Demo Hub One',
    startsAt: at(-4, 18),
    endsAt: at(-4, 20),
    rsvpClosesAt: at(-5, 12),
    capacity: 80,
    taken: 61,
    status: 'published',
    image: null,
    seats: { 'syn-cadet-a1': true, 'syn-cadet-a2': true },
  },
  {
    id: 'syn-ev-pony-club',
    hubId: 'syn-hub-2',
    title: 'Pony club meet (sample)',
    description: 'Games on foot and in the saddle for younger cadets. Sample text.',
    venue: 'Arena, Demo Hub Two',
    startsAt: at(6, 9, 30),
    endsAt: at(6, 11, 30),
    rsvpClosesAt: at(5, 18),
    capacity: 16,
    taken: 9,
    status: 'published',
    image: null,
    seats: {},
  },
];

// ------------------------------------------------------------------ Spark (per child; streaks off: D18 PROPOSED)
const sparkContent = {
  id: 'syn-spark-today',
  title: 'Soft hands, calm seat',
  subtitle: 'Breathe with the horse before you mount. Sample copy, not academy content.',
  durationMs: 30000,
  audio: { uri: 'fixture://spark/syn-spark-today' },
  peaks: null,
};

export function createFamilyAppFixtures({ latencyMs = DEFAULT_LATENCY }: { latencyMs?: number } = {}): FamilyAppRepositories {
  const consents: FxConsent[] = CONSENT_SEED.map((c) => ({ ...c }));
  const events = EVENT_SEED();
  const sparkAcks = new Map<string, string>([['syn-cadet-a2', at(0, 7, 12)]]);
  const receipts = new Map<string, { key: string; result: unknown }>();
  let seq = 0;

  const linked = (scope: FamilyScope): FamilyChild[] =>
    scope.children ? scope.children.map((c) => ({ id: c.cadetId, firstName: c.firstName, hubId: c.hubId })) : (CHILDREN[scope.subjectId] ?? []);

  /** Mirrors the server: refuses anything outside this persona's family; the error persona fails on purpose. */
  async function guard(scope: FamilyScope, failure: 'error' | 'offline', childId?: string): Promise<FamilyChild | null> {
    await wait(latencyMs);
    if (scope.experience !== 'family') throw new ScopedLoadError('Denied', 'DENIED-FIXTURE', true);
    if (scope.subjectId === 'syn-guardian-err') {
      throw failure === 'offline'
        ? new ScopedLoadError('You’re offline or the academy can’t be reached. Connect and try again.', 'OFFLINE', true)
        : new ScopedLoadError('This information could not be loaded. Try again.', 'ERR-FIXTURE-500', true);
    }
    if (childId === undefined) return null;
    const child = linked(scope).find((c) => c.id === childId);
    if (!child) throw new ScopedLoadError('This isn’t available.', 'NOTFOUND-FIXTURE', true);
    return child;
  }

  /** Same id + same payload → the original answer (duplicate: true); same id + other payload → conflict. */
  function replay<T>(operationId: string, key: string, run: () => T): T & { duplicate: boolean } {
    const prior = receipts.get(operationId);
    if (prior) {
      if (prior.key !== key) throw new FamilyCommandError('conflict', 'operation id already used for a different request', 'PT409');
      return { ...(prior.result as T), duplicate: true };
    }
    const result = run();
    receipts.set(operationId, { key, result });
    return { ...result, duplicate: false };
  }

  const consentState = (childId: string, purpose: string): ConsentState => {
    const p = PURPOSES.find((x) => x.purpose === purpose);
    const latest = consents.filter((c) => c.childId === childId && c.purpose === purpose).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
    return {
      purpose,
      state: latest ? (latest.granted ? 'granted' : 'withdrawn') : 'not_set',
      granted: latest?.granted ?? false,
      allowed: Boolean(latest?.granted && latest.policyVersion === p?.policyVersion),
      policyVersion: latest?.policyVersion ?? null,
      currentPolicyVersion: p?.policyVersion ?? 'draft-1',
      recordedAt: latest?.recordedAt ?? null,
    };
  };

  const eventView = (e: FxEvent, scope: FamilyScope, detail: boolean): FamilyEvent => {
    const now = Date.now();
    const { taken, seats, ...rest } = e;
    return {
      ...rest,
      seatsLeft: Math.max(0, e.capacity - taken),
      rsvpOpen: e.status === 'published' && now < Date.parse(e.rsvpClosesAt) && now < Date.parse(e.startsAt),
      cancellationOpen: detail ? now < Date.parse(e.startsAt) : null,
      children: linked(scope)
        .filter((c) => c.hubId === e.hubId)
        .map((c) => ({ childId: c.id, firstName: c.firstName, status: seats[c.id] ? 'confirmed' : 'not_going' })),
    };
  };

  const findEvent = (scope: FamilyScope, id: string) => {
    const hubs = new Set(linked(scope).map((c) => c.hubId));
    return events.find((e) => e.id === id && hubs.has(e.hubId));
  };

  const sessionsOf = (childId: string) => SESSIONS.filter((x) => x.childId === childId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const summary = ({ id, childId, date, scores, corrected, hasClip }: FxSession): SessionSummary => ({ id, childId, date, scores, corrected, hasClip });
  const PAGE = 8;

  async function commandGuard(scope: FamilyScope, childId: string): Promise<FamilyChild> {
    await wait(latencyMs);
    const child = linked(scope).find((c) => c.id === childId);
    if (!child || scope.subjectId === 'syn-guardian-err') throw new FamilyCommandError('notFound', 'child not found', 'PT404');
    return child;
  }

  const sparkToday = (childId: string): SparkToday => {
    const ack = sparkAcks.get(childId) ?? null;
    return {
      source: SRC,
      cadetId: childId,
      policy: D18_PROPOSED,
      spark: childId === 'syn-cadet-d1' ? null : { ...sparkContent, dateLabel: dayLabel(at(0, 12).slice(0, 10)) },
      acknowledgement: { acknowledged: ack !== null, at: ack },
      streak: { enabled: false, current: null, longest: null },
    };
  };

  return {
    linkedChildren: linked,

    progress: {
      async get(scope, childId) {
        const child = (await guard(scope, 'error', childId)) as FamilyChild;
        const all = sessionsOf(child.id);
        return structuredClone({
          source: SRC,
          childId: child.id,
          currentRank: RANKS[child.id]?.rank ?? 'CADET_SQUIRE',
          sessions: all.slice(0, PAGE).map(summary),
          nextCursor: all.length > PAGE ? String(PAGE) : null,
        });
      },
      async older(scope, childId, cursor) {
        const child = (await guard(scope, 'error', childId)) as FamilyChild;
        const from = Number(cursor);
        const all = sessionsOf(child.id);
        return structuredClone({ sessions: all.slice(from, from + PAGE).map(summary), nextCursor: all.length > from + PAGE ? String(from + PAGE) : null });
      },
      async clips(scope, childId) {
        const child = (await guard(scope, 'error', childId)) as FamilyChild;
        return structuredClone({
          source: SRC,
          clips: sessionsOf(child.id)
            .filter((x) => x.hasClip)
            .map((x) => ({ ...summary(x), clip: { sessionId: x.id, childId: x.childId, date: x.date, objectPath: `synthetic/${x.childId}/${x.id}.mp4` } })),
        });
      },
    },

    sessions: {
      async get(scope, recordId) {
        await guard(scope, 'error');
        const x = SESSIONS.find((v) => v.id === recordId);
        if (!x || !linked(scope).some((c) => c.id === x.childId)) throw new ScopedLoadError('This isn’t available.', 'NOTFOUND-FIXTURE', true);
        return structuredClone({
          source: SRC,
          id: x.id,
          childId: x.childId,
          date: x.date,
          scores: x.scores,
          skills: x.skills,
          notes: x.notes,
          version: x.version,
          corrections: x.corrections,
          clip: x.hasClip ? { sessionId: x.id, childId: x.childId, date: x.date, objectPath: `synthetic/${x.childId}/${x.id}.mp4` } : null,
        });
      },
    },

    media: {
      // No video or image files exist in the preview: clips and event images show "not available", never a stand-in.
      available: false,
      async clipUrl() {
        await wait(latencyMs);
        throw new ScopedLoadError('Synthetic preview: there are no video files.', 'OFF-MEDIA', true);
      },
      async imageUrl() {
        await wait(latencyMs);
        throw new ScopedLoadError('Synthetic preview: there are no image files.', 'OFF-MEDIA', true);
      },
    },

    passport: {
      async get(scope, childId) {
        const child = (await guard(scope, 'error', childId)) as FamilyChild;
        const r = RANKS[child.id] ?? { rank: 'CADET_SQUIRE', code: null, changes: [], achievements: [] };
        const sessions = sessionsOf(child.id).map((x) => ({ id: x.id, sessionDate: x.date, version: x.version, scores: x.scores, skills: x.skills.map(({ id, name }) => ({ id, name })), hasClip: x.hasClip }));
        return structuredClone({
          source: SRC,
          childId: child.id,
          passportCode: r.code,
          input: toPassportInput({ cadetId: child.id, currentRank: r.rank, sessions, rankChanges: r.changes, achievements: r.achievements, dataAsOf: new Date().toISOString() }),
        });
      },
    },

    horse: {
      async get(scope, childId) {
        const child = (await guard(scope, 'offline', childId)) as FamilyChild;
        return structuredClone({ source: SRC, childId: child.id, hubName: child.hubId ? (HUB_NAME[child.hubId] ?? null) : null, horse: HORSES[child.id] ?? null, care: { status: 'unavailable' as const, decisionRef: 'SD-04' } });
      },
    },

    stream: {
      async capability(scope, childId): Promise<StreamCapability> {
        const child = (await guard(scope, 'offline', childId)) as FamilyChild;
        const horseAssigned = Boolean(HORSES[child.id]);
        // Same answer the G9 server gives today: the stream_entitlement flag is off (D23, C03).
        return { status: 'unavailable', reason: horseAssigned ? 'feature_disabled' : 'no_horse', horseAssigned };
      },
    },

    events: {
      async list(scope) {
        await guard(scope, 'offline');
        const hubs = new Set(linked(scope).map((c) => c.hubId));
        const cutoff = Date.now() - 30 * 86_400_000;
        const visible = events
          .filter((e) => hubs.has(e.hubId) && Date.parse(e.endsAt ?? e.startsAt) >= cutoff)
          .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
        return structuredClone({ source: SRC, events: visible.map((e) => eventView(e, scope, false)) });
      },
      async detail(scope, eventId) {
        await guard(scope, 'offline');
        const e = findEvent(scope, eventId);
        if (!e) throw new ScopedLoadError('This isn’t available.', 'NOTFOUND-FIXTURE', true);
        return structuredClone({ source: SRC, event: eventView(e, scope, true) });
      },
      async rsvp(scope, cmd) {
        const child = await commandGuard(scope, cmd.childId);
        const e = findEvent(scope, cmd.eventId);
        if (!e || e.hubId !== child.hubId) throw new FamilyCommandError('notFound', 'event not found for this child', 'PT404');
        return replay(cmd.operationId, `rsvp:${cmd.eventId}:${child.id}`, () => {
          const now = Date.now();
          if (e.status === 'cancelled') throw new FamilyCommandError('conflict', 'event_cancelled: the event was cancelled', 'PT409');
          if (now >= Date.parse(e.startsAt)) throw new FamilyCommandError('conflict', 'event_started: the event has started', 'PT409');
          if (now >= Date.parse(e.rsvpClosesAt)) throw new FamilyCommandError('conflict', 'rsvp_closed: replies closed', 'PT409');
          if (e.seats[child.id]) return { status: 'confirmed' as const, already: true, seatsLeft: e.capacity - e.taken };
          if (e.taken >= e.capacity) throw new FamilyCommandError('conflict', 'event_full: no seats left (no waitlist)', 'PT409');
          e.seats[child.id] = true;
          e.taken += 1;
          return { status: 'confirmed' as const, already: false, seatsLeft: e.capacity - e.taken };
        });
      },
      async cancel(scope, cmd) {
        const child = await commandGuard(scope, cmd.childId);
        const e = findEvent(scope, cmd.eventId);
        if (!e) throw new FamilyCommandError('notFound', 'event not found for this child', 'PT404');
        return replay(cmd.operationId, `cancel:${cmd.eventId}:${child.id}`, () => {
          if (Date.now() >= Date.parse(e.startsAt)) throw new FamilyCommandError('conflict', 'event_started: cancellation closed when the event started', 'PT409');
          const had = Boolean(e.seats[child.id]);
          if (had) {
            delete e.seats[child.id];
            e.taken -= 1;
          }
          return { status: 'cancelled' as const, already: !had, seatsLeft: e.capacity - e.taken };
        });
      },
    },

    consent: {
      async centre(scope) {
        await guard(scope, 'offline');
        return structuredClone({
          source: SRC,
          purposes: PURPOSES,
          children: linked(scope).map((c) => ({ childId: c.id, firstName: c.firstName, consents: PURPOSES.map((p) => consentState(c.id, p.purpose)) })),
        });
      },
      async history(scope, childId) {
        const child = (await guard(scope, 'offline', childId)) as FamilyChild;
        return structuredClone(
          consents
            .filter((c) => c.childId === child.id)
            .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
            .map<ConsentHistoryEntry>((c) => ({ id: c.id, purpose: c.purpose, granted: c.granted, policyVersion: c.policyVersion, recordedAt: c.recordedAt, byCurrentGuardian: true })),
        );
      },
      async set(scope, cmd) {
        const child = await commandGuard(scope, cmd.childId);
        const p = PURPOSES.find((x) => x.purpose === cmd.purpose);
        if (!p) throw new FamilyCommandError('invalid', 'unknown consent purpose', 'PT422');
        return replay(cmd.operationId, `consent:${child.id}:${cmd.purpose}:${cmd.granted}:${cmd.policyVersion}`, () => {
          if (cmd.granted && cmd.policyVersion !== p.policyVersion) throw new FamilyCommandError('conflict', 'the consent wording changed', 'PT409');
          const cur = consentState(child.id, cmd.purpose);
          const changed = cur.state === 'not_set' || cur.granted !== cmd.granted;
          const recordedAt = new Date().toISOString();
          if (changed) consents.push({ id: `syn-cr-${++seq + 100}`, childId: child.id, purpose: cmd.purpose, granted: cmd.granted, policyVersion: p.policyVersion, recordedAt });
          return { granted: cmd.granted, recordedAt: changed ? recordedAt : cur.recordedAt, changed };
        });
      },
    },

    spark: {
      createAudio: createSimulatedSparkAudio,
      repository: {
        async getToday(scope) {
          const child = (await guard({ subjectId: scope.subjectId, experience: scope.experience, children: scope.children }, 'error', scope.cadetId ?? '')) as FamilyChild;
          return structuredClone(sparkToday(child.id));
        },
        async acknowledge(scope, req) {
          const child = await commandGuard({ subjectId: scope.subjectId, experience: 'family', children: scope.children }, req.cadetId);
          return replay(req.operationId, `spark:${child.id}:${req.sparkId}`, () => {
            const prev = sparkAcks.get(child.id);
            const when = prev ?? new Date().toISOString();
            sparkAcks.set(child.id, when);
            return { acknowledgedAt: when, already: Boolean(prev) };
          });
        },
      },
    },
  };
}
