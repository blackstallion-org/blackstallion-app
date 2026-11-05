// Local retention and cleanup. Rule: never delete the only copy of unsynced evidence without an explicit owner action.
import type { Clock, FileVault } from './ports';
import type { OutboxStore } from './outboxStore';
import type { Tombstone } from './types';

export interface RetentionPolicy {
  /** keep the local photo this long after the server receipt, so staff can still see what they sent (PROPOSED 24 h) */
  acknowledgedFileGraceMs: number;
  /** keep acknowledged/discarded metadata this long for the Sync history (PROPOSED 7 days, D12) */
  metadataRetentionMs: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  acknowledgedFileGraceMs: 24 * 3_600_000,
  metadataRetentionMs: 7 * 24 * 3_600_000,
};

export interface CleanupReport {
  filesRemoved: number;
  metadataPruned: number;
  /** finalised files with no queue row: reported for a person to decide, never deleted automatically */
  orphanFiles: string[];
}

export async function runCleanup(
  d: { store: OutboxStore; files: FileVault; clock: Clock },
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<CleanupReport> {
  const now = d.clock.now();
  let filesRemoved = 0;
  for (const it of d.store.acknowledgedBefore(now - policy.acknowledgedFileGraceMs)) {
    if (!it.serverReceipt) continue; // defensive: no receipt, no cleanup
    for (const ref of it.localFileRefs) {
      await d.files.remove(ref);
      filesRemoved++;
    }
    d.store.clearFileRefs(it.operationId, now);
  }
  const metadataPruned = d.store.pruneMetadata(now - policy.metadataRetentionMs);
  const known = d.store.allFileRefs();
  const orphanFiles = (await d.files.listFinalRefs()).filter((r) => !known.has(r));
  return { filesRemoved, metadataPruned, orphanFiles };
}

/**
 * Deliberate discard. The UI must have shown the consequence ("never sent; deleted from this phone") and received an
 * explicit confirmation. Tombstone is committed before the file is removed.
 */
export async function discardItem(
  d: { store: OutboxStore; files: FileVault; clock: Clock },
  operationId: string,
  actorId: string,
  confirmation: { confirmed: true; reason: string },
): Promise<Tombstone> {
  if (confirmation.confirmed !== true) throw new Error('confirmation_required');
  const item = d.store.get(operationId);
  const t = d.store.discard(operationId, actorId, confirmation.reason, d.clock.now());
  for (const ref of item?.localFileRefs ?? []) await d.files.remove(ref);
  d.store.clearFileRefs(operationId, d.clock.now());
  return t;
}

/** Sign-out summary (10 §Experience/account lifecycle): count first, then finish sync, keep locked, or discard. */
export function signOutSummary(store: OutboxStore, actorId: string): { pending: number; options: ('finish_sync' | 'keep_locked' | 'discard')[] } {
  const pending = store.countPendingForOwner(actorId);
  return { pending, options: pending === 0 ? [] : ['finish_sync', 'keep_locked', 'discard'] };
}
