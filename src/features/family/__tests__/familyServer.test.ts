/**
 * Client side of the Family server contract (BACKEND_CONTRACT_V2 G9 + SLICE_CONTRACT §B), against the fake supabase
 * client. RPC names and argument keys are checked against the migration SQL itself
 * (server/live-delta/g9-app-surfaces/migrations/20261105000100_app_surfaces.sql). Server-side isolation (guardian A
 * cannot read guardian B's child) is proven by the SQL suites: 91_g9_family_tests.sql, 94_g9_security_tests.sql and
 * foundations 80_mobile_authorization_tests.sql. Here we prove the CLIENT never asks for an id outside the snapshot.
 */
import fs from 'fs';
import path from 'path';

import { ScopedLoadError } from '@/core/data/useScopedResource';
import { createFakeSupabase, networkFailure, ok, pgError, type FakeCall, type FakeResult } from '@/testing/fakeSupabase';

import { FamilyCommandError } from '../data/repositories';
import { CLIP_URL_TTL_S, createFamilyAppServer, PAGE_SIZE, type StorageLike } from '../data/server';
import type { FamilyScope } from '../types';

const MIG9 = path.resolve(__dirname, '../../../../../server/live-delta/g9-app-surfaces/migrations/20261105000100_app_surfaces.sql');
const _hasMig9 = (() => { try { fs.accessSync(MIG9); return true; } catch { return false; } })();
/** public.<fn>(p_a type, p_b type) → { fn: ['p_a', 'p_b'] } straight from the migration. */
function migrationSignatures(): Record<string, string[]> {
  const sql = (() => { try { return fs.readFileSync(MIG9, 'utf8'); } catch { return ''; } })();
  const out: Record<string, string[]> = {};
  for (const m of sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)) {
    out[m[1] as string] = (m[2] ?? '')
      .split(',')
      .map((p) => p.trim().split(/\s+/)[0] ?? '')
      .filter(Boolean);
  }
  return out;
}

const HUB = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-00000000c001'; // guardian A's child
const C2 = '00000000-0000-4000-8000-00000000c002'; // guardian B's child (never in A's snapshot)
const EV = '00000000-0000-4000-8000-0000000000e1';
const OP = '00000000-0000-4000-8000-0000000000f1';
const SP = '00000000-0000-4000-8000-0000000000s1'.replace('s', '5');
const T1 = '00000000-0000-4000-8000-0000000000d1';
const T2 = '00000000-0000-4000-8000-0000000000d2';
const T9 = '00000000-0000-4000-8000-0000000000d9';

const scopeA: FamilyScope = { subjectId: 'guardian-a', experience: 'family', children: [{ cadetId: C1, firstName: 'Aarav', hubId: HUB }] };
const clipPath = (cadet: string, f = 'clip.mp4') => `${HUB}/${cadet}/${f}`;

const consentCentre = (allowed: boolean, cadet = C1) =>
  ok({
    purposes: [
      { purpose: 'session_video', title: 'Session video', description: 'Clips', policy_version: 'draft-1' },
      { purpose: 'care_photo', title: 'Care photos', description: null, policy_version: 'draft-1' },
    ],
    children: [
      {
        cadet_id: cadet,
        first_name: 'Aarav',
        consents: [
          { purpose: 'session_video', state: allowed ? 'granted' : 'withdrawn', granted: allowed, allowed, policy_version: 'draft-1', current_policy_version: 'draft-1', recorded_at: '2026-11-05T02:00:00+00:00', consent_id: 'x' },
          { purpose: 'care_photo', state: 'not_set', granted: false, allowed: false, policy_version: null, current_policy_version: 'draft-1', recorded_at: null, consent_id: null },
        ],
      },
      // A stray row the client must never surface (defence in depth; the RPC only returns the caller's children).
      { cadet_id: C2, first_name: 'Other family', consents: [] },
    ],
  });

const event = (o: Record<string, unknown> = {}) => ({
  event_id: EV,
  hub_id: HUB,
  title: 'Open day',
  description: 'Display ride',
  venue: 'Main arena',
  starts_at: '2026-11-14T04:30:00+00:00',
  ends_at: '2026-11-14T07:30:00+00:00',
  rsvp_closes_at: '2026-11-13T12:30:00+00:00',
  capacity: 40,
  seats_left: 12,
  status: 'published',
  image_object_path: null,
  rsvp_open: true,
  children: [
    { cadet_id: C1, first_name: 'Aarav', rsvp_status: 'confirmed', rsvp_id: 'r1' },
    { cadet_id: C2, first_name: 'Stray', rsvp_status: 'not_going', rsvp_id: null },
  ],
  ...o,
});

function fakeStorage(signed: string | null = 'https://storage.example/signed?token=abc') {
  const calls: { bucket: string; path: string; ttl: number }[] = [];
  const storage: StorageLike = {
    from: (bucket: string) => ({
      createSignedUrl: (p: string, ttl: number) => {
        calls.push({ bucket, path: p, ttl });
        return Promise.resolve(signed ? { data: { signedUrl: signed }, error: null } : { data: null, error: { statusCode: '400', message: 'Object not found' } });
      },
    }),
  };
  return { storage, calls };
}

function setup(opts: { tables?: Record<string, Record<string, unknown>[]>; rpc?: Record<string, (a: Record<string, unknown>) => FakeResult>; signed?: string | null; storage?: boolean } = {}) {
  const fake = createFakeSupabase({ tables: opts.tables, rpc: opts.rpc });
  const st = fakeStorage(opts.signed);
  const client = opts.storage === false ? fake.client : Object.assign(Object.create(null), fake.client, { storage: st.storage });
  return { repos: createFamilyAppServer(client), calls: fake.calls, storageCalls: st.calls };
}
const rpcCalls = (calls: FakeCall[]) => calls.filter((c): c is Extract<FakeCall, { kind: 'rpc' }> => c.kind === 'rpc');
const refOf = (e: unknown) => (e instanceof ScopedLoadError ? e.reference : e instanceof FamilyCommandError ? `${e.kind}:${e.reference}` : String(e));

(_hasMig9 ? describe : describe.skip)('RPC names and argument keys match the G9 migration exactly', () => {
  it('every RPC the Family client sends exists with exactly these parameters (all required, none extra)', async () => {
    const sig = migrationSignatures();
    const { repos, calls } = setup({
      rpc: {
        app_consent_centre: () => consentCentre(true),
        app_consent_history: () => ok([]),
        app_set_media_consent: () => ok({ consent_id: 'x', cadet_id: C1, purpose: 'session_video', granted: false, policy_version: 'draft-1', recorded_at: '2026-11-05T02:00:00+00:00', changed: true, duplicate: false }),
        app_list_events: () => ok([event()]),
        app_event_detail: () => ok({ ...event(), cancellation_open: true }),
        app_rsvp_event: () => ok({ rsvp_id: 'r', event_id: EV, cadet_id: C1, status: 'confirmed', already_confirmed: false, seats_left: 11, duplicate: false }),
        app_cancel_rsvp: () => ok({ rsvp_id: 'r', event_id: EV, cadet_id: C1, status: 'cancelled', already_cancelled: false, seats_left: 12, duplicate: false }),
        app_spark_today: () => ok({ cadet_id: C1, hub_id: HUB, local_date: '2026-11-05', timezone: 'Asia/Kolkata', spark: null, acknowledged: false, acknowledged_at: null, streak: { enabled: false, current: null, longest: null } }),
        app_ack_spark: () => ok({ ack_id: 'a', cadet_id: C1, spark_id: SP, local_date: '2026-11-05', acknowledged_at: '2026-11-05T01:42:00+00:00', already_acknowledged: false, duplicate: false }),
        app_stream_capability: () => ok({ capability: 'stall_stream', status: 'unavailable', reason: 'feature_disabled', cadet_id: C1, horse_assigned: true, decision_ref: 'D23, C03' }),
      },
    });
    await repos.consent.centre(scopeA);
    await repos.consent.history(scopeA, C1);
    await repos.consent.set(scopeA, { childId: C1, purpose: 'session_video', granted: false, policyVersion: 'draft-1', operationId: OP });
    await repos.events.list(scopeA);
    await repos.events.detail(scopeA, EV);
    await repos.events.rsvp(scopeA, { eventId: EV, childId: C1, operationId: OP });
    await repos.events.cancel(scopeA, { eventId: EV, childId: C1, operationId: OP });
    await repos.spark!.repository.getToday({ subjectId: 'guardian-a', experience: 'family', cadetId: C1, children: scopeA.children });
    await repos.spark!.repository.acknowledge!({ subjectId: 'guardian-a', experience: 'family', children: scopeA.children }, { cadetId: C1, sparkId: SP, operationId: OP });
    await repos.stream.capability(scopeA, C1);

    const sent = rpcCalls(calls);
    expect(new Set(sent.map((c) => c.fn))).toEqual(
      new Set(['app_consent_centre', 'app_consent_history', 'app_set_media_consent', 'app_list_events', 'app_event_detail', 'app_rsvp_event', 'app_cancel_rsvp', 'app_spark_today', 'app_ack_spark', 'app_stream_capability']),
    );
    for (const c of sent) {
      expect(sig[c.fn]).toBeDefined();
      expect(Object.keys(c.args).sort()).toEqual([...(sig[c.fn] ?? [])].sort());
      for (const v of Object.values(c.args)) expect(v).not.toBeUndefined(); // every parameter is required (no SQL defaults)
    }
    expect(sent.find((c) => c.fn === 'app_set_media_consent')?.args).toEqual({ p_cadet_id: C1, p_purpose: 'session_video', p_granted: false, p_policy_version: 'draft-1', p_operation_id: OP });
    expect(sent.find((c) => c.fn === 'app_rsvp_event')?.args).toEqual({ p_event_id: EV, p_cadet_id: C1, p_operation_id: OP });
  });
});

describe('guardian A never requests guardian B’s child (client gate = access snapshot)', () => {
  it.each([
    ['progress', (r: ReturnType<typeof setup>['repos']) => r.progress.get(scopeA, C2)],
    ['older sessions', (r: ReturnType<typeof setup>['repos']) => r.progress.older(scopeA, C2, `2026-11-01|${T1}`)],
    ['clips', (r: ReturnType<typeof setup>['repos']) => r.progress.clips(scopeA, C2)],
    ['passport', (r: ReturnType<typeof setup>['repos']) => r.passport.get(scopeA, C2)],
    ['horse', (r: ReturnType<typeof setup>['repos']) => r.horse.get(scopeA, C2)],
    ['stream capability', (r: ReturnType<typeof setup>['repos']) => r.stream.capability(scopeA, C2)],
    ['consent history', (r: ReturnType<typeof setup>['repos']) => r.consent.history(scopeA, C2)],
    ['spark', (r: ReturnType<typeof setup>['repos']) => r.spark!.repository.getToday({ subjectId: 'guardian-a', experience: 'family', cadetId: C2, children: scopeA.children })],
    ['clip URL', (r: ReturnType<typeof setup>['repos']) => r.media.clipUrl(scopeA, { sessionId: T9, childId: C2, date: '2026-11-01', objectPath: clipPath(C2) })],
  ])('%s: refused before any request', async (_name, run) => {
    const s = setup({ rpc: { app_consent_centre: () => consentCentre(true, C2) } });
    const e = await run(s.repos).catch((x: unknown) => x);
    expect(refOf(e)).toMatch(/^NOTFOUND-CHILD/);
    expect(s.calls).toHaveLength(0);
    expect(s.storageCalls).toHaveLength(0);
  });

  it.each([
    ['rsvp', (r: ReturnType<typeof setup>['repos']) => r.events.rsvp(scopeA, { eventId: EV, childId: C2, operationId: OP })],
    ['cancel', (r: ReturnType<typeof setup>['repos']) => r.events.cancel(scopeA, { eventId: EV, childId: C2, operationId: OP })],
    ['consent', (r: ReturnType<typeof setup>['repos']) => r.consent.set(scopeA, { childId: C2, purpose: 'session_video', granted: true, policyVersion: 'draft-1', operationId: OP })],
    ['spark ack', (r: ReturnType<typeof setup>['repos']) => r.spark!.repository.acknowledge!({ subjectId: 'guardian-a', experience: 'family', children: scopeA.children }, { cadetId: C2, sparkId: SP, operationId: OP })],
  ])('command %s for another family’s child: refused before any request', async (_n, run) => {
    const s = setup();
    const e = await run(s.repos).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FamilyCommandError);
    expect((e as FamilyCommandError).kind).toBe('notFound');
    expect(s.calls).toHaveLength(0);
  });

  it('a session id that RLS would return for a child outside the snapshot is still not shown', async () => {
    const { repos } = setup({ tables: { training_sessions: [{ id: T9, cadet_id: C2, session_date: '2026-11-01', riding_score: 9, ground_score: 9, stable_score: 9, version: 1, brass_stamp_verified: true }] } });
    expect(refOf(await repos.sessions.get(scopeA, T9).catch((x: unknown) => x))).toBe('NOTFOUND-SESSION');
  });

  it('a malformed deep-link id makes no request; RSVP/consent/event lists drop children outside the snapshot', async () => {
    const s = setup({ rpc: { app_list_events: () => ok([event()]), app_consent_centre: () => consentCentre(true) } });
    expect(refOf(await s.repos.sessions.get(scopeA, '../../etc').catch((x: unknown) => x))).toBe('NOTFOUND-ID');
    expect(refOf(await s.repos.events.detail(scopeA, 'not-a-uuid').catch((x: unknown) => x))).toBe('NOTFOUND-ID');
    expect(s.calls).toHaveLength(0);
    const list = await s.repos.events.list(scopeA);
    expect(list.events[0]?.children.map((c) => c.childId)).toEqual([C1]);
    const centre = await s.repos.consent.centre(scopeA);
    expect(centre.children.map((c) => c.childId)).toEqual([C1]);
  });

  it('a guardian with no linked child: no event request at all', async () => {
    const s = setup();
    expect(await s.repos.events.list({ ...scopeA, children: [] })).toEqual({ source: 'server', events: [] });
    expect(s.calls).toHaveLength(0);
  });
});

describe('progress and session detail (published, current revision only)', () => {
  const sessions = [
    { id: T1, cadet_id: C1, session_date: '2026-11-07', riding_score: 8, ground_score: 6, stable_score: 8, version: 2, video_log_s3_url: clipPath(C1), brass_stamp_verified: true, instructor_notes: '  Soft hands next.  ' },
    { id: T2, cadet_id: C1, session_date: '2026-10-31', riding_score: 7, ground_score: 6, stable_score: 8, version: 1, video_log_s3_url: clipPath(C2), brass_stamp_verified: true, instructor_notes: null },
    { id: T9, cadet_id: C1, session_date: '2026-11-08', riding_score: 3, ground_score: 3, stable_score: 3, version: 1, video_log_s3_url: null, brass_stamp_verified: false },
    { id: 'legacy', cadet_id: C1, session_date: '2026-09-01', riding_score: null, ground_score: null, stable_score: null, version: 1, video_log_s3_url: null, brass_stamp_verified: true },
  ];
  const tables = {
    cadets: [{ id: C1, current_rank: 'CADET_RIDER', passport_code: 'BSAH-26-F3A00001', assigned_horse_id: 'h1' }],
    training_sessions: sessions,
    session_skills: [{ session_id: T1, skill_id: 'k2' }, { session_id: T1, skill_id: 'k1' }],
    skills: [{ id: 'k1', name: 'Tacking up', category: 'STABLE' }, { id: 'k2', name: 'Rising trot', category: 'RIDING' }],
    training_session_corrections: [{ session_id: T1, corrected_at: '2026-11-08T05:40:00+00:00', reason: 'Riding score re-entered' }],
    rank_history: [{ id: 'rh1', cadet_id: C1, from_rank: 'CADET_SQUIRE', to_rank: 'CADET_RIDER', promoted_at: '2026-10-17T11:00:00+00:00' }],
    achievements: [{ id: 'a1', cadet_id: C1, achievement_type: 'MILESTONE', title: 'First canter', awarded_at: '2026-10-24T10:30:00+00:00' }],
  };

  it('lists published, scored sessions newest first with a keyset cursor; never an unsealed or another cadet’s clip path', async () => {
    const { repos, calls } = setup({ tables });
    const p = await repos.progress.get(scopeA, C1);
    expect(p.currentRank).toBe('CADET_RIDER');
    expect(p.sessions.map((s) => [s.id, s.corrected, s.hasClip])).toEqual([
      [T1, true, true],
      [T2, false, false], // a path under another cadet is not a clip of this child
    ]);
    const q = calls.find((c) => c.kind === 'from' && c.table === 'training_sessions');
    expect(q && q.kind === 'from' ? q.ops : []).toEqual([
      ['select', 'id, cadet_id, session_date, riding_score, ground_score, stable_score, version, video_log_s3_url'],
      ['eq', 'cadet_id', C1],
      ['eq', 'brass_stamp_verified', true],
      ['order', 'session_date', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', PAGE_SIZE + 1],
    ]);
  });

  it('pages older sessions by (session_date, id) and refuses a tampered cursor', async () => {
    const ops: unknown[][] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'or', 'order', 'limit']) builder[m] = (...a: unknown[]) => (ops.push([m, ...a]), builder);
    builder.then = (res: (v: FakeResult) => unknown) => Promise.resolve(ok([])).then(res);
    const client = { from: () => builder, rpc: () => Promise.resolve(ok(null)) } as unknown as Parameters<typeof createFamilyAppServer>[0];
    const repos = createFamilyAppServer(client);
    await repos.progress.older(scopeA, C1, `2026-10-31|${T2}`);
    expect(ops).toContainEqual(['or', `session_date.lt.2026-10-31,and(session_date.eq.2026-10-31,id.lt.${T2})`]);
    const before = ops.length;
    expect(refOf(await repos.progress.older(scopeA, C1, '2026-10-31|x),id.gt.0').catch((x: unknown) => x))).toBe('NOTFOUND-CURSOR');
    expect(ops.length).toBe(before);
  });

  it('session detail: scores, sorted skills, trimmed notes, the latest correction, and a clip handle (no URL yet)', async () => {
    const { repos, storageCalls } = setup({ tables });
    const d = await repos.sessions.get(scopeA, T1);
    expect(d).toMatchObject({
      id: T1,
      childId: C1,
      scores: { riding: 8, ground: 6, stable: 8 },
      skills: [{ name: 'Rising trot', category: 'RIDING' }, { name: 'Tacking up', category: 'STABLE' }],
      notes: 'Soft hands next.',
      version: 2,
      corrections: [{ at: '2026-11-08T05:40:00+00:00', reason: 'Riding score re-entered' }],
      clip: { sessionId: T1, childId: C1, objectPath: clipPath(C1) },
    });
    expect(storageCalls).toHaveLength(0); // the URL is fetched only when the guardian presses Play
    expect(refOf(await repos.sessions.get(scopeA, T9).catch((x: unknown) => x))).toBe('NOTFOUND-SESSION'); // unsealed
  });

  it('passport: server rank, rank_history timeline, achievements, published sessions only', async () => {
    const { repos } = setup({ tables });
    const p = await repos.passport.get(scopeA, C1);
    expect(p.passportCode).toBe('BSAH-26-F3A00001');
    expect(p.input.serverCurrentRank).toBe('CADET_RIDER');
    expect(p.input.rankEvents.map((e) => [e.rank, e.previousRank])).toEqual([['CADET_RIDER', 'CADET_SQUIRE']]);
    expect(p.input.badgeEvents.map((b) => b.label)).toEqual(['First canter']);
    expect(p.input.sessions.map((s) => s.id)).toEqual([T1, T2]);
  });

  it('horse: safe columns only (no microchip, no camera link) and care stays unavailable', async () => {
    const { repos, calls } = setup({ tables: { ...tables, equine_fleet: [{ id: 'h1', name: 'Badal', breed: 'Marwari', height_hands: '15.1', temperament: 'Calm', is_active: true }], school_hubs: [{ id: HUB, school_name: 'Hub A' }] } });
    const h = await repos.horse.get(scopeA, C1);
    expect(h).toMatchObject({ hubName: 'Hub A', horse: { name: 'Badal', heightHands: 15.1 }, care: { status: 'unavailable' } });
    const fleet = calls.find((c) => c.kind === 'from' && c.table === 'equine_fleet');
    const select = fleet && fleet.kind === 'from' ? String(fleet.ops[0]?.[1]) : '';
    expect(select).not.toMatch(/microchip|cctv|rtsp|\*/);
  });
});

describe('private video: consent gate and short-lived URL', () => {
  const clip = { sessionId: T1, childId: C1, date: '2026-11-07', objectPath: clipPath(C1) };

  it('missing consent blocks the clip: no signed URL is requested', async () => {
    const s = setup({ rpc: { app_consent_centre: () => consentCentre(false) } });
    const e = await s.repos.media.clipUrl(scopeA, clip).catch((x: unknown) => x);
    expect(refOf(e)).toBe('CONSENT-session_video');
    expect(s.storageCalls).toHaveLength(0);
  });

  it('consent that cannot be checked also blocks the clip (fails closed)', async () => {
    const s = setup({ rpc: { app_consent_centre: () => networkFailure() } });
    expect(refOf(await s.repos.media.clipUrl(scopeA, clip).catch((x: unknown) => x))).toBe('OFFLINE');
    expect(s.storageCalls).toHaveLength(0);
  });

  it('allowed consent → a signed URL from the private session-videos bucket with a short TTL', async () => {
    const s = setup({ rpc: { app_consent_centre: () => consentCentre(true) } });
    const before = Date.now();
    const m = await s.repos.media.clipUrl(scopeA, clip);
    expect(s.storageCalls).toEqual([{ bucket: 'session-videos', path: clipPath(C1), ttl: CLIP_URL_TTL_S }]);
    expect(CLIP_URL_TTL_S).toBeLessThanOrEqual(300);
    expect(m.uri).toMatch(/^https:/);
    expect(m.expiresAt).toBeGreaterThanOrEqual(before + CLIP_URL_TTL_S * 1000);
  });

  it('a path outside this child’s folder, or with traversal, is refused before consent or storage', async () => {
    const s = setup({ rpc: { app_consent_centre: () => consentCentre(true) } });
    for (const objectPath of [clipPath(C2), `${HUB}/${C1}/../x.mp4`, `${C1}/clip.mp4`]) {
      expect(refOf(await s.repos.media.clipUrl(scopeA, { ...clip, objectPath }).catch((x: unknown) => x))).toBe('NOTFOUND-CLIP');
    }
    expect(s.calls).toHaveLength(0);
    expect(s.storageCalls).toHaveLength(0);
  });

  it('a build without a storage client reports media as unavailable', async () => {
    const s = setup({ storage: false, rpc: { app_consent_centre: () => consentCentre(true) } });
    expect(s.repos.media.available).toBe(false);
    expect(refOf(await s.repos.media.clipUrl(scopeA, clip).catch((x: unknown) => x))).toBe('OFF-MEDIA');
  });
});

describe('events and RSVP commands', () => {
  it('maps a list row; the detail adds cancellation_open; never a waitlist', async () => {
    const s = setup({ rpc: { app_list_events: () => ok([event({ status: 'cancelled', rsvp_open: false })]), app_event_detail: () => ok({ ...event(), image_bucket: null, cancellation_open: true }) } });
    const list = await s.repos.events.list(scopeA);
    expect(list.events[0]).toMatchObject({ status: 'cancelled', rsvpOpen: false, cancellationOpen: null, seatsLeft: 12 });
    const d = await s.repos.events.detail(scopeA, EV);
    expect(d.event).toMatchObject({ cancellationOpen: true, children: [{ childId: C1, status: 'confirmed' }] });
  });

  it('server answers become typed failures: event_full conflict, not found, network', async () => {
    let n = 0;
    const s = setup({
      rpc: {
        app_rsvp_event: () => [pgError('PT409', 'event_full: no seats left (no waitlist)', 409), pgError('PT404', 'event not found for this child', 404), networkFailure()][n++ % 3] as FakeResult,
      },
    });
    const cmd = { eventId: EV, childId: C1, operationId: OP };
    const a = (await s.repos.events.rsvp(scopeA, cmd).catch((x: unknown) => x)) as FamilyCommandError;
    expect([a.kind, a.serverMessage.startsWith('event_full:')]).toEqual(['conflict', true]);
    expect(((await s.repos.events.rsvp(scopeA, cmd).catch((x: unknown) => x)) as FamilyCommandError).kind).toBe('notFound');
    expect(((await s.repos.events.rsvp(scopeA, cmd).catch((x: unknown) => x)) as FamilyCommandError).kind).toBe('network');
  });

  it('a replayed operation returns the original answer flagged duplicate (nothing written twice)', async () => {
    const s = setup({ rpc: { app_rsvp_event: () => ok({ rsvp_id: 'r', event_id: EV, cadet_id: C1, status: 'confirmed', already_confirmed: false, seats_left: 11, duplicate: true }) } });
    expect(await s.repos.events.rsvp(scopeA, { eventId: EV, childId: C1, operationId: OP })).toEqual({ status: 'confirmed', seatsLeft: 11, already: false, duplicate: true });
    expect(await s.repos.events.rsvp(scopeA, { eventId: EV, childId: C1, operationId: 'not-a-uuid' }).catch((x: unknown) => (x as FamilyCommandError).kind)).toBe('invalid');
  });
});

describe('consent, Spark and the stream capability', () => {
  it('consent: wording conflict is a conflict; history maps who recorded it', async () => {
    const s = setup({
      rpc: {
        app_set_media_consent: () => pgError('PT409', 'the consent wording changed (current version draft-2): show it again before granting', 409),
        app_consent_history: () => ok([{ consent_id: 'h1', purpose: 'session_video', granted: true, policy_version: 'draft-1', recorded_at: '2026-09-01T02:00:00+00:00', recorded_by_current_guardian: false }]),
      },
    });
    const e = (await s.repos.consent.set(scopeA, { childId: C1, purpose: 'session_video', granted: true, policyVersion: 'draft-1', operationId: OP }).catch((x: unknown) => x)) as FamilyCommandError;
    expect(e.kind).toBe('conflict');
    expect(await s.repos.consent.history(scopeA, C1)).toEqual([{ id: 'h1', purpose: 'session_video', granted: true, policyVersion: 'draft-1', recordedAt: '2026-09-01T02:00:00+00:00', byCurrentGuardian: false }]);
  });

  it('Spark today: signs the audio path, keeps streak numbers null while the flag is off, shows no peaks', async () => {
    const s = setup({
      rpc: {
        app_spark_today: () =>
          ok({
            cadet_id: C1,
            hub_id: HUB,
            local_date: '2026-11-05',
            timezone: 'Asia/Kolkata',
            spark: { spark_id: SP, title: 'Soft hands', audio_bucket: 'app-content', audio_object_path: 'spark/all/b01.mp3', duration_seconds: 30, local_date: '2026-11-05' },
            acknowledged: true,
            acknowledged_at: '2026-11-05T01:42:00+00:00',
            streak: { enabled: false, current: null, longest: null },
          }),
      },
    });
    const t = await s.repos.spark!.repository.getToday({ subjectId: 'guardian-a', experience: 'family', cadetId: C1, children: scopeA.children });
    expect(t).toMatchObject({ source: 'server', cadetId: C1, spark: { id: SP, title: 'Soft hands', durationMs: 30000, peaks: null, audio: { uri: expect.stringMatching(/^https:/) } }, acknowledgement: { acknowledged: true }, streak: { enabled: false, current: null } });
    expect(s.storageCalls[0]).toMatchObject({ bucket: 'app-content', path: 'spark/all/b01.mp3' });
  });

  it('Spark acknowledgement of another day maps to a conflict with the stable prefix', async () => {
    const s = setup({ rpc: { app_ack_spark: () => pgError('PT409', "spark_not_today: this Spark is not today's for the child's hub", 409) } });
    const e = (await s.repos.spark!.repository.acknowledge!({ subjectId: 'g', experience: 'family', children: scopeA.children }, { cadetId: C1, sparkId: SP, operationId: OP }).catch((x: unknown) => x)) as FamilyCommandError;
    expect([e.kind, e.serverMessage.startsWith('spark_not_today:')]).toEqual(['conflict', true]);
  });

  it('stream capability is always unavailable in this delta, and there is no grant source', async () => {
    const s = setup({ rpc: { app_stream_capability: () => ok({ capability: 'stall_stream', status: 'unavailable', reason: 'provider_not_configured', cadet_id: C1, horse_assigned: true, decision_ref: 'D23, C03' }) } });
    expect(await s.repos.stream.capability(scopeA, C1)).toEqual({ status: 'unavailable', reason: 'provider_not_configured', horseAssigned: true });
    expect(s.repos.stream.requestGrant).toBeUndefined();
  });

  it('load failures carry a machine reference for the screen state', async () => {
    const make = (r: FakeResult) => setup({ rpc: { app_stream_capability: () => r } }).repos.stream.capability(scopeA, C1).catch((x: unknown) => refOf(x));
    expect(await make(networkFailure())).toBe('OFFLINE');
    expect(await make(pgError('42501', 'not signed in', 401))).toBe('DENIED-42501');
    expect(await make(pgError('PT404', 'child not found', 404))).toBe('NOTFOUND-PT404');
    expect(await make(pgError('PT403', 'feature switched off', 403))).toBe('OFF-PT403');
    expect(await make(pgError('XX000', 'boom', 500))).toBe('OFFLINE'); // 5xx is treated as "can't reach the academy"
  });
});
