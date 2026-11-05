import fs from 'fs';
import path from 'path';

import { ScopedLoadError } from '@/core/data/useScopedResource';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { createFakeSupabase, networkFailure, ok, pgError } from '@/testing/fakeSupabase';

import { readAccountConfig } from '../config';
import { createAccountServer } from '../data/server';
import type { AccountScope } from '../data/repositories';

const OP = '11111111-1111-4111-8111-111111111111';
const REQ_ID = '5a3e0c1d-7b2f-4c8e-9d10-2f6a8b4c0e11';
const R = {
  request_id: REQ_ID, status: 'requested', reason: 'moving away', requested_at: '2026-11-05T05:00:00+00:00',
  status_changed_at: '2026-11-05T05:00:00+00:00', status_note: null, version: 1, can_cancel: true,
};
const guardian: AccountScope = {
  subjectId: 'u-1', displayName: 'Guardian (test)', allowedExperiences: ['family'],
  scope: { role: 'PARENT', hubId: null, children: [{ cadetId: 'c-1', firstName: 'Aarav', hubId: 'h-1' }], capabilities: {} },
};
const instructor: AccountScope = {
  subjectId: 'u-2', displayName: 'Instructor (test)', allowedExperiences: ['field'],
  scope: { role: 'INSTRUCTOR', hubId: 'h-9', children: [], capabilities: { recordAssessment: true } },
};
type Client = ReturnType<typeof createFakeSupabase>['client'];
const server = (client: Client) => createAccountServer(client, { timeoutMs: 50, config: readAccountConfig({}) });

describe('SH-08 notification preferences (BACKEND_CONTRACT_V2 §3.4)', () => {
  test('lists with app_notification_preferences() and no arguments', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: {
        app_notification_preferences: () =>
          ok([
            { category: 'check_in', title: 'Arrival check-in', audience: 'family', enabled: true, is_default: true, updated_at: null },
            { category: 'events', title: 'Academy events', audience: 'family', enabled: false, is_default: false, updated_at: '2026-11-05T05:00:00+00:00' },
          ]),
      },
    });
    const rows = await server(client).notifications.list(guardian);
    expect(calls).toEqual([{ kind: 'rpc', fn: 'app_notification_preferences', args: {} }]);
    expect(rows.map((r) => [r.category, r.enabled, r.isDefault])).toEqual([['check_in', true, true], ['events', false, false]]);
  });

  test('sets with every argument, never the subject, and reports success only for a well-formed acknowledgement', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { app_set_notification_preference: () => ok({ category: 'events', enabled: true, updated_at: '2026-11-05T05:01:00+00:00', duplicate: true }) },
    });
    const ack = await server(client).notifications.set(guardian, { category: 'events', enabled: true, operationId: OP });
    expect(calls).toEqual([{ kind: 'rpc', fn: 'app_set_notification_preference', args: { p_category: 'events', p_enabled: true, p_operation_id: OP } }]);
    expect(ack).toEqual({ category: 'events', enabled: true, updatedAt: '2026-11-05T05:01:00+00:00', duplicate: true });

    const bad = createFakeSupabase({ rpc: { app_set_notification_preference: () => ok({ category: 'events' }) } });
    await expect(server(bad.client).notifications.set(guardian, { category: 'events', enabled: true, operationId: OP })).rejects.toMatchObject({ kind: 'unexpected' });
  });

  test('maps refusals and network failures; a bad operation id never reaches the server', async () => {
    const refused = createFakeSupabase({ rpc: { app_set_notification_preference: () => pgError('PT422', 'category not available for this account', 422) } });
    await expect(server(refused.client).notifications.set(guardian, { category: 'x_y_z', enabled: true, operationId: OP })).rejects.toMatchObject({ kind: 'invalid', reference: 'PT422' });
    for (const handler of [() => networkFailure(), () => new Promise<never>(() => undefined)]) {
      const { client } = createFakeSupabase({ rpc: { app_set_notification_preference: handler } });
      const e = await server(client).notifications.set(guardian, { category: 'events', enabled: true, operationId: OP }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(FieldCommandError);
      expect((e as FieldCommandError).retryable).toBe(true);
    }
    const { client, calls } = createFakeSupabase();
    await expect(server(client).notifications.set(guardian, { category: 'events', enabled: true, operationId: 'nope' })).rejects.toMatchObject({ reference: 'CLIENT-OPID' });
    expect(calls).toHaveLength(0);
  });

  test('a load refused for this account carries 42501 (the screen shows permission denied)', async () => {
    const { client } = createFakeSupabase({ rpc: { app_notification_preferences: () => pgError('42501', 'no profile for this account', 403) } });
    const e = await server(client).notifications.list(guardian).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ScopedLoadError);
    expect((e as ScopedLoadError).reference).toBe('42501');
  });
});

describe('SH-10 account deletion (BACKEND_CONTRACT_V2 §3.5)', () => {
  test('status: null and an existing request', async () => {
    const none = createFakeSupabase({ rpc: { app_account_deletion_status: () => ok({ request: null }) } });
    expect(await server(none.client).deletion.status(guardian)).toBeNull();
    expect(none.calls).toEqual([{ kind: 'rpc', fn: 'app_account_deletion_status', args: {} }]);
    const some = createFakeSupabase({ rpc: { app_account_deletion_status: () => ok({ request: R }) } });
    expect(await server(some.client).deletion.status(guardian)).toMatchObject({ requestId: REQ_ID, status: 'requested', reason: 'moving away' });
    const broken = createFakeSupabase({ rpc: { app_account_deletion_status: () => ok({ nope: 1 }) } });
    await expect(server(broken.client).deletion.status(guardian)).rejects.toBeInstanceOf(ScopedLoadError);
  });

  test('request sends the reason (null allowed) and the operation id; already_open is surfaced', async () => {
    const { client, calls } = createFakeSupabase({ rpc: { app_request_account_deletion: () => ok({ ...R, already_open: true, duplicate: false }) } });
    const res = await server(client).deletion.request(guardian, { reason: null, operationId: OP });
    expect(calls).toEqual([{ kind: 'rpc', fn: 'app_request_account_deletion', args: { p_reason: null, p_operation_id: OP } }]);
    expect(res).toMatchObject({ requestId: REQ_ID, alreadyOpen: true, duplicate: false });
    await expect(server(client).deletion.request(guardian, { reason: 'x'.repeat(1001), operationId: OP })).rejects.toMatchObject({ kind: 'invalid' });
    expect(calls).toHaveLength(1);
  });

  test('cancel sends the request id; a request already in review is a conflict', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { app_cancel_account_deletion: () => ok({ ...R, status: 'cancelled', can_cancel: false, version: 2, already_cancelled: false, duplicate: false }) },
    });
    const res = await server(client).deletion.cancel(guardian, { requestId: REQ_ID, operationId: OP });
    expect(calls).toEqual([{ kind: 'rpc', fn: 'app_cancel_account_deletion', args: { p_request_id: REQ_ID, p_operation_id: OP } }]);
    expect(res).toMatchObject({ status: 'cancelled', canCancel: false, alreadyCancelled: false });
    const conflict = createFakeSupabase({ rpc: { app_cancel_account_deletion: () => pgError('PT409', 'the request is in_review and can no longer be cancelled in the app', 409) } });
    await expect(server(conflict.client).deletion.cancel(guardian, { requestId: REQ_ID, operationId: OP })).rejects.toMatchObject({ kind: 'conflict' });
  });
});

describe('SH-04 profile details', () => {
  test('staff: hub name from school_hubs (id + school_name only); guardians: no table read at all', async () => {
    const { client, calls } = createFakeSupabase({ tables: { school_hubs: [{ id: 'h-9', school_name: 'Hub Nine' }, { id: 'h-1', school_name: 'Other' }] } });
    expect(await server(client).profile.get(instructor)).toEqual({ staffRole: 'instructor', hubName: 'Hub Nine', childFirstNames: [], source: 'server' });
    expect(calls).toEqual([{ kind: 'from', table: 'school_hubs', ops: [['select', 'id, school_name'], ['eq', 'id', 'h-9'], ['maybeSingle']] }]);
    const g = createFakeSupabase();
    expect(await server(g.client).profile.get(guardian)).toEqual({ staffRole: null, hubName: null, childFirstNames: ['Aarav'], source: 'server' });
    expect(g.calls).toHaveLength(0);
  });
});

/**
 * Static contract check against the real G9 migration in this workspace: the argument names the app sends must be
 * the function's parameters (all of them: no SQL defaults), and the reply keys the app reads must be built by the
 * function. Catches drift between mobile/ and server/live-delta without a running server; not runtime proof.
 */
describe('contract with server/live-delta/g9-app-surfaces migration (MIG9)', () => {
  const MIG = path.resolve(__dirname, '../../../../../server/live-delta/g9-app-surfaces/migrations/20261105000100_app_surfaces.sql');
  const sql = fs.readFileSync(MIG, 'utf8');
  const fn = (name: string) => {
    const m = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`, 'i').exec(sql);
    if (!m) throw new Error(`${name} not found in migration`);
    const params = m[1]!.split(',').map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
    const bodyStart = sql.indexOf('$$', m.index) + 2;
    const body = sql.slice(bodyStart, sql.indexOf('$$', bodyStart));
    const returns = sql.slice(m.index + m[0].length, bodyStart);
    return { params, body, returns };
  };
  const deletionJson = (() => {
    const i = sql.indexOf('function app_private.g9_deletion_json');
    return sql.slice(i, sql.indexOf('$$;', i));
  })();

  test('argument names and arity match exactly', () => {
    expect(fn('app_notification_preferences').params).toEqual([]);
    expect(fn('app_set_notification_preference').params).toEqual(['p_category', 'p_enabled', 'p_operation_id']);
    expect(fn('app_request_account_deletion').params).toEqual(['p_reason', 'p_operation_id']);
    expect(fn('app_cancel_account_deletion').params).toEqual(['p_request_id', 'p_operation_id']);
    expect(fn('app_account_deletion_status').params).toEqual([]);
  });

  test('reply fields the app reads are produced by the functions', () => {
    const list = fn('app_notification_preferences').returns;
    for (const col of ['category', 'title', 'audience', 'enabled', 'is_default', 'updated_at']) expect(list).toMatch(new RegExp(`\\b${col}\\b`));
    const set = fn('app_set_notification_preference').body;
    for (const k of ["'category'", "'enabled'", "'updated_at'"]) expect(set).toContain(k);
    for (const k of ['request_id', 'status', 'reason', 'requested_at', 'status_changed_at', 'status_note', 'version', 'can_cancel']) expect(deletionJson).toContain(`'${k}'`);
    expect(fn('app_request_account_deletion').body).toContain("'already_open'");
    expect(fn('app_cancel_account_deletion').body).toContain("'already_cancelled'");
    expect(fn('app_account_deletion_status').body).toContain("'request'");
    // `duplicate` is added by the shared replay helper, not by each function.
    expect(sql).toMatch(/g9_replay[\s\S]*'duplicate'/);
  });

  test('categories the app has copy for are the seeded ones (unknown ones fall back to the server title)', () => {
    for (const key of ['check_in', 'assessment_published', 'events', 'spark_daily', 'care_reminders', 'review_escalations']) {
      expect(sql).toContain(`('${key}',`);
    }
  });
});
