// The outbox surface the worker, capture, maintenance and screens depend on. Two implementations:
//  * QueueStore (SQLite via SqlDriver): the durable store. Needs expo-sqlite on device (not installed yet).
//  * MemoryQueueStore: same rules in plain JS. Used by development previews and as the explicit, labelled
//    "kept until the app closes" fallback while no durable driver exists. Never presented as durable.
// Both are exercised by the same contract suite (__tests__/outboxStore.contract.test.ts).
import type { QueueItem, QueueState, ServerReceipt, Tombstone } from './types';

export interface NewQueueItem {
  operationId: string;
  actorId: string;
  hubId: string;
  aggregateId: string;
  commandType: QueueItem['commandType'];
  payloadVersion: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  dependencyIds?: string[];
  localFileRefs: string[];
  observedAt: number;
}

/** Fields the worker may change while it holds the lease. */
export interface LeasedPatch {
  state?: QueueState;
  attemptCount?: number;
  nextAttemptAt?: number | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
  uploadMediaPath?: string | null;
  uploadDone?: boolean;
  payload?: Record<string, unknown>;
  payloadHash?: string;
  localFileRefs?: string[];
}

export type OutboxDurability = 'durable' | 'memory';

export interface OutboxStore {
  /** 'memory' = lost when the app process ends. Screens must say so instead of "saved on this phone". */
  readonly durability: OutboxDurability;
  migrate(): void;
  insertCapturing(n: NewQueueItem, now: number): QueueItem;
  get(operationId: string): QueueItem | null;
  mustGet(operationId: string): QueueItem;
  /** Only the owner's items. Another account's work is never listed, only counted. */
  listForOwner(actorId: string): QueueItem[];
  countPendingForOtherOwners(actorId: string): number;
  countPendingForOwner(actorId: string): number;
  markReady(operationId: string, patch: { payload: Record<string, unknown>; payloadHash: string }, now: number): void;
  setState(operationId: string, state: QueueState, now: number, error?: { code: string; detail?: string }): void;
  deleteUncapturedRow(operationId: string): void;
  leaseNext(actorId: string, workerId: string, now: number, leaseMs: number): QueueItem | null;
  updateLeased(operationId: string, workerId: string, patch: LeasedPatch, now: number, extendLeaseMs?: number): boolean;
  acknowledge(operationId: string, workerId: string, receipt: ServerReceipt, now: number): boolean;
  recoverExpiredLeases(now: number): number;
  retryNow(operationId: string, actorId: string, now: number): boolean;
  discard(operationId: string, actorId: string, reason: string, now: number): Tombstone;
  tombstones(actorId: string): Tombstone[];
  acknowledgedBefore(before: number): QueueItem[];
  clearFileRefs(operationId: string, now: number): void;
  pruneMetadata(before: number): number;
  allFileRefs(): Set<string>;
  capturingItems(): QueueItem[];
}
