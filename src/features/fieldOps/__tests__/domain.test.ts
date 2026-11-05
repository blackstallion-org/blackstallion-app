/**
 * @jest-environment node
 */
// FO-08..FO-20 domain rules: what staff are told about care, shifts, conflicts and reviews. Synthetic data only.
import type { ServerCareOccurrence } from '@/features/care/domain/careTypes';
import type { QueueItem } from '@/features/sync/domain/types';

import { conflictView } from '../domain/conflict';
import { careTaskView, formatAccuracy, locationQuality, pendingPunchIn, punchOutcome, punchReasonKey } from '../domain/evidence';
import { addDays, horseCareDays, localDateIn, summarizeHorses } from '../domain/horses';
import { mayDecide, mayPropose, proposalProblem, reasonProblem, reviewSegments, safeId, safeKind } from '../domain/review';
import type { HubHorse, ReviewItem } from '../domain/types';

const NOW = Date.parse('2026-11-05T06:30:00Z'); // 12:00 IST
const TODAY = '2026-11-05';
const occ = (id: string, horseId: string, over: Partial<ServerCareOccurrence> = {}): ServerCareOccurrence => ({
  occurrenceId: id, horseId, horseName: horseId, taskType: 'water', slotKey: 'water', localDate: TODAY, dueAt: NOW + 60 * 60_000,
  timezone: 'Asia/Kolkata', instructions: 'x', status: 'pending', scheduleVersion: 1, latestSubmissionState: null, overdue: false, ...over,
});
const qi = (op: string, state: QueueItem['state'], over: Partial<QueueItem> = {}): QueueItem => ({
  operationId: op, actorId: 'a', hubId: 'h', aggregateId: 'o1', commandType: 'care.submitEvidence', payloadVersion: 1, payload: {}, payloadHash: 'x',
  dependencyIds: [], localFileRefs: ['f'], state, attemptCount: 0, nextAttemptAt: null, leaseOwner: null, leaseUntil: null, createdAt: NOW,
  observedAt: NOW, updatedAt: NOW, acknowledgedAt: null, lastErrorCode: null, lastErrorDetail: null, upload: { mediaPath: null, done: false },
  serverReceipt: null, ...over,
});
const horse = (id: string, active = true): HubHorse => ({ horseId: id, hubId: 'h', name: id, breed: null, heightHands: null, temperament: null, active });

describe('FO-08/09 horses', () => {
  test('H01 attention first; counts never call proof "complete" before a supervisor accepted it', () => {
    const tl = {
      kind: 'ok' as const,
      fetchedAt: NOW,
      occurrences: [
        occ('a1', 'A', { status: 'completed', latestSubmissionState: 'accepted', dueAt: NOW - 5 * 3_600_000 }),
        occ('a2', 'A', { status: 'submitted', latestSubmissionState: 'received', dueAt: NOW - 2 * 3_600_000 }),
        occ('b1', 'B', { overdue: true, dueAt: NOW - 3_600_000 }),
        occ('c1', 'C', { dueAt: NOW + 3 * 3_600_000 }),
        occ('y1', 'A', { localDate: addDays(TODAY, -1), dueAt: NOW - 30 * 3_600_000 }),
      ],
    };
    const ov = summarizeHorses([horse('A'), horse('B'), horse('C'), horse('D'), horse('Z', false)], tl, [], NOW, TODAY);
    expect(ov.horses.map((h) => [h.horse.horseId, h.status])).toEqual([['B', 'overdue'], ['A', 'on_time'], ['C', 'on_time'], ['D', 'no_tasks']]);
    expect(ov.horses.find((h) => h.horse.horseId === 'A')!.counts).toMatchObject({ total: 2, completed: 1, sent: 1 });
    expect(ov.inactive.map((h) => h.status)).toEqual(['inactive']);
    expect(ov.totals).toMatchObject({ overdue: 1, horsesWithTasks: 3 });
  });

  test('H02 a hub admin (not assigned staff) gets horses without invented care status', () => {
    const ov = summarizeHorses([horse('A')], { kind: 'not_assigned_staff' }, [], NOW, TODAY);
    expect(ov.careShown).toBe(false);
    expect(ov.horses[0]).toMatchObject({ status: 'not_assigned', counts: null });
  });

  test('H03 local stuck work is "needs action"; one horse’s days are chronological and keep completed tasks', () => {
    const tl = { kind: 'ok' as const, fetchedAt: NOW, occurrences: [occ('o1', 'A'), occ('o0', 'A', { status: 'completed', latestSubmissionState: 'accepted', dueAt: NOW - 3_600_000 }), occ('x', 'B')] };
    const ov = summarizeHorses([horse('A')], tl, [qi('q', 'needs_review')], NOW, TODAY);
    expect(ov.horses[0]!.status).toBe('needs_action');
    const days = horseCareDays('A', tl, [], NOW);
    expect(days[0]!.rows.map((r) => [r.occurrenceId, r.status])).toEqual([['o0', 'completed'], ['o1', 'due']]);
  });

  test('H04 hub-local dates', () => {
    expect(localDateIn(Date.parse('2026-11-04T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-05');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('FO-10 care task phases (no "Done" before the server)', () => {
  test('E01 queued → sending → received/review; completed only from the server', () => {
    const o = occ('o1', 'A');
    expect(careTaskView(o, []).phase).toBe('ready');
    expect(careTaskView(o, [qi('q', 'ready')]).phase).toBe('saved');
    expect(careTaskView(o, [qi('q', 'uploading')])).toMatchObject({ phase: 'sending', canCapture: false });
    const ack = qi('q', 'acknowledged', { serverReceipt: { receiptId: 'q', replayed: false, reviewState: 'received', receivedAt: '2026-11-05T06:31:00Z' } });
    expect(careTaskView(o, [ack])).toMatchObject({ phase: 'received', receivedAt: '2026-11-05T06:31:00Z', warnAlreadySent: true });
    const rev = qi('q', 'acknowledged', { serverReceipt: { receiptId: 'q', replayed: false, reviewState: 'review_required', reviewReasons: ['weak_location_accuracy'] } });
    expect(careTaskView(o, [rev])).toMatchObject({ phase: 'review_required', reviewReasons: ['weak_location_accuracy'] });
    // an acknowledged receipt is never "completed": only the occurrence status from the server is
    expect(careTaskView(o, [ack]).phase).not.toBe('completed');
    expect(careTaskView({ ...o, status: 'completed', latestSubmissionState: 'accepted' }, [ack]).phase).toBe('completed');
  });

  test('E02 a supervisor’s rejection (server) wins over the old local receipt; stuck work needs action', () => {
    const ack = qi('q', 'acknowledged', { serverReceipt: { receiptId: 'q', replayed: false, reviewState: 'received' } });
    expect(careTaskView(occ('o1', 'A', { latestSubmissionState: 'rejected' }), [ack])).toMatchObject({ phase: 'rejected', canCapture: true });
    expect(careTaskView(occ('o1', 'A'), [qi('q', 'blocked')])).toMatchObject({ phase: 'needs_action', canCapture: false });
  });

  test('E03 location quality and accuracy text never overstate precision', () => {
    expect(locationQuality(null, 50)).toBe('missing');
    expect(locationQuality({ latitude: 1, longitude: 1, accuracyM: null, at: 0 }, 50)).toBe('weak');
    expect(locationQuality({ latitude: 1, longitude: 1, accuracyM: 85, at: 0 }, 50)).toBe('weak');
    expect(locationQuality({ latitude: 1, longitude: 1, accuracyM: 12, at: 0 }, 50)).toBe('good');
    expect(formatAccuracy(11.2)).toBe('±12 m');
    expect(formatAccuracy(null)).toBeNull();
  });
});

describe('FO-11 shift outcome (weak GPS → review, never verified)', () => {
  test('S01 every non-within_radius state, and any punch-in while the threshold flag is off, needs review', () => {
    for (const v of ['low_accuracy', 'outside_radius', 'no_location', 'hub_location_unknown', null] as const) {
      expect(punchOutcome({ verificationState: v, accuracyM: 5 }, 50)).toBe('needs_review');
    }
    expect(punchOutcome({ verificationState: 'within_radius', accuracyM: 5 }, null)).toBe('needs_review');
    expect(punchOutcome({ verificationState: 'within_radius', accuracyM: 80 }, 50)).toBe('needs_review');
    expect(punchOutcome({ verificationState: 'within_radius', accuracyM: null }, 50)).toBe('needs_review');
    expect(punchOutcome({ verificationState: 'within_radius', accuracyM: 12 }, 50)).toBe('recorded');
    expect(punchOutcome({ verificationState: 'low_accuracy', accuracyM: 85, review: { decision: 'accepted', reason: 'ok', decidedAt: '' } }, null)).toBe('review_accepted');
    const outcomes = new Set<string>();
    for (const v of ['within_radius', 'low_accuracy'] as const) for (const thr of [null, 50]) outcomes.add(punchOutcome({ verificationState: v, accuracyM: 10 }, thr));
    expect([...outcomes].some((o) => /verif/i.test(o))).toBe(false);
  });

  test('S02 reasons and the pending punch-in', () => {
    expect(punchReasonKey('low_accuracy', 50)).toBe('fo.shift.reason.lowAccuracy');
    expect(punchReasonKey('within_radius', null)).toBe('fo.shift.reason.reviewAll');
    const p = qi('p', 'retry_wait', { commandType: 'shift.punchIn', aggregateId: 'shift', localFileRefs: [] });
    expect(pendingPunchIn([qi('c', 'ready'), p])?.operationId).toBe('p');
    expect(pendingPunchIn([{ ...p, state: 'acknowledged' }])).toBeNull();
  });
});

describe('FO-15 conflicts never overwrite', () => {
  test('C01 every conflict offers only non-destructive-to-server paths', () => {
    const cases: [QueueItem, Parameters<typeof conflictView>[1], string][] = [
      [qi('a', 'needs_review', { lastErrorCode: 'idempotency_key_reused' }), { occurrence: occ('o1', 'A') }, 'care_operation_reused'],
      [qi('b', 'needs_review', { lastErrorCode: 'task_not_found' }), { occurrence: null }, 'care_task_gone'],
      [qi('c', 'needs_review', { lastErrorCode: 'something' }), { occurrence: occ('o1', 'A', { status: 'completed' }) }, 'care_already_has_proof'],
      [qi('d', 'needs_review', { commandType: 'shift.punchIn', lastErrorCode: 'already punched in; punch out first' }), { shift: null }, 'punch_already_open'],
      [qi('e', 'needs_review', { commandType: 'shift.punchIn', lastErrorCode: 'operation id already used for a different request' }), { shift: null }, 'punch_operation_reused'],
    ];
    for (const [it, srv, kind] of cases) {
      const v = conflictView(it, srv);
      expect(v.kind).toBe(kind);
      expect(v.paths).toContain('later');
      expect(v.paths).toContain('keep_server');
      expect(v.paths.every((p) => ['send_as_new', 'keep_server', 'open_shift', 'later'].includes(p))).toBe(true);
    }
    // a refused grant is kept for review: no resend path at all (FO-13: blocked items offer no Retry)
    expect(conflictView(qi('f', 'blocked'), {})).toMatchObject({ kind: 'blocked', paths: ['later', 'keep_server'] });
    expect(conflictView(qi('h', 'ready'), {}).kind).toBe('not_a_conflict');
    expect(conflictView(qi('g', 'needs_review', { lastErrorCode: 'task_not_found' }), { occurrence: null }).paths).not.toContain('send_as_new');
  });
});

describe('FO-17/18/19 review rules', () => {
  const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
    kind: 'care_evidence', itemId: 'i', hubId: 'h', version: 1, state: 'open', reasons: [], subjectUserId: 'groom', subjectName: null, observedAt: null,
    receivedAt: null, accuracyM: null, distanceM: null, horseName: null, taskType: null, dueAt: null, late: null, media: null, cadetId: null, cadetName: null,
    fromRank: null, toRank: null, evidenceSessionIds: [], decidedBy: null, decidedAt: null, decisionReason: null, canDecide: true, ...over,
  });
  test('R01 reasons are required (3..500); self-review is never offered even if the row says so', () => {
    expect(reasonProblem('  ok ')).toBe('too_short');
    expect(reasonProblem('Seen at feed')).toBeNull();
    expect(reasonProblem('x'.repeat(501))).toBe('too_long');
    expect(mayDecide(item(), 'admin')).toBe(true);
    expect(mayDecide(item({ subjectUserId: 'admin' }), 'admin')).toBe(false);
    expect(mayDecide(item({ canDecide: false }), 'admin')).toBe(false);
    expect(mayDecide(item({ state: 'accepted' }), 'admin')).toBe(false);
  });

  test('R02 segments: rank only with the flag or items; deep-link guards', () => {
    expect(reviewSegments([item()], false).map((s) => s.kind)).toEqual(['care_evidence', 'shift_attendance']);
    expect(reviewSegments([item({ kind: 'rank_proposal' })], false).map((s) => s.kind)).toContain('rank_proposal');
    expect(safeId('11111111-1111-4111-8111-111111111111')).not.toBeNull();
    expect(safeId('syn-occ-a')).toBe('syn-occ-a');
    expect(safeId('../etc')).toBeNull();
    expect(safeId("x' or 1=1")).toBeNull();
    expect(safeKind('care_evidence')).toBe('care_evidence');
    expect(safeKind('verified')).toBeNull();
  });

  test('R03 rank proposal: a different rank, 1..20 published sessions, note ≤ 1000; role gate', () => {
    const base = { currentRank: 'CADET_RIDER' as const, evidence: ['s1'], note: '' };
    expect(proposalProblem({ ...base, toRank: null })).toBe('no_rank');
    expect(proposalProblem({ ...base, toRank: 'CADET_RIDER' })).toBe('same_rank');
    expect(proposalProblem({ ...base, toRank: 'CADET_KNIGHT', evidence: [] })).toBe('evidence_count');
    expect(proposalProblem({ ...base, toRank: 'CADET_KNIGHT', evidence: Array.from({ length: 21 }, (_, i) => `s${i}`) })).toBe('evidence_count');
    expect(proposalProblem({ ...base, toRank: 'CADET_KNIGHT', note: 'x'.repeat(1001) })).toBe('note_too_long');
    expect(proposalProblem({ ...base, toRank: 'CADET_KNIGHT' })).toBeNull();
    expect(mayPropose('INSTRUCTOR', ['INSTRUCTOR'])).toBe(true);
    expect(mayPropose('GROOM', ['INSTRUCTOR'])).toBe(false);
    expect(mayPropose(null, ['INSTRUCTOR'])).toBe(false);
  });
});
