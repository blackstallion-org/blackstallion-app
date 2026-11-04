/**
 * @jest-environment node
 */
import { buildCareTimeline, locationHint } from '../domain/timeline';
import { planReminders, diffReminders } from '../domain/reminders';
import { evaluateDevicePolicy } from '../domain/devicePolicy';
import type { ServerCareOccurrence } from '../domain/careTypes';
import type { QueueItem } from '../../sync/domain/types';

const T0 = Date.parse('2026-11-04T06:00:00Z'); // 11:30 IST
const occ = (id: string, dueIso: string, extra: Partial<ServerCareOccurrence> = {}): ServerCareOccurrence => ({
  occurrenceId: id, horseId: 'f1', horseName: 'Toofan', taskType: 'feed', slotKey: id, localDate: '2026-11-04',
  dueAt: Date.parse(dueIso), timezone: 'Asia/Kolkata', instructions: 'Morning feed', status: 'pending', scheduleVersion: 1,
  latestSubmissionState: null, overdue: false, ...extra,
});
const item = (aggregateId: string, state: QueueItem['state'], extra: Partial<QueueItem> = {}): QueueItem => ({
  operationId: `op-${aggregateId}-${state}`, actorId: 'a', hubId: 'h', aggregateId, commandType: 'care.submitEvidence', payloadVersion: 1,
  payload: {}, payloadHash: 'x', dependencyIds: [], localFileRefs: [], state, attemptCount: 0, nextAttemptAt: null, leaseOwner: null,
  leaseUntil: null, createdAt: T0, observedAt: T0, updatedAt: T0, acknowledgedAt: null, lastErrorCode: null, lastErrorDetail: null,
  upload: { mediaPath: null, done: false }, serverReceipt: null, ...extra,
});

describe('care timeline', () => {
  test('C01 rows sorted by due time with horse, instructions, status; cancelled hidden; grouped by hub-local day', () => {
    const days = buildCareTimeline([
      occ('b', '2026-11-04T06:45:00Z', { taskType: 'water' }),
      occ('a', '2026-11-04T03:30:00Z', { taskType: 'grooming_hoof' }),
      occ('c', '2026-11-04T12:30:00Z', { status: 'cancelled' }),
      occ('d', '2026-11-04T18:45:00Z', { localDate: '2026-11-05' }),
    ], [], T0);
    expect(days.map((d) => d.localDate)).toEqual(['2026-11-04', '2026-11-05']);
    expect(days[0]!.rows.map((r) => [r.occurrenceId, r.status, r.taskLabelKey])).toEqual([
      ['a', 'past_due', 'care.taskType.grooming_hoof'],
      ['b', 'due', 'care.taskType.water'],
    ]);
    expect(days[1]!.rows[0]!.status).toBe('upcoming');
  });

  test('C02 "Overdue" only when the server says so; locally it is only "Past due time"', () => {
    const [d] = buildCareTimeline([occ('a', '2026-11-04T03:30:00Z'), occ('b', '2026-11-04T03:30:00Z', { overdue: true })], [], T0);
    expect(d!.rows.find((r) => r.occurrenceId === 'a')!.statusLabelKey).toBe('care.status.pastDue');
    expect(d!.rows.find((r) => r.occurrenceId === 'b')!.statusLabelKey).toBe('care.status.overdue');
  });

  test('C03 evidence states distinguish captured, sending, received, review-required, accepted, rejected; never verified', () => {
    const occs = ['cap', 'snd', 'rcv', 'rev', 'acc', 'rej', 'blk'].map((id) => occ(id, '2026-11-04T05:00:00Z'));
    occs[4] = { ...occs[4]!, latestSubmissionState: 'accepted', status: 'completed' };
    occs[5] = { ...occs[5]!, latestSubmissionState: 'rejected' };
    const queue = [
      item('cap', 'retry_wait'), item('snd', 'uploading'),
      item('rcv', 'acknowledged', { serverReceipt: { receiptId: 'r', replayed: false, reviewState: 'received' } }),
      item('rev', 'acknowledged', { serverReceipt: { receiptId: 'r', replayed: false, reviewState: 'review_required' } }),
      item('acc', 'acknowledged', { serverReceipt: { receiptId: 'r', replayed: false, reviewState: 'received' } }),
      item('blk', 'blocked'),
    ];
    const rows = buildCareTimeline(occs, queue, T0)[0]!.rows;
    const ev = Object.fromEntries(rows.map((r) => [r.occurrenceId, r.evidence]));
    expect(ev).toEqual({ cap: 'captured', snd: 'sending', rcv: 'received', rev: 'review_required', acc: 'accepted', rej: 'rejected', blk: 'needs_action' });
    expect(JSON.stringify(rows)).not.toMatch(/verified/i);
    expect(rows.find((r) => r.occurrenceId === 'cap')!.canCapture).toBe(false); // one pending capture at a time
  });

  test('C04 already completed task: capture allowed but must warn (server routes it to review)', () => {
    const r = buildCareTimeline([occ('a', '2026-11-04T05:00:00Z', { status: 'completed', latestSubmissionState: 'accepted' })], [], T0)[0]!.rows[0]!;
    expect(r).toMatchObject({ status: 'completed', canCapture: true, warnAlreadyCompleted: true });
  });

  test('C05 medication rows are flagged so the screen shows the authorised-instructions notice', () => {
    const r = buildCareTimeline([occ('m', '2026-11-04T18:20:00Z', { taskType: 'medication', instructions: '1 sachet' })], [], T0)[0]!.rows[0]!;
    expect(r.isMedication).toBe(true);
  });

  test('C06 location hint: missing / weak (>50 m) / ok — a hint, not verification', () => {
    expect(locationHint(null)).toBe('missing');
    expect(locationHint({ accuracyM: null })).toBe('weak');
    expect(locationHint({ accuracyM: 120 })).toBe('weak');
    expect(locationHint({ accuracyM: 12 })).toBe('ok');
  });
});

describe('reminders (best effort, OS-dependent)', () => {
  test('R01 plan: pending tasks in the next 24 h, 10 min early, none for tasks with evidence, capped, generic content', () => {
    const occs = [
      occ('past', '2026-11-04T05:00:00Z'),
      occ('soon', '2026-11-04T07:00:00Z'),
      occ('done', '2026-11-04T08:00:00Z', { status: 'completed' }),
      occ('captured', '2026-11-04T09:00:00Z'),
      occ('tomorrow-late', '2026-11-05T09:00:00Z'),
    ];
    const plan = planReminders(occs, [item('captured', 'ready')], T0);
    expect(plan.map((p) => p.occurrenceId)).toEqual(['soon']);
    expect(plan[0]!.fireAt).toBe(Date.parse('2026-11-04T06:50:00Z'));
    expect(JSON.stringify(plan[0]!.params)).not.toMatch(/Toofan|feed/);
    const many = Array.from({ length: 40 }, (_, i) => occ(`o${i}`, new Date(T0 + (i + 1) * 30 * 60_000).toISOString()));
    expect(planReminders(many, [], T0)).toHaveLength(20);
  });

  test('R02 diff cancels stale reminders and adds only new ones', () => {
    const plan = planReminders([occ('soon', '2026-11-04T07:00:00Z')], [], T0);
    expect(diffReminders(['care-old', 'care-soon'], plan)).toEqual({ cancel: ['care-old'], add: [] });
  });
});

describe('device policy (restrictive until approved)', () => {
  test('P01 real users cannot store evidence while storage protection is unverified; synthetic dev builds can', () => {
    expect(evaluateDevicePolicy({ buildProfile: 'production', usesSyntheticData: false, storageProtection: 'unverified', ownerAcceptedStorageEvidence: false }))
      .toMatchObject({ offlineEvidenceAllowed: false, offlineEvidenceReason: 'storage_protection_unverified', staffCheckInAvailable: false, biometricUnlockIsIdentityProof: false });
    expect(evaluateDevicePolicy({ buildProfile: 'development', usesSyntheticData: true, storageProtection: 'unverified', ownerAcceptedStorageEvidence: false }).offlineEvidenceAllowed).toBe(true);
    expect(evaluateDevicePolicy({ buildProfile: 'preview', usesSyntheticData: true, storageProtection: 'unverified', ownerAcceptedStorageEvidence: false }).offlineEvidenceAllowed).toBe(false);
    expect(evaluateDevicePolicy({ buildProfile: 'production', usesSyntheticData: false, storageProtection: 'verified_on_device', ownerAcceptedStorageEvidence: true }).offlineEvidenceAllowed).toBe(true);
  });
});
