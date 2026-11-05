/**
 * @jest-environment node
 */
// Critical outbox behaviour behind FO-10/11/12/15: retries never duplicate care proof or punch-ins, conflicts are
// parked (never resent or overwritten), and a user switch never lists or sends the previous person's work.
// A small in-memory server mirrors the replay rules of field.submit_care_evidence and field_punch_in.
import { MemoryQueueStore } from '@/features/sync/domain/memoryQueueStore';
import { TransportError, type SubmitRequest, type Transport } from '@/features/sync/domain/ports';

import { createFieldOutbox, createUriFileVault } from '../data/outbox';
import { createOutboxPendingWork } from '../data/pendingWork';
import type { OutboxOwner } from '../data/repositories';

const A: OutboxOwner = { subjectId: 'groom-a', hubId: 'hub-1' };
const B: OutboxOwner = { subjectId: 'groom-b', hubId: 'hub-1' };

function world() {
  const receipts = new Map<string, { actor: string; hash: string; result: Record<string, unknown> }>();
  const careRows: string[] = [];
  const punchRows: string[] = [];
  const objects = new Set<string>();
  const sent: SubmitRequest[] = [];
  const s = { offline: false, dropAfterCommit: 0, conflictNext: false };
  const transport: Transport = {
    async createUploadIntent(req) {
      if (s.offline) throw new TransportError('network', { message: 'offline' });
      return { mediaPath: `hub-1/${req.actorId}/${req.operationId}.jpg`, url: 'test://u', expiresAt: Date.now() + 60_000 };
    },
    async submit(req) {
      if (s.offline) throw new TransportError('network', { message: 'offline' });
      sent.push(req);
      if (s.conflictNext) {
        s.conflictNext = false;
        throw new TransportError('http', { status: 409, code: 'idempotency_key_reused' });
      }
      const prev = receipts.get(req.operationId);
      let result: Record<string, unknown>;
      if (prev) {
        if (prev.actor !== req.actorId || prev.hash !== req.payloadHash) throw new TransportError('http', { status: 409, code: 'idempotency_key_reused' });
        result = { ...prev.result, replayed: true };
      } else {
        if (req.commandType === 'care.submitEvidence') {
          if (!objects.has(String(req.payload.mediaPath))) throw new TransportError('http', { status: 404, code: 'media_not_found' });
          careRows.push(req.operationId);
          result = { receiptId: req.operationId, reviewState: (req.payload.location as { accuracyM?: number } | null)?.accuracyM ?? 999 > 50 ? 'review_required' : 'received', replayed: false };
        } else {
          punchRows.push(req.operationId);
          result = { receiptId: req.operationId, attendanceId: `att-${punchRows.length}`, verificationState: 'low_accuracy', replayed: false };
        }
        receipts.set(req.operationId, { actor: req.actorId, hash: req.payloadHash, result });
      }
      if (s.dropAfterCommit > 0) {
        s.dropAfterCommit--;
        throw new TransportError('network', { message: 'response lost after commit' });
      }
      return result;
    },
  };
  let n = 0;
  const store = new MemoryQueueStore();
  const outbox = createFieldOutbox({
    store,
    files: createUriFileVault({ read: async (uri) => new TextEncoder().encode(uri), put: async (t) => void objects.add(t.mediaPath) }),
    transport,
    offlineEvidenceAllowed: true,
    newId: () => `op-${++n}`,
    random: () => 0.5,
    schedule: () => ({ cancel() {} }),
  });
  return { outbox, store, s, sent, careRows, punchRows, receipts };
}

const photo = { uri: 'file:///cache/cap-1.jpg', mimeType: 'image/jpeg' };
const care = (w: ReturnType<typeof world>, who = A, accuracyM: number | null = 12) =>
  w.outbox.captureCare(who, { occurrenceId: 'occ-1', horseId: 'horse-1', photo, observedAt: Date.now(), location: accuracyM === null ? null : { latitude: 17.38, longitude: 78.48, accuracyM, at: Date.now() } });

describe('replay safety', () => {
  test('O01 a lost reply after the server committed: the retry resends the SAME operation id and creates no second proof', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.dropAfterCommit = 1;
    const r = await care(w);
    expect(r.ok).toBe(true);
    await w.outbox.drain();
    const op = r.ok ? r.item.operationId : '';
    expect(w.store.get(op)!.state).toBe('retry_wait'); // never "acknowledged" without a reply
    expect(w.outbox.retry(A, op)).toBe(true);
    await w.outbox.drain();
    expect(w.store.get(op)!.state).toBe('acknowledged');
    expect(w.careRows).toEqual([op]);
    expect(w.sent.filter((x) => x.operationId === op)).toHaveLength(2);
    expect(w.sent[0]!.payloadHash).toBe(w.sent[1]!.payloadHash);
    expect(w.store.get(op)!.serverReceipt).toMatchObject({ replayed: true });
  });

  test('O02 punch-in retried after a network drop records one attendance row', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.dropAfterCommit = 1;
    const it = await w.outbox.queuePunchIn(A, { observedAt: Date.now(), location: { latitude: 1, longitude: 1, accuracyM: 85, at: Date.now() } });
    await w.outbox.drain();
    w.outbox.retry(A, it.operationId);
    await w.outbox.drain();
    expect(w.punchRows).toEqual([it.operationId]);
    expect(w.store.get(it.operationId)!.serverReceipt).toMatchObject({ attendanceId: 'att-1', verificationState: 'low_accuracy' });
  });

  test('O03 offline work waits with its operation id; nothing is reported as sent', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.offline = true;
    const r = await care(w);
    await w.outbox.drain();
    const op = r.ok ? r.item.operationId : '';
    expect(w.store.get(op)!.state).toBe('retry_wait');
    expect(w.outbox.online()).toBe(false);
    w.s.offline = false;
    w.outbox.retry(A, op);
    await w.outbox.drain();
    expect(w.outbox.online()).toBe(true);
    expect(w.careRows).toEqual([op]);
  });
});

describe('conflicts', () => {
  test('O04 a 409 parks the item in needs_review; later drains never resend it', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.conflictNext = true;
    const r = await care(w);
    await w.outbox.drain();
    const op = r.ok ? r.item.operationId : '';
    expect(w.store.get(op)!.state).toBe('needs_review');
    const before = w.sent.length;
    await w.outbox.drain();
    await w.outbox.drain();
    expect(w.sent.length).toBe(before);
    expect(w.outbox.retry(A, op)).toBe(false); // conflicts are not blindly retried
  });

  test('O05 "send as new" is a separate record with a new id; the parked one is closed, evidence kept', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.conflictNext = true;
    const r = await care(w);
    await w.outbox.drain();
    const op = r.ok ? r.item.operationId : '';
    const next = w.outbox.sendAsNew(A, op)!;
    expect(next.operationId).not.toBe(op);
    expect(next.localFileRefs).toEqual(w.store.get(op)!.localFileRefs);
    expect(w.store.get(op)!.state).toBe('discarded');
    await w.outbox.drain();
    expect(w.store.get(next.operationId)!.state).toBe('acknowledged');
    expect(w.careRows).toEqual([next.operationId]); // nothing written under the conflicting id
    expect(w.outbox.sendAsNew(B, next.operationId)).toBeNull();
  });
});

describe('account isolation', () => {
  test('O06 after a user switch the previous person’s work is never listed, opened or sent', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.offline = true;
    const r = await care(w);
    await w.outbox.drain();
    const aOp = r.ok ? r.item.operationId : '';
    // A signs out, B signs in on the same phone
    w.outbox.setSession(null);
    expect((await w.outbox.drain()).paused).toBe('no_session');
    w.s.offline = false;
    w.outbox.setSession(B);
    await w.outbox.drain();
    expect(w.outbox.list(B)).toEqual([]);
    expect(w.outbox.get(B, aOp)).toBeNull();
    expect(w.outbox.otherAccountPending(B)).toBe(1);
    expect(w.sent.some((x) => x.actorId === 'groom-a' || x.operationId === aOp)).toBe(false);
    expect(w.outbox.retry(B, aOp)).toBe(false);
    await expect(w.outbox.discard(B, aOp)).rejects.toThrow();
    // A comes back: the work is still there and goes out under A
    w.outbox.setSession(A);
    w.outbox.retry(A, aOp);
    await w.outbox.drain();
    expect(w.store.get(aOp)!.state).toBe('acknowledged');
  });

  test('O07 discard needs the owner and writes a tombstone; acknowledged work cannot be discarded', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.offline = true;
    const r = await care(w);
    await w.outbox.drain();
    const op = r.ok ? r.item.operationId : '';
    await w.outbox.discard(A, op);
    expect(w.outbox.list(A)).toEqual([]);
    expect(w.store.tombstones(A.subjectId)).toHaveLength(1);
    w.s.offline = false;
    const r2 = await care(w);
    await w.outbox.drain();
    await expect(w.outbox.discard(A, r2.ok ? r2.item.operationId : '')).rejects.toThrow('cannot_discard_acknowledged');
  });

  test('O08 the memory store says it is not durable', () => {
    expect(world().outbox.durability).toBe('memory');
  });
});

describe('SH-06 pending-work port', () => {
  test('O09 counts only this person’s unsent work and discards only theirs (tombstones kept)', async () => {
    const w = world();
    w.outbox.setSession(A);
    w.s.offline = true;
    await care(w);
    await w.outbox.drain();
    w.outbox.setSession(B);
    await care(w, B);
    await w.outbox.drain();
    const port = createOutboxPendingWork(w.outbox);
    expect(await port.count(A.subjectId)).toBe(1);
    expect(await port.count(B.subjectId)).toBe(1);
    await port.discard!(A.subjectId);
    expect(await port.count(A.subjectId)).toBe(0);
    expect(await port.count(B.subjectId)).toBe(1);
    expect(w.store.tombstones(A.subjectId)).toHaveLength(1);
    expect(w.sent).toHaveLength(0);
  });
});
