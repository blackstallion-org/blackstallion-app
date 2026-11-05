// In-memory outbox with the same rules as QueueStore (SQLite). It is NOT durable: work is lost when the app process
// ends, so `durability` is 'memory' and the UI must say "kept until the app closes" instead of "saved on this phone".
// Optional `onChange` lets a caller mirror snapshots elsewhere; nothing here claims that mirror is protected storage.
import type { LeasedPatch, NewQueueItem, OutboxStore } from './outboxStore';
import { ACTIVE_STATES, type QueueItem, type QueueState, type ServerReceipt, type Tombstone } from './types';

export interface MemoryOutboxSnapshot {
  items: QueueItem[];
  tombstones: Tombstone[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const byCreated = (a: QueueItem, b: QueueItem) => a.createdAt - b.createdAt || (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
const PENDING_EXCLUDED: readonly QueueState[] = ['acknowledged', 'discarded'];

export class MemoryQueueStore implements OutboxStore {
  readonly durability = 'memory' as const;
  private readonly items = new Map<string, QueueItem>();
  private readonly graves: Tombstone[] = [];

  constructor(
    snapshot?: MemoryOutboxSnapshot,
    private readonly onChange?: (s: MemoryOutboxSnapshot) => void,
  ) {
    for (const it of snapshot?.items ?? []) this.items.set(it.operationId, clone(it));
    for (const t of snapshot?.tombstones ?? []) this.graves.push(clone(t));
  }

  snapshot(): MemoryOutboxSnapshot {
    return { items: [...this.items.values()].map(clone), tombstones: this.graves.map(clone) };
  }

  private changed(): void {
    this.onChange?.(this.snapshot());
  }

  private sorted(pred: (it: QueueItem) => boolean): QueueItem[] {
    return [...this.items.values()].filter(pred).sort(byCreated);
  }

  migrate(): void {
    // nothing to create
  }

  insertCapturing(n: NewQueueItem, now: number): QueueItem {
    if (this.items.has(n.operationId)) throw new Error(`UNIQUE constraint failed: outbox.operation_id (${n.operationId})`);
    const it: QueueItem = {
      operationId: n.operationId,
      actorId: n.actorId,
      hubId: n.hubId,
      aggregateId: n.aggregateId,
      commandType: n.commandType,
      payloadVersion: n.payloadVersion,
      payload: clone(n.payload),
      payloadHash: n.payloadHash,
      dependencyIds: [...(n.dependencyIds ?? [])],
      localFileRefs: [...n.localFileRefs],
      state: 'capturing',
      attemptCount: 0,
      nextAttemptAt: null,
      leaseOwner: null,
      leaseUntil: null,
      createdAt: now,
      observedAt: n.observedAt,
      updatedAt: now,
      acknowledgedAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      upload: { mediaPath: null, done: false },
      serverReceipt: null,
    };
    this.items.set(it.operationId, it);
    this.changed();
    return clone(it);
  }

  get(operationId: string): QueueItem | null {
    const it = this.items.get(operationId);
    return it ? clone(it) : null;
  }

  mustGet(operationId: string): QueueItem {
    const it = this.get(operationId);
    if (!it) throw new Error(`queue item ${operationId} not found`);
    return it;
  }

  listForOwner(actorId: string): QueueItem[] {
    return this.sorted((it) => it.actorId === actorId && it.state !== 'discarded').map(clone);
  }

  countPendingForOtherOwners(actorId: string): number {
    return this.sorted((it) => it.actorId !== actorId && !PENDING_EXCLUDED.includes(it.state)).length;
  }

  countPendingForOwner(actorId: string): number {
    return this.sorted((it) => it.actorId === actorId && !PENDING_EXCLUDED.includes(it.state)).length;
  }

  markReady(operationId: string, patch: { payload: Record<string, unknown>; payloadHash: string }, now: number): void {
    const it = this.items.get(operationId);
    if (!it || it.state !== 'capturing') throw new Error(`markReady: ${operationId} is not capturing`);
    it.state = 'ready';
    it.payload = clone(patch.payload);
    it.payloadHash = patch.payloadHash;
    it.updatedAt = now;
    this.changed();
  }

  setState(operationId: string, state: QueueState, now: number, error?: { code: string; detail?: string }): void {
    const it = this.items.get(operationId);
    if (!it) return;
    it.state = state;
    it.updatedAt = now;
    if (error?.code !== undefined) it.lastErrorCode = error.code;
    if (error?.detail !== undefined) it.lastErrorDetail = error.detail;
    it.leaseOwner = null;
    it.leaseUntil = null;
    this.changed();
  }

  deleteUncapturedRow(operationId: string): void {
    const it = this.items.get(operationId);
    if (it && it.state === 'capturing') {
      this.items.delete(operationId);
      this.changed();
    }
  }

  private eligible(it: QueueItem, now: number): boolean {
    if ((it.state === 'ready' || it.state === 'retry_wait') && (it.nextAttemptAt ?? 0) <= now) return true;
    return ACTIVE_STATES.includes(it.state) && it.leaseUntil !== null && it.leaseUntil < now;
  }

  leaseNext(actorId: string, workerId: string, now: number, leaseMs: number): QueueItem | null {
    for (const it of this.sorted((x) => x.actorId === actorId && this.eligible(x, now))) {
      const depsDone = it.dependencyIds.every((d) => this.items.get(d)?.state === 'acknowledged');
      if (!depsDone) continue;
      it.state = 'leased';
      it.leaseOwner = workerId;
      it.leaseUntil = now + leaseMs;
      it.updatedAt = now;
      this.changed();
      return clone(it);
    }
    return null;
  }

  updateLeased(operationId: string, workerId: string, patch: LeasedPatch, now: number, extendLeaseMs?: number): boolean {
    const it = this.items.get(operationId);
    if (!it || it.leaseOwner !== workerId) return false;
    it.updatedAt = now;
    if (patch.state !== undefined) it.state = patch.state;
    if (patch.attemptCount !== undefined) it.attemptCount = patch.attemptCount;
    if (patch.nextAttemptAt !== undefined) it.nextAttemptAt = patch.nextAttemptAt;
    if (patch.lastErrorCode !== undefined) it.lastErrorCode = patch.lastErrorCode;
    if (patch.lastErrorDetail !== undefined) it.lastErrorDetail = patch.lastErrorDetail;
    if (patch.uploadMediaPath !== undefined) it.upload.mediaPath = patch.uploadMediaPath;
    if (patch.uploadDone !== undefined) it.upload.done = patch.uploadDone;
    if (patch.payload !== undefined) it.payload = clone(patch.payload);
    if (patch.payloadHash !== undefined) it.payloadHash = patch.payloadHash;
    if (patch.localFileRefs !== undefined) it.localFileRefs = [...patch.localFileRefs];
    if (extendLeaseMs !== undefined) it.leaseUntil = now + extendLeaseMs;
    if (patch.state !== undefined && !ACTIVE_STATES.includes(patch.state)) {
      it.leaseOwner = null;
      it.leaseUntil = null;
    }
    this.changed();
    return true;
  }

  acknowledge(operationId: string, workerId: string, receipt: ServerReceipt, now: number): boolean {
    const it = this.items.get(operationId);
    if (!it || it.leaseOwner !== workerId) return false;
    Object.assign(it, {
      state: 'acknowledged' as const,
      serverReceipt: clone(receipt),
      acknowledgedAt: now,
      updatedAt: now,
      leaseOwner: null,
      leaseUntil: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      nextAttemptAt: null,
    });
    this.changed();
    return true;
  }

  recoverExpiredLeases(now: number): number {
    let n = 0;
    for (const it of this.items.values()) {
      if (ACTIVE_STATES.includes(it.state) && it.leaseUntil !== null && it.leaseUntil < now) {
        it.state = 'ready';
        it.leaseOwner = null;
        it.leaseUntil = null;
        it.updatedAt = now;
        n++;
      }
    }
    if (n) this.changed();
    return n;
  }

  retryNow(operationId: string, actorId: string, now: number): boolean {
    const it = this.items.get(operationId);
    if (!it || it.actorId !== actorId || !(['retry_wait', 'needs_attention', 'blocked'] as QueueState[]).includes(it.state)) return false;
    it.state = 'ready';
    it.nextAttemptAt = null;
    it.attemptCount = 0;
    it.updatedAt = now;
    this.changed();
    return true;
  }

  discard(operationId: string, actorId: string, reason: string, now: number): Tombstone {
    const it = this.items.get(operationId);
    if (!it || it.actorId !== actorId) throw new Error('not_owner');
    if (it.state === 'acknowledged' || it.state === 'discarded') throw new Error(`cannot_discard_${it.state}`);
    if (ACTIVE_STATES.includes(it.state) && it.leaseUntil !== null && it.leaseUntil >= now) throw new Error('in_progress');
    const t: Tombstone = { operationId, actorId, discardedAt: now, reason, hadEvidence: it.localFileRefs.length > 0, previousState: it.state };
    this.graves.push(t);
    it.state = 'discarded';
    it.updatedAt = now;
    it.leaseOwner = null;
    it.leaseUntil = null;
    this.changed();
    return clone(t);
  }

  tombstones(actorId: string): Tombstone[] {
    return this.graves.filter((t) => t.actorId === actorId).sort((a, b) => a.discardedAt - b.discardedAt).map(clone);
  }

  acknowledgedBefore(before: number): QueueItem[] {
    return this.sorted((it) => it.state === 'acknowledged' && (it.acknowledgedAt ?? Infinity) < before && it.localFileRefs.length > 0).map(clone);
  }

  clearFileRefs(operationId: string, now: number): void {
    const it = this.items.get(operationId);
    if (it && (it.state === 'acknowledged' || it.state === 'discarded')) {
      it.localFileRefs = [];
      it.updatedAt = now;
      this.changed();
    }
  }

  pruneMetadata(before: number): number {
    let n = 0;
    for (const [id, it] of this.items) {
      if ((it.state === 'acknowledged' || it.state === 'discarded') && it.updatedAt < before && it.localFileRefs.length === 0) {
        this.items.delete(id);
        n++;
      }
    }
    if (n) this.changed();
    return n;
  }

  allFileRefs(): Set<string> {
    const refs = new Set<string>();
    for (const it of this.items.values()) for (const f of it.localFileRefs) refs.add(f);
    return refs;
  }

  capturingItems(): QueueItem[] {
    return this.sorted((it) => it.state === 'capturing').map(clone);
  }
}
