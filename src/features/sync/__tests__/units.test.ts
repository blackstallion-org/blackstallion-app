/**
 * @jest-environment node
 */
import { createHash } from 'node:crypto';
import { backoffDelayMs, DEFAULT_RETRY_POLICY } from '../domain/retry';
import { canonicalJson, payloadHash, sha256Hex } from '../domain/sha256';
import { buildSyncScreenModel, actionsFor } from '../domain/syncViewModel';
import { classifyError } from '../domain/worker';
import { TransportError } from '../domain/ports';
import type { QueueItem } from '../domain/types';

const T0 = Date.parse('2026-11-04T06:00:00Z');
const item = (state: QueueItem['state'], extra: Partial<QueueItem> = {}): QueueItem => ({
  operationId: `op-${state}-${extra.lastErrorCode ?? ''}`, actorId: 'a', hubId: 'h', aggregateId: `occ-${state}`, commandType: 'care.submitEvidence',
  payloadVersion: 1, payload: {}, payloadHash: 'x', dependencyIds: [], localFileRefs: ['f'], state, attemptCount: 0, nextAttemptAt: null,
  leaseOwner: null, leaseUntil: null, createdAt: T0, observedAt: T0, updatedAt: T0, acknowledgedAt: null, lastErrorCode: null,
  lastErrorDetail: null, upload: { mediaPath: null, done: false }, serverReceipt: null, ...extra,
});

describe('hashing', () => {
  test('U01 sha256 matches node crypto, including Devanagari/Telugu/emoji', () => {
    for (const s of ['', 'abc', 'a'.repeat(1000), 'तोफ़ान తుఫాను 🐎', JSON.stringify({ x: 1 })]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
  test('U02 canonical JSON is key-order independent', () => {
    expect(payloadHash({ b: 1, a: { d: [1, 2], c: null } })).toBe(payloadHash({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
  });
});

describe('retry policy', () => {
  test('U03 exponential with jitter, floor, server hint, 15 min cap', () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(4, () => 0.99)).toBeLessThanOrEqual(16_000);
    expect(backoffDelayMs(30, () => 1)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
    expect(backoffDelayMs(1, () => 0, DEFAULT_RETRY_POLICY, 90_000)).toBe(90_000);
    expect(backoffDelayMs(1, () => 0, DEFAULT_RETRY_POLICY, 3_600_000)).toBe(900_000);
  });
  test('U04 error classification', () => {
    expect(classifyError(new TransportError('network')).kind).toBe('transient');
    expect(classifyError(new TransportError('http', { status: 401 })).kind).toBe('auth');
    expect(classifyError(new TransportError('http', { status: 403, code: 'access_revoked' }))).toMatchObject({ kind: 'final', state: 'blocked' });
    expect(classifyError(new TransportError('http', { status: 409, code: 'idempotency_key_reused' }))).toMatchObject({ kind: 'final', state: 'needs_review' });
    expect(classifyError(new TransportError('http', { status: 422, code: 'location_invalid' }))).toMatchObject({ kind: 'final', state: 'needs_edit' });
    expect(classifyError(new TransportError('http', { status: 404, code: 'media_not_found' })).kind).toBe('reupload');
    expect(classifyError(new TransportError('http', { status: 503 })).kind).toBe('transient');
  });
});

describe('Sync screen model', () => {
  const base = { now: T0, formatTime: (t: number) => new Date(t).toISOString().slice(11, 16), label: () => ({ horse: 'Toofan', taskKey: 'care.taskType.feed' }), otherAccountPending: 0, orphanFiles: 0, online: true };

  test('U05 sections, progress, actions and discard consequence', () => {
    const m = buildSyncScreenModel({ ...base, items: [
      item('ready'), item('uploading'), item('retry_wait', { nextAttemptAt: T0 + 120_000 }), item('blocked', { lastErrorCode: 'access_revoked' }),
      item('needs_recapture'), item('acknowledged', { acknowledgedAt: T0 - 1000, serverReceipt: { receiptId: 'r', replayed: false, reviewState: 'received' } }),
      item('acknowledged', { operationId: 'old', acknowledgedAt: T0 - 48 * 3_600_000 }), item('discarded'),
    ] });
    expect(m.sections.map((s) => [s.key, s.rows.length])).toEqual([['needsAction', 2], ['inProgress', 1], ['waiting', 2], ['sent', 1]]);
    expect(m.progress).toEqual({ done: 1, total: 6 });
    expect(m.pendingCount).toBe(5);
    const waiting = m.sections.find((s) => s.key === 'waiting')!.rows;
    expect(waiting.find((r) => r.state === 'retry_wait')).toMatchObject({ messageKey: 'sync.state.retryAt', messageParams: { time: '06:02' }, actions: ['retry', 'discard'] });
    expect(m.sections[1]!.rows[0]!.actions).toEqual([]); // no discard while a worker holds it
    expect(m.sections[0]!.rows.find((r) => r.state === 'blocked')!.discardWarningKey).toBe('field.sync.discardWarning');
  });

  test('U06 sign-in pause, offline message and other accounts shown only as a count', () => {
    const m = buildSyncScreenModel({ ...base, online: false, otherAccountPending: 3, items: [item('retry_wait', { lastErrorCode: 'auth_required' }), item('retry_wait', { lastErrorCode: 'network' })] });
    expect(m.paused).toBe('auth_required');
    expect(m.sections[0]!.rows[0]).toMatchObject({ messageKey: 'sync.state.signIn', actions: ['sign_in', 'discard'] });
    expect(m.sections.find((s) => s.key === 'waiting')!.rows[0]!.messageKey).toBe('sync.state.offline');
    expect(m.otherAccountPending).toBe(3);
    expect(m.canSyncNow).toBe(false);
  });

  test('U07 acknowledged item with review_required offers View details, nothing destructive', () => {
    expect(actionsFor(item('acknowledged', { serverReceipt: { receiptId: 'r', replayed: false, reviewState: 'review_required' } }))).toEqual(['review']);
  });
});
