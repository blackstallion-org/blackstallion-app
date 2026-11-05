// Client side of the FO-08..FO-20 server contract, checked against the SQL in this workspace: the argument names the
// app sends must be exactly the functions' parameters, the reply keys it reads must be built by those functions, and
// errors map to the right outcome. This does not prove runtime behaviour on hosted Supabase (BACKEND_CONTRACT_V2 §9).
import fs from 'fs';
import path from 'path';

import { createFakeSupabase, networkFailure, ok, pgError, type FakeResult } from '@/testing/fakeSupabase';
import { classifyError } from '@/features/sync/domain/worker';

import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';

import { createFieldOpsServer, createSupabaseFieldTransport, mapHorse, toTransportError, type FieldOpsClient } from '../data/server';
import type { FieldOpsScope } from '../domain/types';

const ROOT = path.resolve(__dirname, '../../../../..');
const MIG = fs.readFileSync(path.join(ROOT, 'foundations/live-delta/migrations/20261104001700_mobile_field_authorization.sql'), 'utf8');
const G5 = fs.readFileSync(path.join(ROOT, 'server/live-delta/g5-field-care/migration.sql'), 'utf8');
const G9 = fs.readFileSync(path.join(ROOT, 'server/live-delta/g9-app-surfaces/migrations/20261105000100_app_surfaces.sql'), 'utf8');

function fn(sql: string, schema: 'public' | 'field', name: string) {
  const m = new RegExp(`create (?:or replace )?function ${schema}\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`, 'i').exec(sql);
  if (!m) throw new Error(`${schema}.${name} not found`);
  const params = m[1]!.split(',').map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
  const bodyStart = sql.indexOf('$$', m.index) + 2;
  const body = sql.slice(bodyStart, sql.indexOf('$$', bodyStart));
  return { params: params.sort(), body };
}

const scope: FieldOpsScope = { subjectId: 'u-groom', experience: 'field', hubId: 'hub-1', role: 'GROOM' };
const OP = '11111111-1111-4111-8111-111111111111';

/** Fake with the extra surfaces the field-ops server uses: schema('field').rpc and storage, typed as FieldOpsClient. */
function client(rpc: Record<string, (a: Record<string, unknown>) => FakeResult>, tables: Record<string, Record<string, unknown>[]> = {}) {
  const fake = createFakeSupabase({ rpc, tables });
  const storageCalls: unknown[][] = [];
  // schema('field').rpc('x') is recorded as an rpc call named 'field.x'
  const schemaRpc = (schema: string): DataClient['rpc'] =>
    ((name: string, args?: Record<string, unknown>) => fake.client.rpc(`${schema}.${name}`, args ?? {})) as DataClient['rpc'];
  const c: FieldOpsClient = {
    rpc: fake.client.rpc,
    from: fake.client.from,
    schema: (s: string) => ({ rpc: schemaRpc(s) }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (p: string, ttl: number) => {
          storageCalls.push(['signedUrl', bucket, p, ttl]);
          return { data: { signedUrl: `https://signed/${p}` }, error: null };
        },
        createSignedUploadUrl: async (p: string) => {
          storageCalls.push(['uploadUrl', bucket, p]);
          return { data: { signedUrl: `https://up/${p}`, token: 'tok', path: p }, error: null };
        },
        uploadToSignedUrl: async (p: string, token: string) => {
          storageCalls.push(['upload', bucket, p, token]);
          return { data: {}, error: null };
        },
      }),
    },
  };
  return { c, calls: fake.calls, storageCalls };
}
const argsOf = (calls: ReturnType<typeof createFakeSupabase>['calls'], name: string) => {
  const x = calls.find((k) => k.kind === 'rpc' && k.fn === name);
  return x && x.kind === 'rpc' ? x.args : null;
};

describe('reads', () => {
  test('X01 hub_horses: no arguments, microchip never kept', async () => {
    const { c, calls } = client({ hub_horses: () => ok([{ horse_id: 'h1', hub_id: 'hub-1', name: 'Badal', breed: 'Marwari', microchip_iso_id: '985000000000001', height_hands: '15.1', temperament: 'Calm', is_active: true }]) });
    const repos = createFieldOpsServer(c)!;
    const horses = await repos.horses.listHorses(scope);
    expect(argsOf(calls, 'hub_horses')).toEqual({});
    expect(fn(MIG, 'public', 'hub_horses').params).toEqual([]);
    expect(horses).toEqual([{ horseId: 'h1', hubId: 'hub-1', name: 'Badal', breed: 'Marwari', heightHands: 15.1, temperament: 'Calm', active: true }]);
    expect(JSON.stringify(horses)).not.toContain('985000000000001');
    expect(() => mapHorse({ name: 'x' })).toThrow();
  });

  test('X02 field.my_care_timeline: exact parameters; a hub admin’s 42501 not_field_staff is “not assigned”, other errors are not', async () => {
    const row = { occurrence_id: 'o1', horse_id: 'h1', horse_name: 'Badal', task_type: 'water', slot_key: 'water', local_date: '2026-11-05', due_at: '2026-11-05T06:30:00+00:00', timezone: 'Asia/Kolkata', instructions: 'x', status: 'pending', schedule_version: 1, latest_submission_state: null, overdue: true };
    const { c, calls } = client({ 'field.my_care_timeline': () => ok([row]) });
    const tl = await createFieldOpsServer(c)!.care.timeline(scope, '2026-11-04', '2026-11-06');
    expect(Object.keys(argsOf(calls, 'field.my_care_timeline')!).sort()).toEqual(fn(G5, 'field', 'my_care_timeline').params);
    expect(tl).toMatchObject({ kind: 'ok', occurrences: [{ occurrenceId: 'o1', overdue: true, dueAt: Date.parse('2026-11-05T06:30:00Z') }] });
    const cols = /returns table \(([\s\S]*?)\)\s*language/i.exec(G5.slice(G5.indexOf('function field.my_care_timeline')))![1]!;
    for (const k of Object.keys(row)) expect(cols).toContain(k);
    const admin = client({ 'field.my_care_timeline': () => pgError('42501', 'not_field_staff', 403) });
    expect(await createFieldOpsServer(admin.c)!.care.timeline(scope, '2026-11-05', '2026-11-05')).toEqual({ kind: 'not_assigned_staff' });
    const other = client({ 'field.my_care_timeline': () => pgError('42501', 'access_revoked', 403) });
    await expect(createFieldOpsServer(other.c)!.care.timeline(scope, '2026-11-05', '2026-11-05')).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('X03 shift status reads own staff_attendance rows and their review decisions; no "verified" field', async () => {
    const now = new Date().toISOString();
    const { c, calls } = client(
      { app_policy_flags: () => ok({ attendance_accuracy_threshold_m: { enabled: false, value: null } }) },
      {
        staff_attendance: [{ id: 'a1', user_id: 'u-groom', punch_in_time: now, punch_out_time: null, observed_at: now, accuracy_m: 85, distance_m: 120, verification_state: 'low_accuracy', client_operation_id: OP, biometric_verified: true }],
        app_review_decisions: [],
      },
    );
    const st = await createFieldOpsServer(c)!.shift.status(scope);
    const sel = calls.find((x) => x.kind === 'from' && x.table === 'staff_attendance');
    expect(sel && sel.kind === 'from' ? sel.ops[0] : null).toEqual(['select', 'id, punch_in_time, punch_out_time, observed_at, accuracy_m, distance_m, verification_state, client_operation_id']);
    expect(st.open).toMatchObject({ attendanceId: 'a1', verificationState: 'low_accuracy', accuracyM: 85 });
    expect(JSON.stringify(st)).not.toMatch(/biometric|verified/);
    expect(st).toMatchObject({ photoProof: 'not_supported', thresholdM: null });
  });
});

describe('commands through the outbox transport', () => {
  const tx = (rpc: Record<string, (a: Record<string, unknown>) => FakeResult>) => {
    const k = client(rpc);
    return { ...k, t: createSupabaseFieldTransport(k.c, () => 'hub-1', 50) };
  };

  test('X04 field.submit_care_evidence: exact parameters (operation id + client payload hash) and the receipt keys G5 builds', async () => {
    const { t, calls } = tx({ 'field.submit_care_evidence': () => ok({ receiptId: OP, submissionId: 's1', reviewState: 'review_required', reviewReasons: ['weak_location_accuracy'], outcome: 'recorded', late: false, receivedAt: '2026-11-05T06:31:00Z', replayed: false }) });
    const r = await t.submit({ operationId: OP, actorId: 'u-groom', payloadHash: 'a'.repeat(64), commandType: 'care.submitEvidence', payload: { occurrenceId: 'o1', horseId: 'h1', mediaPath: 'hub-1/u-groom/x.jpg', observedAt: '2026-11-05T06:30:00Z', location: { latitude: 17.4, longitude: 78.5, accuracyM: 85 } } });
    const sentArgs = argsOf(calls, 'field.submit_care_evidence')!;
    expect(Object.keys(sentArgs).sort()).toEqual(fn(G5, 'field', 'submit_care_evidence').params);
    expect(sentArgs).toMatchObject({ p_operation_id: OP, p_payload_hash: 'a'.repeat(64), p_accuracy_m: 85, p_media_path: 'hub-1/u-groom/x.jpg' });
    const built = fn(G5, 'field', 'submit_care_evidence').body;
    for (const k of ['receiptId', 'submissionId', 'reviewState', 'reviewReasons', 'outcome', 'late', 'receivedAt']) expect(built).toContain(`'${k}'`);
    expect(r).toMatchObject({ reviewState: 'review_required', replayed: false });
  });

  test('X05 missing location is sent as nulls (server routes it to review), never invented', async () => {
    const { t, calls } = tx({ 'field.submit_care_evidence': () => ok({ receiptId: OP, reviewState: 'review_required', reviewReasons: ['location_missing'] }) });
    await t.submit({ operationId: OP, actorId: 'u', payloadHash: 'b'.repeat(64), commandType: 'care.submitEvidence', payload: { occurrenceId: 'o', horseId: 'h', mediaPath: 'p', observedAt: 'x', location: null } });
    expect(argsOf(calls, 'field.submit_care_evidence')).toMatchObject({ p_latitude: null, p_longitude: null, p_accuracy_m: null });
  });

  test('X06 field_punch_in: exact parameters; reply keys from the merged delta; a duplicate is a replay', async () => {
    const { t, calls } = tx({ field_punch_in: () => ok({ attendance_id: 'a1', verification_state: 'low_accuracy', distance_m: 120, duplicate: true }) });
    const r = await t.submit({ operationId: OP, actorId: 'u', payloadHash: 'c'.repeat(64), commandType: 'shift.punchIn', payload: { observedAt: '2026-11-05T00:30:00Z', location: { latitude: 17.4, longitude: 78.5, accuracyM: 85 }, mediaPath: null } });
    expect(Object.keys(argsOf(calls, 'field_punch_in')!).sort()).toEqual(fn(MIG, 'public', 'field_punch_in').params);
    for (const k of ['attendance_id', 'verification_state', 'distance_m', 'duplicate']) expect(fn(MIG, 'public', 'field_punch_in').body).toContain(`'${k}'`);
    expect(r).toMatchObject({ receiptId: OP, replayed: true, attendanceId: 'a1', verificationState: 'low_accuracy' });
  });

  test('X07 upload intent targets <hub>/<actor>/<op>.jpg in the private proof-photos bucket (G5 policy)', async () => {
    const { t, storageCalls } = tx({});
    const target = await t.createUploadIntent({ operationId: OP, actorId: 'u-groom', purpose: 'care_proof', mimeType: 'image/jpeg', sizeBytes: 1, sha256: 'x' });
    expect(target.mediaPath).toBe(`hub-1/u-groom/${OP}.jpg`);
    expect(storageCalls[0]).toEqual(['uploadUrl', 'proof-photos', `hub-1/u-groom/${OP}.jpg`]);
    expect(G5).toMatch(/\(storage\.foldername\(name\)\)\[1\] = public\.current_hub_id\(\)::text/);
  });

  test('X08 server errors become the outbox outcome: 409 parked, 42501 blocked, 422 edit, network transient', async () => {
    expect(classifyError(toTransportError({ code: 'PT409', message: 'idempotency_key_reused' }, 409))).toMatchObject({ kind: 'final', state: 'needs_review' });
    expect(classifyError(toTransportError({ code: 'PT409', message: 'already punched in; punch out first' }, 409))).toMatchObject({ kind: 'final', state: 'needs_review', code: 'already punched in; punch out first' });
    expect(classifyError(toTransportError({ code: '42501', message: 'not_assigned' }, 403))).toMatchObject({ kind: 'final', state: 'blocked' });
    expect(classifyError(toTransportError({ code: 'PT422', message: 'location_invalid' }, 422))).toMatchObject({ kind: 'final', state: 'needs_edit' });
    expect(classifyError(toTransportError({ code: 'PT404', message: 'media_not_found' }, 404)).kind).toBe('reupload');
    expect(classifyError(toTransportError({ code: 'PT401', message: 'no_session' }, 401)).kind).toBe('auth');
    expect(classifyError(toTransportError(networkFailure().error, 0)).kind).toBe('transient');
    const { t } = tx({ field_punch_in: () => networkFailure() });
    await expect(t.submit({ operationId: OP, actorId: 'u', payloadHash: 'd'.repeat(64), commandType: 'shift.punchIn', payload: { observedAt: 'x', location: null } })).rejects.toMatchObject({ kind: 'network' });
  });

  test('X09 field_punch_out (online only): exact parameters', async () => {
    const { c, calls } = client({ field_punch_out: () => ok({ attendance_id: 'a1', punch_out_time: '2026-11-05T12:00:00Z', duplicate: false }) });
    expect(await createFieldOpsServer(c)!.shift.punchOut(scope, 'a1')).toEqual({ attendanceId: 'a1', punchOutAt: '2026-11-05T12:00:00Z', duplicate: false });
    expect(Object.keys(argsOf(calls, 'field_punch_out')!).sort()).toEqual(fn(MIG, 'public', 'field_punch_out').params);
  });
});

describe('G9 review, rank, capability', () => {
  const qrow = { item_kind: 'care_evidence', item_id: 's1', hub_id: 'hub-1', version: 1, state: 'open', reasons: ['weak_location_accuracy'], subject_user_id: 'u-groom', subject_name: 'Suresh', observed_at: 'x', received_at: 'y', accuracy_m: 85, distance_m: null, horse_id: 'h1', horse_name: 'Badal', task_type: 'water', due_at: 'z', late: false, media_bucket: 'proof-photos', media_path: 'hub-1/u/x.jpg', cadet_id: null, cadet_name: null, from_rank: null, to_rank: null, evidence_session_ids: null, decided_by: null, decided_at: null, decision_reason: null, can_decide: true };

  test('X10 field_review_queue: hub argument; every column read exists; 42501 → denied (hidden), not an error', async () => {
    const { c, calls } = client({ field_review_queue: () => ok([qrow]) });
    const admin = { ...scope, subjectId: 'u-admin', role: 'SCHOOL_ADMIN' };
    const q = await createFieldOpsServer(c)!.review.queue(admin);
    expect(argsOf(calls, 'field_review_queue')).toEqual({ p_hub_id: 'hub-1' });
    expect(fn(G9, 'public', 'field_review_queue').params).toEqual(['p_hub_id']);
    const cols = /function public\.field_review_queue[\s\S]*?returns table \(([\s\S]*?)\)\s*language/i.exec(G9)![1]!;
    for (const k of Object.keys(qrow)) expect(cols).toContain(k);
    expect(q).toMatchObject({ kind: 'ok', items: [{ kind: 'care_evidence', canDecide: true, media: { bucket: 'proof-photos' } }] });
    const denied = client({ field_review_queue: () => pgError('42501', 'not allowed to review at this hub', 403) });
    expect(await createFieldOpsServer(denied.c)!.review.queue(scope)).toEqual({ kind: 'denied' });
  });

  test('X11 field_review_decide: exact parameters, reason sent trimmed, version carried; PT409 → conflict', async () => {
    const { c, calls } = client({ field_review_decide: () => ok({ item_kind: 'care_evidence', item_id: 's1', decision: 'accepted', version: 2, decided_at: '2026-11-05T07:00:00Z', decision_id: 'd1', duplicate: false }) });
    const r = await createFieldOpsServer(c)!.review.decide(scope, { kind: 'care_evidence', itemId: 's1', expectedVersion: 1, decision: 'accept', reason: '  Seen at feed  ', operationId: OP });
    const a = argsOf(calls, 'field_review_decide')!;
    expect(Object.keys(a).sort()).toEqual(fn(G9, 'public', 'field_review_decide').params);
    expect(a).toEqual({ p_item_kind: 'care_evidence', p_item_id: 's1', p_expected_version: 1, p_decision: 'accepted', p_reason: 'Seen at feed', p_operation_id: OP });
    expect(r).toEqual({ kind: 'care_evidence', itemId: 's1', decision: 'accepted', decidedAt: '2026-11-05T07:00:00Z', duplicate: false });
    const race = client({ field_review_decide: () => pgError('PT409', 'the item changed since it was loaded (version 2)', 409) });
    await expect(createFieldOpsServer(race.c)!.review.decide(scope, { kind: 'shift_attendance', itemId: 'a1', expectedVersion: 1, decision: 'reject', reason: 'not seen', operationId: OP })).rejects.toMatchObject({ kind: 'conflict' });
    const self = client({ field_review_decide: () => pgError('42501', 'you cannot review your own record', 403) });
    await expect(createFieldOpsServer(self.c)!.review.decide(scope, { kind: 'care_evidence', itemId: 's1', expectedVersion: 1, decision: 'accept', reason: 'ok!', operationId: OP })).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('X12 field_review_item and rank decisions use their own functions and parameter sets', async () => {
    const { c, calls } = client({
      field_review_item: () => ok({ ...qrow, item_kind: 'rank_proposal', can_decide: false }),
      field_decide_rank_proposal: () => ok({ proposal_id: 'p1', status: 'rejected', version: 2, decided_at: 't', current_rank: 'CADET_RIDER', rank_history_id: null, duplicate: false }),
    });
    const repos = createFieldOpsServer(c)!;
    const it = await repos.review.item(scope, 'rank_proposal', 'p1');
    expect(argsOf(calls, 'field_review_item')).toEqual({ p_item_kind: 'rank_proposal', p_item_id: 'p1' });
    expect(it.canDecide).toBe(false);
    await repos.review.decide(scope, { kind: 'rank_proposal', itemId: 'p1', expectedVersion: 1, decision: 'reject', reason: 'needs more sessions', operationId: OP });
    const a = argsOf(calls, 'field_decide_rank_proposal')!;
    expect(Object.keys(a).sort()).toEqual(fn(G9, 'public', 'field_decide_rank_proposal').params);
    expect(a.p_decision).toBe('rejected');
    expect(argsOf(calls, 'field_review_decide')).toBeNull();
  });

  test('X13 field_propose_rank: exact parameters; blank note is null', async () => {
    const { c, calls } = client({ field_propose_rank: () => ok({ proposal_id: 'p1', cadet_id: 'c1', from_rank: 'CADET_RIDER', to_rank: 'CADET_KNIGHT', status: 'proposed', version: 1, proposed_at: 't', duplicate: false }) });
    await createFieldOpsServer(c)!.rank.propose(scope, { cadetId: 'c1', toRank: 'CADET_KNIGHT', evidenceSessionIds: ['s1'], note: '   ', operationId: OP });
    const a = argsOf(calls, 'field_propose_rank')!;
    expect(Object.keys(a).sort()).toEqual(fn(G9, 'public', 'field_propose_rank').params);
    expect(a.p_note).toBeNull();
  });

  test('X14 posture capability is always shown unavailable; flags map with safe defaults', async () => {
    const { c, calls } = client({
      field_posture_capability: () => ok({ capability: 'posture_analysis', status: 'available', reason: 'provider_not_integrated' }),
      app_policy_flags: () => ok({ rank_proposals: { enabled: true, value: { proposer_roles: ['INSTRUCTOR'], approver_role: 'SCHOOL_ADMIN' } }, attendance_accuracy_threshold_m: { enabled: true, value: 30 } }),
    });
    const repos = createFieldOpsServer(c)!;
    expect(await repos.posture.capability(scope)).toEqual({ status: 'unavailable', reason: 'provider_not_integrated' });
    expect(argsOf(calls, 'field_posture_capability')).toEqual({});
    expect(fn(G9, 'public', 'field_posture_capability').params).toEqual([]);
    expect(await repos.policy.flags(scope)).toMatchObject({ rankProposals: { enabled: true, approverRole: 'SCHOOL_ADMIN' }, attendanceAccuracyThresholdM: 30 });
    expect(G9).toMatch(/'rank_proposals'/);
    expect(G9).toMatch(/'attendance_accuracy_threshold_m'/);
  });

  test('X15 evidence photos come from a short-lived signed URL of the private bucket', async () => {
    const { c, storageCalls } = client({});
    expect(await createFieldOpsServer(c)!.review.evidenceUrl(scope, { bucket: 'proof-photos', path: 'hub-1/u/x.jpg' })).toBe('https://signed/hub-1/u/x.jpg');
    expect(storageCalls[0]).toEqual(['signedUrl', 'proof-photos', 'hub-1/u/x.jpg', 120]);
  });

  test('X16 the experience scope is enforced client-side too (field only)', async () => {
    const { c } = client({ hub_horses: () => ok([]) });
    await expect(createFieldOpsServer(c)!.horses.listHorses({ ...scope, experience: 'family' as never })).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
