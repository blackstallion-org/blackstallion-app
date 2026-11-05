/**
 * @jest-environment node
 */
// One behaviour suite, two stores: the durable SQLite QueueStore (node:sqlite here, expo-sqlite on device) and the
// in-memory MemoryQueueStore used by previews. If they ever disagree, the memory store would show staff something the
// real outbox would not do.
import { MemoryQueueStore } from '../domain/memoryQueueStore';
import type { NewQueueItem, OutboxStore } from '../domain/outboxStore';
import { QueueStore } from '../domain/queueStore';
import { openNodeSqlite, tempDir } from '../testing/nodeHarness';

const T0 = Date.parse('2026-11-04T06:00:00Z');
const n = (op: string, actor = 'a', extra: Partial<NewQueueItem> = {}): NewQueueItem => ({
  operationId: op, actorId: actor, hubId: 'h', aggregateId: `agg-${op}`, commandType: 'care.submitEvidence', payloadVersion: 1,
  payload: { x: op }, payloadHash: 'pending', localFileRefs: [`evidence/${actor}/${op}.jpg`], observedAt: T0, ...extra,
});

const stores: [string, () => OutboxStore][] = [
  ['sqlite', () => {
    const s = new QueueStore(openNodeSqlite(`${tempDir('contract')}/o.db`));
    s.migrate();
    return s;
  }],
  ['memory', () => new MemoryQueueStore()],
];

describe.each(stores)('OutboxStore contract (%s)', (kind, make) => {
  test('C01 durability is declared honestly', () => {
    expect(make().durability).toBe(kind === 'sqlite' ? 'durable' : 'memory');
  });

  test('C02 capture → ready → lease → acknowledge; duplicate operation ids are refused', () => {
    const s = make();
    s.insertCapturing(n('op1'), T0);
    expect(() => s.insertCapturing(n('op1'), T0)).toThrow();
    expect(s.leaseNext('a', 'w', T0, 1000)).toBeNull(); // capturing is not eligible
    s.markReady('op1', { payload: { x: 1 }, payloadHash: 'h1' }, T0 + 1);
    expect(() => s.markReady('op1', { payload: {}, payloadHash: 'h2' }, T0 + 2)).toThrow();
    const leased = s.leaseNext('a', 'w', T0 + 2, 1000)!;
    expect(leased).toMatchObject({ state: 'leased', leaseOwner: 'w', payloadHash: 'h1' });
    expect(s.leaseNext('a', 'w2', T0 + 3, 1000)).toBeNull(); // held
    expect(s.acknowledge('op1', 'w2', { receiptId: 'r', replayed: false }, T0 + 4)).toBe(false); // not the lease owner
    expect(s.acknowledge('op1', 'w', { receiptId: 'r', replayed: false }, T0 + 4)).toBe(true);
    expect(s.get('op1')).toMatchObject({ state: 'acknowledged', acknowledgedAt: T0 + 4, serverReceipt: { receiptId: 'r' }, leaseOwner: null });
  });

  test('C03 owners are isolated: list, count, lease and discard never cross accounts', () => {
    const s = make();
    for (const [op, who] of [['a1', 'a'], ['b1', 'b'], ['b2', 'b']] as const) {
      s.insertCapturing(n(op, who), T0);
      s.markReady(op, { payload: {}, payloadHash: op }, T0);
    }
    expect(s.listForOwner('a').map((i) => i.operationId)).toEqual(['a1']);
    expect(s.countPendingForOtherOwners('a')).toBe(2);
    expect(s.countPendingForOwner('b')).toBe(2);
    expect(s.leaseNext('a', 'w', T0, 1000)?.operationId).toBe('a1');
    expect(s.leaseNext('a', 'w', T0, 1000)).toBeNull(); // b's work is never leased for a
    expect(() => s.discard('b1', 'a', 'x', T0)).toThrow('not_owner');
    expect(s.retryNow('b1', 'a', T0)).toBe(false);
  });

  test('C04 dependencies wait for acknowledgement; expired leases are recovered', () => {
    const s = make();
    s.insertCapturing(n('p'), T0);
    s.markReady('p', { payload: {}, payloadHash: 'p' }, T0);
    s.insertCapturing(n('c', 'a', { dependencyIds: ['p'] }), T0 - 1); // older, but blocked by its dependency
    s.markReady('c', { payload: {}, payloadHash: 'c' }, T0);
    expect(s.leaseNext('a', 'w', T0, 100)?.operationId).toBe('p');
    expect(s.leaseNext('a', 'w', T0, 100)).toBeNull();
    expect(s.recoverExpiredLeases(T0 + 50)).toBe(0);
    expect(s.recoverExpiredLeases(T0 + 101)).toBe(1);
    expect(s.get('p')!.state).toBe('ready');
    s.leaseNext('a', 'w', T0 + 102, 100);
    s.acknowledge('p', 'w', { receiptId: 'p', replayed: false }, T0 + 103);
    expect(s.leaseNext('a', 'w', T0 + 104, 100)?.operationId).toBe('c');
  });

  test('C05 updateLeased needs the lease; releasing states drop it; retryNow resets attempts', () => {
    const s = make();
    s.insertCapturing(n('x'), T0);
    s.markReady('x', { payload: {}, payloadHash: 'x' }, T0);
    s.leaseNext('a', 'w', T0, 1000);
    expect(s.updateLeased('x', 'other', { state: 'uploading' }, T0)).toBe(false);
    expect(s.updateLeased('x', 'w', { state: 'uploading', uploadMediaPath: 'h/a/x.jpg', uploadDone: true }, T0, 500)).toBe(true);
    expect(s.get('x')).toMatchObject({ state: 'uploading', leaseOwner: 'w', leaseUntil: T0 + 500, upload: { mediaPath: 'h/a/x.jpg', done: true } });
    expect(s.updateLeased('x', 'w', { state: 'retry_wait', attemptCount: 3, nextAttemptAt: T0 + 9, lastErrorCode: 'network' }, T0)).toBe(true);
    expect(s.get('x')).toMatchObject({ state: 'retry_wait', leaseOwner: null, leaseUntil: null, attemptCount: 3 });
    expect(s.leaseNext('a', 'w', T0 + 8, 1000)).toBeNull(); // not yet due
    expect(s.retryNow('x', 'a', T0 + 1)).toBe(true);
    expect(s.get('x')).toMatchObject({ state: 'ready', attemptCount: 0, nextAttemptAt: null });
    s.setState('x', 'needs_review', T0 + 2, { code: 'idempotency_key_reused' });
    expect(s.retryNow('x', 'a', T0 + 3)).toBe(false); // conflicts are never blindly resent
  });

  test('C06 discard writes a tombstone, refuses acknowledged and in-flight work; cleanup and pruning', () => {
    const s = make();
    s.insertCapturing(n('d'), T0);
    s.markReady('d', { payload: {}, payloadHash: 'd' }, T0);
    s.leaseNext('a', 'w', T0, 1000);
    expect(() => s.discard('d', 'a', 'x', T0 + 1)).toThrow('in_progress');
    s.updateLeased('d', 'w', { state: 'needs_recapture' }, T0 + 2);
    const t = s.discard('d', 'a', 'owner_confirmed', T0 + 3);
    expect(t).toMatchObject({ operationId: 'd', hadEvidence: true, previousState: 'needs_recapture' });
    expect(s.tombstones('a')).toHaveLength(1);
    expect(s.tombstones('b')).toHaveLength(0);
    expect(s.listForOwner('a')).toHaveLength(0);
    s.insertCapturing(n('k'), T0);
    s.markReady('k', { payload: {}, payloadHash: 'k' }, T0);
    s.leaseNext('a', 'w', T0, 1000);
    s.acknowledge('k', 'w', { receiptId: 'k', replayed: false }, T0 + 10);
    expect(() => s.discard('k', 'a', 'x', T0 + 11)).toThrow('cannot_discard_acknowledged');
    expect(s.acknowledgedBefore(T0 + 11).map((i) => i.operationId)).toEqual(['k']);
    expect(s.allFileRefs().has('evidence/a/k.jpg')).toBe(true);
    s.clearFileRefs('k', T0 + 12);
    s.clearFileRefs('d', T0 + 12);
    expect(s.allFileRefs().size).toBe(0);
    expect(s.pruneMetadata(T0 + 13)).toBe(2);
    expect(s.get('k')).toBeNull();
  });

  test('C07 capturing rows: listed for recovery, deletable only while capturing', () => {
    const s = make();
    s.insertCapturing(n('c1'), T0);
    s.insertCapturing(n('c2'), T0 + 1);
    s.markReady('c2', { payload: {}, payloadHash: 'c2' }, T0 + 2);
    expect(s.capturingItems().map((i) => i.operationId)).toEqual(['c1']);
    s.deleteUncapturedRow('c2');
    expect(s.get('c2')).not.toBeNull();
    s.deleteUncapturedRow('c1');
    expect(s.get('c1')).toBeNull();
  });

  test('C08 returned items are copies: mutating them never changes the store', () => {
    const s = make();
    const it = s.insertCapturing(n('m'), T0);
    it.payload.x = 'changed';
    it.localFileRefs.push('evil');
    expect(s.get('m')!.payload.x).toBe('m');
    expect(s.get('m')!.localFileRefs).toEqual(['evidence/a/m.jpg']);
  });
});

test('C09 memory snapshot round-trips through onChange', () => {
  const seen: number[] = [];
  const s = new MemoryQueueStore(undefined, (snap) => seen.push(snap.items.length));
  s.insertCapturing(n('s1'), T0);
  s.markReady('s1', { payload: {}, payloadHash: 's1' }, T0);
  const restored = new MemoryQueueStore(s.snapshot());
  expect(restored.get('s1')).toMatchObject({ state: 'ready', payloadHash: 's1' });
  expect(seen.length).toBeGreaterThanOrEqual(2);
});
