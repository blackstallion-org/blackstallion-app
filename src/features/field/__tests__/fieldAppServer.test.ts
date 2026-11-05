import fs from 'fs';
import path from 'path';

import { createFieldReferenceModel, createModelClient, SYN_HUB_1, SYN_HUB_2, synCadetId, type FieldReferenceModel } from '@/dev/fixtures/fieldApp';
import { createFakeSupabase, networkFailure, ok, pgError } from '@/testing/fakeSupabase';

import { createFieldAppServer, maskPassport } from '../data/server';
import { FieldCommandError } from '../domain/commandErrors';
import type { FieldScope } from '../types';

const NOW = Date.parse('2026-11-05T06:00:00Z'); // 11:30 IST
const op = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const scopeOf = (subjectId: string, hubId: string, role = 'INSTRUCTOR'): FieldScope => ({ subjectId, experience: 'field', hubId, role });
const RAVI = scopeOf('syn-instructor', SYN_HUB_1);
const ANIL = scopeOf('syn-dual', SYN_HUB_2); // instructor at the OTHER hub

function setup(model: FieldReferenceModel = createFieldReferenceModel({ now: () => NOW })) {
  const as = (subjectId: string) => {
    const { client, calls } = createModelClient(model, subjectId);
    return { repos: createFieldAppServer(client, { localNow: () => NOW, timeoutMs: 200 }), calls };
  };
  return { model, as };
}
const kabir = synCadetId(1);
const diya = synCadetId(2);

describe('staff cannot act across hubs (reference server)', () => {
  it('lists and opens only the caller’s hub cadets, even by id', async () => {
    const { as } = setup();
    const anil = as('syn-dual').repos;
    const list = await anil.cadets.list(ANIL);
    expect(list.cadets.map((c) => c.name)).toEqual(['Arjun Bose (sample)', 'Tara Singh (sample)']);
    await expect(anil.cadets.profile(ANIL, kabir)).rejects.toMatchObject({ reference: 'NOT-FOUND' });
    // Even with a forged scope naming hub one, the server's row policies return nothing for this caller.
    await expect(anil.cadets.profile({ ...ANIL, hubId: SYN_HUB_1 }, kabir)).rejects.toMatchObject({ reference: 'NOT-FOUND' });
    expect(await anil.consent.forCadet(ANIL, kabir)).toEqual({ sessionVideo: 'unknown', carePhoto: 'unknown', postureAnalysis: 'unknown' });
  });

  it('refuses another hub’s passport, check-in and session with neutral answers', async () => {
    const { as, model } = setup();
    const ravi = as('syn-instructor').repos;
    const anil = as('syn-dual').repos;
    const e1 = await anil.commands(ANIL).checkIn({ passportCode: 'BSAH-26-SYN00001', observedAt: new Date(NOW), operationId: op(1) }).catch((e: unknown) => e);
    expect(e1).toMatchObject({ kind: 'notFound', message: expect.stringMatching(/No cadet with this passport code at your hub/) });

    const hubOneCheckIn = (await ravi.checkIns.listToday(RAVI)).find((c) => c.cadetId === diya)!;
    const e2 = await anil
      .commands(ANIL)
      .publish({ checkInOperationId: hubOneCheckIn.checkInOperationId, assessment: { riding: 5, ground: 5, stable: 5, notes: null, skillIds: null }, operationId: op(2) })
      .catch((e: unknown) => e);
    expect(e2).toMatchObject({ kind: 'notFound' });

    const session = model.tables.training_sessions.find((s) => s.cadet_id === kabir && s.version === 2)!;
    await expect(anil.sessions.record(ANIL, String(session.id))).rejects.toMatchObject({ reference: 'NOT-FOUND' });
    const e3 = await anil
      .commands(ANIL)
      .correct({ sessionId: String(session.id), expectedVersion: 2, scores: { riding: 1, ground: 1, stable: 1 }, notes: null, reason: 'Trying from hub two', operationId: op(3) })
      .catch((e: unknown) => e);
    expect(e3).toMatchObject({ kind: 'forbidden' });
    expect(session.riding_score).toBe(7); // unchanged
    expect(model.tables.training_sessions.filter((s) => s.check_in_id === hubOneCheckIn.checkInId)).toHaveLength(0);
  });

  it('grooms read no cadet records and cannot check in', async () => {
    const { as } = setup();
    const groom = as('syn-groom').repos;
    const g = scopeOf('syn-groom', SYN_HUB_1, 'GROOM');
    expect((await groom.cadets.list(g)).cadets).toEqual([]);
    await expect(groom.commands(g).checkIn({ passportCode: 'BSAH-26-SYN00004', observedAt: new Date(NOW), operationId: op(4) })).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('retries never duplicate (reference server)', () => {
  it('a replayed check-in returns the same row; another instructor’s scan the same day is "already checked in"', async () => {
    const { as, model } = setup();
    const ravi = as('syn-instructor').repos.commands(RAVI);
    const req = { passportCode: 'BSAH-26-SYN00004', observedAt: new Date(NOW), operationId: op(10) };
    const a = await ravi.checkIn(req);
    const b = await ravi.checkIn(req);
    expect(b).toEqual(a);
    expect(a.duplicate).toBe(false);
    const meena = as('syn-instructor-b').repos.commands(scopeOf('syn-instructor-b', SYN_HUB_1));
    const c = await meena.checkIn({ ...req, operationId: op(11) });
    expect(c).toMatchObject({ duplicate: true, checkInOperationId: op(10) });
    expect(model.tables.cadet_check_ins.filter((r) => r.cadet_id === synCadetId(4) && r.session_date === '2026-11-05')).toHaveLength(1);
  });

  it('a replayed publish returns the original session; a new id for a published check-in is a conflict', async () => {
    const { as, model } = setup();
    const repos = as('syn-instructor').repos;
    const ci = (await repos.checkIns.listToday(RAVI)).find((c) => c.cadetId === diya)!;
    const assessment = { riding: 6, ground: 7, stable: 8, notes: 'Calm.', skillIds: null };
    const first = await repos.commands(RAVI).publish({ checkInOperationId: ci.checkInOperationId, assessment, operationId: op(20) });
    const again = await repos.commands(RAVI).publish({ checkInOperationId: ci.checkInOperationId, assessment, operationId: op(20) });
    expect(again).toEqual({ ...first, duplicate: true });
    await expect(repos.commands(RAVI).publish({ checkInOperationId: ci.checkInOperationId, assessment, operationId: op(21) })).rejects.toMatchObject({ kind: 'conflict', message: 'This session was already published.' });
    await expect(repos.commands(RAVI).publish({ checkInOperationId: ci.checkInOperationId, assessment: { ...assessment, riding: 9 }, operationId: op(20) })).rejects.toMatchObject({ kind: 'conflict' });
    expect(model.tables.training_sessions.filter((s) => s.check_in_id === ci.checkInId)).toHaveLength(1);
  });

  it('a replayed correction applies once', async () => {
    const { as, model } = setup();
    const repos = as('syn-instructor').repos;
    const s = model.tables.training_sessions.find((x) => x.cadet_id === kabir && x.version === 2)!;
    const req = { sessionId: String(s.id), expectedVersion: 2, scores: { riding: 8, ground: 7, stable: 8 }, notes: 'Good seat.', reason: 'Riding score was one too low', operationId: op(30) };
    const a = await repos.commands(RAVI).correct(req);
    const b = await repos.commands(RAVI).correct(req);
    expect(a).toMatchObject({ version: 3, duplicate: false });
    expect(b).toMatchObject({ version: 3, duplicate: true, correctionId: a.correctionId });
    expect(s.version).toBe(3);
    expect(model.tables.training_session_corrections.filter((c) => c.session_id === s.id)).toHaveLength(2);
  });
});

describe('corrections need a reason and never overwrite silently', () => {
  it('a stale expected version is a conflict carrying the server version; nothing is written', async () => {
    const { as, model } = setup();
    const repos = as('syn-instructor').repos;
    const s = model.tables.training_sessions.find((x) => x.cadet_id === kabir && x.version === 2)!;
    model.bumpVersion(String(s.id)); // another device corrected it meanwhile
    const e = await repos
      .commands(RAVI)
      .correct({ sessionId: String(s.id), expectedVersion: 2, scores: { riding: 9, ground: 9, stable: 9 }, notes: null, reason: 'Second look', operationId: op(40) })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FieldCommandError);
    expect(e).toMatchObject({ kind: 'conflict', serverVersion: 3, messageKey: 'errors.known.staleVersion' });
    expect(s.riding_score).toBe(7);
  });

  it('server refuses a short reason, an unchanged record and someone else’s session', async () => {
    const { as, model } = setup();
    const repos = as('syn-instructor').repos;
    const mine = model.tables.training_sessions.find((x) => x.cadet_id === kabir && x.version === 2)!;
    const base = { sessionId: String(mine.id), expectedVersion: 2, scores: { riding: 7, ground: 7, stable: 8 }, notes: 'Good seat; work on halts.' };
    await expect(repos.commands(RAVI).correct({ ...base, scores: { riding: 9, ground: 7, stable: 8 }, reason: 'no', operationId: op(41) })).rejects.toMatchObject({ kind: 'invalid', messageKey: 'errors.known.reasonLength' });
    await expect(repos.commands(RAVI).correct({ ...base, reason: 'Checking', operationId: op(42) })).rejects.toMatchObject({ kind: 'invalid', messageKey: 'errors.known.nothingToCorrect' });
    const meenas = model.tables.training_sessions.find((x) => x.instructor_id === 'syn-instructor-b' && x.cadet_id === kabir)!;
    await expect(
      repos.commands(RAVI).correct({ sessionId: String(meenas.id), expectedVersion: 1, scores: { riding: 1, ground: 1, stable: 1 }, notes: null, reason: 'Not mine', operationId: op(43) }),
    ).rejects.toMatchObject({ kind: 'forbidden', messageKey: 'errors.known.notRecorder' });
  });
});

describe('reads and mapping', () => {
  it('cadet list carries today’s state; profile carries consent, history and a masked passport', async () => {
    const { as } = setup();
    const repos = as('syn-instructor').repos;
    const list = await repos.cadets.list(RAVI);
    expect(list.hubName).toBe('Demo Hub One');
    const k = list.cadets.find((c) => c.id === kabir)!;
    expect(k.today).toMatchObject({ time: '09:32', published: true });
    expect(list.cadets.find((c) => c.id === synCadetId(4))!.today).toBeNull();
    const p = await repos.cadets.profile(RAVI, kabir);
    expect(p.cadet).toMatchObject({ name: 'Kabir Mehta (sample)', rank: 'CADET_RIDER', passportHint: 'BSAH-26-••••00001'.replace('00001', '0001'), horseName: 'Badal (sample)' });
    expect(p.consent).toEqual({ sessionVideo: 'allowed', carePhoto: 'allowed', postureAnalysis: 'off' });
    expect(p.today?.publishedSessionId).toBeTruthy();
    expect(p.sessions?.map((x) => x.version)).toEqual([1, 2, 1]);
    expect(p.attendance).toHaveLength(3);
  });

  it('roles that can’t read sessions get null, not "no sessions"', async () => {
    const { as } = setup();
    const admin = scopeOf('syn-hub-admin', SYN_HUB_1, 'SCHOOL_ADMIN');
    const p = await as('syn-hub-admin').repos.cadets.profile(admin, kabir);
    expect(p.sessions).toBeNull();
    expect(p.attendance.every((a) => a.published === null)).toBe(true);
  });

  it('a record includes skills and the correction history with the original values', async () => {
    const { as, model } = setup();
    const s = model.tables.training_sessions.find((x) => x.cadet_id === kabir && x.version === 2)!;
    const r = await as('syn-instructor').repos.sessions.record(RAVI, String(s.id));
    expect(r).toMatchObject({ version: 2, scores: { riding: 7, ground: 7, stable: 8 }, instructorId: 'syn-instructor', skillIds: [expect.any(String)] });
    expect(r.corrections[0]).toMatchObject({ versionBefore: 1, previous: { ground: 5 }, reason: expect.stringMatching(/wrong row/) });
  });

  it('skills: active only; roster: off by default (PT403) and listed when the policy turns it on', async () => {
    const { as, model } = setup();
    const repos = as('syn-instructor').repos;
    expect((await repos.sessions.skills(RAVI)).map((k) => k.name)).not.toContain('Retired skill (sample)');
    expect(await repos.policy.flags(RAVI)).toEqual({ sessionRoster: false });
    await expect(repos.roster.forDate(RAVI, '2026-11-05')).rejects.toMatchObject({ reference: 'FEATURE-OFF' });
    model.setFlag('session_roster', true);
    expect(await repos.policy.flags(RAVI)).toEqual({ sessionRoster: true });
    const rows = await repos.roster.forDate(RAVI, '2026-11-05');
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.cadetId === diya)).toMatchObject({ checkedInAt: '09:35', published: false, sessionVideoAllowed: false });
  });

  it('fails closed: no consent answer means recording off; no flags answer means roster off', async () => {
    const { client } = createFakeSupabase({ rpc: { field_cadet_media_consent: () => networkFailure(), app_policy_flags: () => pgError('PGRST202', 'function not found', 404) } });
    const repos = createFieldAppServer(client, { clock: { offsetMs: async () => 0 }, timeoutMs: 50 });
    expect(await repos.consent.forCadet(RAVI, kabir)).toEqual({ sessionVideo: 'unknown', carePhoto: 'unknown', postureAnalysis: 'unknown' });
    expect(await repos.policy.flags(RAVI)).toEqual({ sessionRoster: false });
  });

  it('network failures on reads become the offline reference; a non-uuid id never reaches the server', async () => {
    const { client, calls } = createFakeSupabase({ failTables: { school_hubs: new TypeError('Network request failed') } });
    const repos = createFieldAppServer(client, { clock: { offsetMs: async () => 0 }, timeoutMs: 50 });
    await expect(repos.cadets.list(RAVI)).rejects.toMatchObject({ reference: 'OFFLINE' });
    const before = calls.length;
    await expect(repos.cadets.profile(RAVI, '../other')).rejects.toMatchObject({ reference: 'NOT-FOUND' });
    expect(calls.length).toBe(before);
  });

  it('masks passport codes', () => {
    expect(maskPassport('BSAH-26-F3A00001')).toBe('BSAH-26-••••0001');
    expect(maskPassport('')).toBeNull();
  });
});

/** Static contract checks against the migrations in this workspace (argument names, reply keys, grants). */
describe('voiding a wrong check-in (FO-06 → FO-16, G9 SD-05 draft)', () => {
  const MEENA = scopeOf('syn-hub-admin', SYN_HUB_1, 'SCHOOL_ADMIN');
  const GROOM = scopeOf('syn-groom', SYN_HUB_1, 'GROOM');

  it('voids today’s unassessed check-in once; replays return the first answer; the cadet leaves Today', async () => {
    const { as, model } = setup();
    const ravi = as('syn-instructor').repos;
    const before = (await ravi.checkIns.listToday(RAVI)).find((c) => c.cadetId === diya)!;
    const profile = await ravi.cadets.profile(RAVI, diya);
    expect(profile.today?.checkInId).toBe(before.checkInId);

    const cmd = ravi.commands(RAVI);
    const first = await cmd.voidCheckIn!({ checkInId: before.checkInId, reason: ' Scanned the wrong passport ', operationId: op(40) });
    expect(first).toMatchObject({ checkInId: before.checkInId, duplicate: false });
    const again = await cmd.voidCheckIn!({ checkInId: before.checkInId, reason: 'Scanned the wrong passport', operationId: op(40) });
    expect(again).toMatchObject({ checkInId: before.checkInId, duplicate: true });
    expect(model.tables.cadet_check_in_voids).toHaveLength(1);
    expect(model.tables.cadet_check_ins.some((r) => r.id === before.checkInId)).toBe(true); // kept, never deleted

    expect((await ravi.checkIns.listToday(RAVI)).some((c) => c.cadetId === diya)).toBe(false);
    expect((await ravi.cadets.profile(RAVI, diya)).today).toBeNull();
    expect((await ravi.cadets.list(RAVI)).cadets.find((c) => c.id === diya)?.today).toBeNull();

    // the same operation id with another reason is refused; a second void is a conflict
    await expect(cmd.voidCheckIn!({ checkInId: before.checkInId, reason: 'Another reason', operationId: op(40) })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(cmd.voidCheckIn!({ checkInId: before.checkInId, reason: 'Scanned the wrong passport', operationId: op(41) })).rejects.toMatchObject({
      kind: 'conflict',
      messageKey: 'errors.known.alreadyVoided',
    });
    // and it can never be published
    await expect(
      cmd.publish({ checkInOperationId: before.checkInOperationId, assessment: { riding: 5, ground: 5, stable: 5, notes: null, skillIds: null }, operationId: op(42) }),
    ).rejects.toMatchObject({ kind: 'conflict', messageKey: 'errors.known.checkInVoided' });
  });

  it('refuses grooms, other hubs, short reasons and published check-ins; hub admins may void', async () => {
    const { as } = setup();
    const ravi = as('syn-instructor').repos;
    const list = await ravi.checkIns.listToday(RAVI);
    const open = list.find((c) => c.published === false)!;
    const published = list.find((c) => c.published === true)!;

    await expect(as('syn-groom').repos.commands(GROOM).voidCheckIn!({ checkInId: open.checkInId, reason: 'Wrong passport', operationId: op(50) })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(as('syn-dual').repos.commands(ANIL).voidCheckIn!({ checkInId: open.checkInId, reason: 'Wrong passport', operationId: op(51) })).rejects.toMatchObject({ kind: 'notFound' });
    await expect(ravi.commands(RAVI).voidCheckIn!({ checkInId: open.checkInId, reason: 'no', operationId: op(52) })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(ravi.commands(RAVI).voidCheckIn!({ checkInId: published.checkInId, reason: 'Wrong passport', operationId: op(53) })).rejects.toMatchObject({
      kind: 'conflict',
      messageKey: 'errors.known.voidPublished',
    });
    await expect(as('syn-hub-admin').repos.commands(MEENA).voidCheckIn!({ checkInId: open.checkInId, reason: 'Wrong passport', operationId: op(54) })).resolves.toMatchObject({ duplicate: false });
  });

  it('a lost reply is a network error that keeps the request safe to repeat', async () => {
    const { client } = createFakeSupabase({ rpc: { field_void_check_in: () => networkFailure() } });
    const e = await createFieldAppServer(client, { clock: { offsetMs: async () => 0 }, timeoutMs: 200 })
      .commands(RAVI)
      .voidCheckIn!({ checkInId: op(60), reason: 'Wrong passport', operationId: op(61) })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FieldCommandError);
    expect(e).toMatchObject({ kind: 'network', retryable: true });
  });
});

describe('contract with the migrations', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../../..', p), 'utf8');
  const MIG = read('foundations/live-delta/migrations/20261104001700_mobile_field_authorization.sql');
  const MIG9 = read('server/live-delta/g9-app-surfaces/migrations/20261105000100_app_surfaces.sql');
  const fn = (sql: string, name: string) => {
    const m = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`, 'i').exec(sql);
    if (!m) throw new Error(`${name} not found`);
    const params = m[1]!.split(',').map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
    const bodyStart = sql.indexOf('$$', m.index) + 2;
    const body = sql.slice(bodyStart, sql.indexOf('$$', bodyStart));
    return { params: params.sort(), body, header: sql.slice(m.index, bodyStart) };
  };
  const sentArgs = async (name: string, run: (r: ReturnType<typeof createFieldAppServer>) => Promise<unknown>) => {
    const { client, calls } = createFakeSupabase({
      rpc: {
        field_correct_session: () => ok({ session_id: op(1), version: 2, correction_id: 'c', duplicate: false }),
        field_cadet_media_consent: () => ok({ cadet_id: kabir, consents: {} }),
        field_session_roster: () => ok([]),
        app_policy_flags: () => ok({}),
        field_void_check_in: () => ok({ check_in_id: op(1), cadet_id: kabir, voided_at: '2026-11-05T06:00:00Z', duplicate: false }),
      },
    });
    await run(createFieldAppServer(client, { clock: { offsetMs: async () => 0 } }));
    const c = calls.find((x) => x.kind === 'rpc' && x.fn === name);
    return c && c.kind === 'rpc' ? Object.keys(c.args ?? {}).sort() : null;
  };

  it('field_correct_session: exact parameters and reply keys', async () => {
    const f = fn(MIG, 'field_correct_session');
    const args = await sentArgs('field_correct_session', (r) =>
      r.commands(RAVI).correct({ sessionId: op(9), expectedVersion: 1, scores: { riding: 5, ground: 5, stable: 5 }, notes: null, reason: 'Wrong row', operationId: op(8) }),
    );
    expect(args).toEqual(f.params);
    for (const k of ['session_id', 'version', 'correction_id', 'duplicate']) expect(f.body).toContain(`'${k}'`);
    expect(f.body).toMatch(/the session changed since it was loaded \(version %\)/); // parsed into serverVersion
  });

  it('MIG9 consent, roster and flags: exact parameters, reply keys and returned columns', async () => {
    expect(await sentArgs('field_cadet_media_consent', (r) => r.consent.forCadet(RAVI, kabir))).toEqual(fn(MIG9, 'field_cadet_media_consent').params);
    expect(fn(MIG9, 'field_cadet_media_consent').body).toMatch(/'cadet_id'[\s\S]*'consents'/);
    expect(await sentArgs('field_session_roster', (r) => r.roster.forDate(RAVI, '2026-11-05'))).toEqual(fn(MIG9, 'field_session_roster').params);
    const roster = fn(MIG9, 'field_session_roster').header;
    for (const col of ['cadet_id', 'first_name', 'last_name', 'current_rank', 'horse_name', 'check_in_id', 'checked_in_at', 'session_id', 'published', 'session_video_allowed']) {
      expect(roster).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(await sentArgs('app_policy_flags', (r) => r.policy.flags(RAVI))).toEqual([]);
    expect(MIG9).toMatch(/'session_roster', false|session_roster[\s\S]{0,80}false/);
  });

  it('G9 field_void_check_in: exact parameters and reply keys', async () => {
    const f = fn(MIG9, 'field_void_check_in');
    expect(await sentArgs('field_void_check_in', (r) => r.commands(RAVI).voidCheckIn!({ checkInId: op(2), reason: 'Wrong passport', operationId: op(3) }))).toEqual(f.params);
    for (const k of ['check_in_id', 'voided_at']) expect(f.body).toContain(`'${k}'`);
    for (const m of ["only today''s check-ins can be voided here", 'this check-in is already voided', 'an assessment is published for this check-in; make a correction instead']) {
      expect(f.body).toContain(m);
    }
    expect(MIG9).toContain("raise exception 'this check-in was voided'");
  });

  it('every function the app calls is executable by signed-in users only', () => {
    expect(MIG).toMatch(/revoke all on function[^;]*public\.field_correct_session\([^;]*from public, anon;/i);
    expect(MIG).toMatch(/grant execute on function[^;]*public\.field_correct_session\([^;]*to authenticated;/i);
    for (const name of ['field_cadet_media_consent', 'field_session_roster', 'app_policy_flags', 'field_void_check_in']) {
      expect(MIG9).toMatch(new RegExp(`revoke all on function[^;]*public\\.${name}\\([^;]*from public, anon;`, 'i'));
      expect(MIG9).toMatch(new RegExp(`grant execute on function[^;]*public\\.${name}\\([^;]*to authenticated;`, 'i'));
    }
  });
});

describe('a voided day is never "already checked in"', () => {
  it('scanning a cadet whose check-in today was voided says so and offers no Assess', async () => {
    const { as } = setup();
    const ravi = as('syn-instructor').repos;
    const diyaToday = (await ravi.checkIns.listToday(RAVI)).find((c) => c.cadetId === diya)!;
    await ravi.commands(RAVI).voidCheckIn!({ checkInId: diyaToday.checkInId, reason: 'Scanned the wrong passport', operationId: op(70) });
    const e = await ravi.commands(RAVI).checkIn({ passportCode: 'BSAH-26-SYN00002', observedAt: new Date(NOW), operationId: op(71) }).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: 'conflict', reference: 'CHECKIN-VOIDED', messageKey: 'errors.known.checkInVoidedToday' });
  });
});
