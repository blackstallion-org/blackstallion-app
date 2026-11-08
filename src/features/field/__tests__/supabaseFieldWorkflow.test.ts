import fs from 'fs';
import path from 'path';

import { createFakeSupabase, networkFailure, ok, pgError } from '@/testing/fakeSupabase';

import { createServerClock, parseServerTime } from '../data/serverClock';
import { createSupabaseFieldWorkflowRepository } from '../data/supabaseFieldWorkflowRepository';
import { FieldCommandError } from '../domain/commandErrors';

const OP = '11111111-1111-4111-8111-111111111111';
const OTHER_OP = '22222222-2222-4222-8222-222222222222';
const PUB_OP = '33333333-3333-4333-8333-333333333333';
const observedAt = new Date('2026-11-04T05:00:00Z');
const NOW = Date.parse('2026-11-04T05:00:00Z'); // 10:30 IST
const checkInRow = {
  check_in_id: 'ci-1', cadet_id: 'cadet-1', cadet_name: 'Aarav Rao', session_date: '2026-11-04',
  received_at: '2026-11-04T05:00:02Z', duplicate: false,
};
type Client = ReturnType<typeof createFakeSupabase>['client'];
const repo = (client: Client, offset = 0) =>
  createSupabaseFieldWorkflowRepository(client, { clock: { offsetMs: async () => offset }, localNow: () => NOW, timeoutMs: 50 });
const req = { passportCode: 'BSAH-26-F3A00001', observedAt, operationId: OP };

describe('check-in', () => {
  it('calls field_record_check_in with the exact contract and maps the reply', async () => {
    const { client, calls } = createFakeSupabase({ rpc: { field_record_check_in: () => ok(checkInRow) } });
    const r = await repo(client).checkIn(req);
    expect(calls).toEqual([
      { kind: 'rpc', fn: 'field_record_check_in', args: { p_passport_code: 'BSAH-26-F3A00001', p_observed_at: '2026-11-04T05:00:00.000Z', p_operation_id: OP } },
    ]);
    expect(r).toEqual({
      checkInId: 'ci-1', checkInOperationId: OP, cadetId: 'cadet-1', cadetName: 'Aarav Rao', sessionDate: '2026-11-04',
      receivedAt: '2026-11-04T05:00:02Z', duplicate: false, isToday: true,
    });
  });

  it('on an earlier same-day check-in, uses THAT row’s operation id for publishing (contract H3)', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { field_record_check_in: () => ok({ ...checkInRow, duplicate: true }) },
      tables: { cadet_check_ins: [{ id: 'ci-1', client_operation_id: OTHER_OP }] },
    });
    const r = await repo(client).checkIn(req);
    expect(r).toMatchObject({ duplicate: true, checkInOperationId: OTHER_OP });
    expect(calls[1]).toEqual({ kind: 'from', table: 'cadet_check_ins', ops: [['select', 'client_operation_id'], ['eq', 'id', 'ci-1'], ['maybeSingle']] });
  });

  it('treats a replay of our own lost request as a normal check-in, not "already checked in"', async () => {
    const { client } = createFakeSupabase({
      rpc: { field_record_check_in: () => ok({ ...checkInRow, duplicate: true }) },
      tables: { cadet_check_ins: [{ id: 'ci-1', client_operation_id: OP }] },
    });
    expect(await repo(client).checkIn(req)).toMatchObject({ duplicate: false, checkInOperationId: OP });
  });

  it('fails closed when the duplicate row can’t be read back', async () => {
    const { client } = createFakeSupabase({ rpc: { field_record_check_in: () => ok({ ...checkInRow, duplicate: true }) }, tables: { cadet_check_ins: [] } });
    await expect(repo(client).checkIn(req)).rejects.toMatchObject({ kind: 'unexpected', reference: 'CHECKIN-OPID' });
  });

  it('refuses to check in when the phone clock is more than 5 minutes off, before writing anything', async () => {
    const { client, calls } = createFakeSupabase({ rpc: { field_record_check_in: () => ok(checkInRow) } });
    await expect(repo(client, 24 * 3600_000).checkIn(req)).rejects.toMatchObject({ kind: 'invalid', reference: 'CLOCK-SKEW' });
    expect(calls).toHaveLength(0);
  });

  it('flags a check-in filed under another day by the server clock', async () => {
    const { client } = createFakeSupabase({ rpc: { field_record_check_in: () => ok({ ...checkInRow, session_date: '2026-11-03' }) } });
    expect((await repo(client).checkIn(req)).isToday).toBe(false);
  });

  it('never reports success for a malformed reply, but tolerates a missing name', async () => {
    const bad = createFakeSupabase({ rpc: { field_record_check_in: () => ok({ ...checkInRow, check_in_id: undefined }) } });
    await expect(repo(bad.client).checkIn(req)).rejects.toMatchObject({ kind: 'unexpected' });
    const noName = createFakeSupabase({ rpc: { field_record_check_in: () => ok({ ...checkInRow, cadet_name: null }) } });
    expect((await repo(noName.client).checkIn(req)).cadetName).toBe('Cadet');
  });

  it('maps refusals, real supabase-js network failures, rejections and hangs', async () => {
    const refused = createFakeSupabase({ rpc: { field_record_check_in: () => pgError('PT404', 'no cadet with this passport code at your hub', 404) } });
    await expect(repo(refused.client).checkIn(req)).rejects.toMatchObject({ kind: 'notFound' });
    for (const handler of [() => networkFailure(), () => Promise.reject(new TypeError('Network request failed')), () => new Promise<never>(() => undefined)]) {
      const { client } = createFakeSupabase({ rpc: { field_record_check_in: handler } });
      const e = await repo(client).checkIn(req).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(FieldCommandError);
      expect((e as FieldCommandError).retryable).toBe(true);
    }
  });

  it('refuses to send a non-uuid operation id', async () => {
    const { client, calls } = createFakeSupabase();
    await expect(repo(client).checkIn({ ...req, operationId: 'nope' })).rejects.toBeInstanceOf(FieldCommandError);
    expect(calls).toHaveLength(0);
  });
});

describe('server clock', () => {
  it('measures the offset against app_access_snapshot.issuedAt (microseconds tolerated) and caches it', async () => {
    let t = Date.parse('2026-11-04T05:00:00Z');
    const { client, calls } = createFakeSupabase({ rpc: { app_access_snapshot: () => ok({ issuedAt: '2026-11-04T05:03:00.123456+00:00' }) } });
    const clock = createServerClock(client, () => (t += 1000));
    const off = await clock.offsetMs();
    expect(off).toBeGreaterThan(178_000);
    expect(off).toBeLessThan(182_000);
    await clock.offsetMs();
    expect(calls.filter((c) => c.kind === 'rpc')).toHaveLength(1);
    expect(parseServerTime('2026-11-04T05:03:00.123456+00:00')).toBe(Date.parse('2026-11-04T05:03:00.123Z'));
  });
  it('fails closed when the server time can’t be read', async () => {
    const { client } = createFakeSupabase({ rpc: { app_access_snapshot: () => ok({}) } });
    await expect(createServerClock(client).offsetMs()).rejects.toMatchObject({ kind: 'unexpected' });
  });
});

describe('publish', () => {
  const assessment = { riding: 7, ground: 6, stable: 8, notes: 'Good seat.', skillIds: null };

  it('calls field_publish_session with every argument (no server defaults) and no video in slice 1', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { field_publish_session: () => ok({ session_id: 'ts-1', version: 1, session_date: '2026-11-04', duplicate: false }) },
    });
    const r = await repo(client).publish({ checkInOperationId: OP, assessment, operationId: PUB_OP });
    expect(calls[0]).toEqual({
      kind: 'rpc',
      fn: 'field_publish_session',
      args: {
        p_check_in_operation_id: OP, p_riding_score: 7, p_ground_score: 6, p_stable_score: 8,
        p_skill_ids: null, p_notes: 'Good seat.', p_video_object: null, p_operation_id: PUB_OP,
      },
    });
    expect(r).toEqual({ sessionId: 'ts-1', version: 1, sessionDate: '2026-11-04', duplicate: false });
  });

  it('rejects an impossible version and maps already-published to a conflict', async () => {
    const bad = createFakeSupabase({ rpc: { field_publish_session: () => ok({ session_id: 'ts-1', version: 0, session_date: '2026-11-04', duplicate: false }) } });
    await expect(repo(bad.client).publish({ checkInOperationId: OP, assessment, operationId: PUB_OP })).rejects.toMatchObject({ kind: 'unexpected' });
    const dup = createFakeSupabase({ rpc: { field_publish_session: () => pgError('PT409', 'this check-in already has a published session', 409) } });
    await expect(repo(dup.client).publish({ checkInOperationId: OP, assessment, operationId: PUB_OP })).rejects.toMatchObject({
      kind: 'conflict', message: 'This session was already published.',
    });
  });
});

/**
 * Static contract check against the real migration in this workspace: the argument names the app sends must be the
 * function's parameters, and the reply keys the app reads must be built in the function's jsonb_build_object calls.
 * Catches drift between mobile/ and foundations/live-delta without a running server. It does not prove runtime behaviour.
 */
const _hasMigration = (() => { try { fs.accessSync(path.resolve(__dirname, '../../../../../foundations/live-delta/migrations/20261104001700_mobile_field_authorization.sql')); return true; } catch { return false; } })();
(_hasMigration ? describe : describe.skip)('contract with foundations/live-delta migration', () => {
  const MIG = path.resolve(__dirname, '../../../../../foundations/live-delta/migrations/20261104001700_mobile_field_authorization.sql');
  const sql = (() => { try { return fs.readFileSync(MIG, 'utf8'); } catch { return ''; } })();
  const fn = (name: string) => {
    const m = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`, 'i').exec(sql);
    if (!m) throw new Error(`${name} not found in migration`);
    const params = m[1]!.split(',').map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
    const bodyStart = sql.indexOf('$$', m.index) + 2;
    const body = sql.slice(bodyStart, sql.indexOf('$$', bodyStart));
    const built = Array.from(body.matchAll(/jsonb_build_object\(([\s\S]*?)\)\s*;/g), (x) => x[1]!).join('\n');
    return { params, built };
  };
  const sent = async (rpcName: string) => {
    const { client, calls } = createFakeSupabase({
      rpc: {
        field_record_check_in: () => ok(checkInRow),
        field_publish_session: () => ok({ session_id: 'ts', version: 1, session_date: '2026-11-04', duplicate: false }),
      },
    });
    const r = repo(client);
    if (rpcName === 'field_record_check_in') await r.checkIn(req);
    else await r.publish({ checkInOperationId: OP, assessment: { riding: 5, ground: 5, stable: 5, notes: null, skillIds: null }, operationId: PUB_OP });
    const c = calls.find((x) => x.kind === 'rpc');
    return c && c.kind === 'rpc' ? Object.keys(c.args).sort() : [];
  };

  it.each(['field_record_check_in', 'field_publish_session'])('%s: app sends exactly the declared parameters', async (name) => {
    expect(await sent(name)).toEqual([...fn(name).params].sort());
  });

  it('reply keys the app reads are built by the functions’ jsonb_build_object', () => {
    const ci = fn('field_record_check_in').built;
    for (const k of ['check_in_id', 'cadet_id', 'cadet_name', 'session_date', 'received_at', 'duplicate']) expect(ci).toContain(`'${k}'`);
    const pub = fn('field_publish_session').built;
    for (const k of ['session_id', 'version', 'session_date', 'duplicate']) expect(pub).toContain(`'${k}'`);
    expect(sql).toMatch(/'issuedAt',\s*now\(\)/); // the server clock source used by createServerClock
  });

  it('commands and the snapshot are executable by signed-in users only', () => {
    for (const name of ['field_record_check_in', 'field_publish_session', 'app_access_snapshot']) {
      expect(sql).toMatch(new RegExp(`revoke all on function[^;]*public\\.${name}\\([^;]*from public, anon;`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function[^;]*public\\.${name}\\([^;]*to authenticated;`, 'i'));
    }
  });
});
