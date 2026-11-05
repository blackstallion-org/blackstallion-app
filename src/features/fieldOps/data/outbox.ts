// Field outbox runtime: the G5 queue (store + worker + capture + maintenance) behind the FieldOutbox interface.
// Durability is whatever the injected store declares; today that is MemoryQueueStore because expo-sqlite and
// expo-file-system are not installed (owner decision). Screens read `durability` and never claim more.
import { captureCareEvidence } from '@/features/sync/domain/capture';
import { discardItem } from '@/features/sync/domain/maintenance';
import type { OutboxStore } from '@/features/sync/domain/outboxStore';
import type { Clock, FileVault, SessionPort, StoredFile, Transport, UploadTarget } from '@/features/sync/domain/ports';
import { TransportError } from '@/features/sync/domain/ports';
import { payloadHash, sha256BytesHex } from '@/features/sync/domain/sha256';
import { SyncWorker, type DrainResult } from '@/features/sync/domain/worker';

import type { FieldOutbox, OutboxOwner } from './repositories';

export interface FieldOutboxDeps {
  store: OutboxStore;
  files: FileVault;
  transport: Transport;
  offlineEvidenceAllowed: boolean;
  clock?: Clock;
  newId: () => string;
  random?: () => number;
  /** schedule the next drain for retry_wait items (tests pass a fake) */
  schedule?: (fn: () => void, ms: number) => { cancel(): void };
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const h = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(h) };
};

/** Tracks whether the last request reached the server, so screens can say "waiting for connection". */
function observedTransport(inner: Transport, onReach: (reached: boolean) => void): Transport {
  const watch = async <T>(p: Promise<T>): Promise<T> => {
    try {
      const v = await p;
      onReach(true);
      return v;
    } catch (e) {
      onReach(!(e instanceof TransportError && (e.kind === 'network' || e.kind === 'timeout')));
      throw e;
    }
  };
  return {
    createUploadIntent: (req) => watch(inner.createUploadIntent(req)),
    submit: (req) => watch(inner.submit(req)),
  };
}

export function createFieldOutbox(d: FieldOutboxDeps): FieldOutbox {
  const clock = d.clock ?? { now: () => Date.now() };
  const schedule = d.schedule ?? defaultSchedule;
  const listeners = new Set<() => void>();
  let who: OutboxOwner | null = null;
  let reachable = true;
  let running: Promise<DrainResult> | null = null;
  let again = false;
  let timer: { cancel(): void } | null = null;
  const notify = () => listeners.forEach((l) => l());
  const transport = observedTransport(d.transport, (r) => {
    if (r !== reachable) {
      reachable = r;
      notify();
    }
  });
  d.store.migrate();

  const session: SessionPort = {
    current: () => who,
    // supabase-js refreshes tokens itself; a 401 that reaches the worker means the person must sign in again
    refresh: async () => false,
  };
  const owns = (o: OutboxOwner) => who !== null && who.subjectId === o.subjectId;

  const scheduleNext = () => {
    timer?.cancel();
    timer = null;
    if (!who) return;
    const due = d.store
      .listForOwner(who.subjectId)
      .filter((i) => i.state === 'retry_wait' && i.nextAttemptAt !== null && i.lastErrorCode !== 'auth_required')
      .map((i) => i.nextAttemptAt as number);
    if (due.length === 0) return;
    const wait = Math.min(15 * 60_000, Math.max(1_000, Math.min(...due) - clock.now()));
    timer = schedule(() => void api.drain(), wait);
  };

  const runOnce = async (): Promise<DrainResult> => {
    const worker = new SyncWorker({
      store: d.store,
      transport,
      files: d.files,
      session,
      clock,
      random: d.random ?? Math.random,
      workerId: `w-${d.newId()}`,
      checkpoint: () => notify(),
    });
    try {
      return await worker.drain();
    } finally {
      notify();
    }
  };

  const api: FieldOutbox = {
    durability: d.store.durability,
    offlineEvidenceAllowed: d.offlineEvidenceAllowed,

    setSession(next) {
      const changed = who?.subjectId !== next?.subjectId || who?.hubId !== next?.hubId;
      who = next ? { ...next } : null;
      if (changed) {
        timer?.cancel();
        timer = null;
        notify();
        if (who) void api.drain();
      }
    },

    // Reads are filtered by the owner the caller passes (the signed-in person from the access snapshot); another
    // account's items are never returned, only counted.
    list: (o) => d.store.listForOwner(o.subjectId),
    otherAccountPending: (o) => d.store.countPendingForOtherOwners(o.subjectId),
    get(o, operationId) {
      const it = d.store.get(operationId);
      return it && it.actorId === o.subjectId && it.state !== 'discarded' ? it : null;
    },

    async captureCare(o, input) {
      if (!owns(o) || !o.hubId) return { ok: false, error: 'no_session' };
      const res = await captureCareEvidence(
        { store: d.store, files: d.files, session, clock, newId: d.newId, minFreeBytes: 0 },
        {
          occurrenceId: input.occurrenceId,
          horseId: input.horseId,
          hubId: o.hubId,
          tempPhotoRef: input.photo.uri,
          mimeType: 'image/jpeg',
          observedAt: input.observedAt,
          location: input.location ? { latitude: input.location.latitude, longitude: input.location.longitude, accuracyM: input.location.accuracyM } : null,
        },
        true,
      );
      notify();
      if (res.ok) void api.drain();
      return res;
    },

    async queuePunchIn(o, input) {
      if (!owns(o) || !o.hubId) throw new Error('no_session');
      const operationId = d.newId();
      const payload = {
        observedAt: new Date(input.observedAt).toISOString(),
        location: input.location ? { latitude: input.location.latitude, longitude: input.location.longitude, accuracyM: input.location.accuracyM } : null,
      };
      const now = clock.now();
      d.store.insertCapturing(
        { operationId, actorId: o.subjectId, hubId: o.hubId, aggregateId: 'shift', commandType: 'shift.punchIn', payloadVersion: 1, payload, payloadHash: 'pending', localFileRefs: [], observedAt: input.observedAt },
        now,
      );
      d.store.markReady(operationId, { payload, payloadHash: payloadHash(payload) }, now);
      notify();
      void api.drain();
      return d.store.mustGet(operationId);
    },

    drain() {
      if (!who) return Promise.resolve({ processed: 0, acknowledged: 0, paused: 'no_session' });
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        let last: DrainResult;
        do {
          again = false;
          last = await runOnce();
        } while (again && !last.paused);
        return last;
      })().finally(() => {
        running = null;
        scheduleNext();
      });
      return running;
    },

    retry(o, operationId) {
      if (!owns(o)) return false;
      const ok = d.store.retryNow(operationId, o.subjectId, clock.now());
      notify();
      if (ok) void api.drain();
      return ok;
    },

    async discard(o, operationId) {
      if (!owns(o)) throw new Error('not_owner');
      await discardItem({ store: d.store, files: d.files, clock }, operationId, o.subjectId, { confirmed: true, reason: 'owner_confirmed' });
      notify();
    },

    pendingCount: (subjectId) => d.store.countPendingForOwner(subjectId),

    async discardAllFor(subjectId) {
      let discarded = 0;
      let skipped = 0;
      for (const it of d.store.listForOwner(subjectId)) {
        if (it.state === 'acknowledged') continue;
        try {
          await discardItem({ store: d.store, files: d.files, clock }, it.operationId, subjectId, { confirmed: true, reason: 'sign_out_discard' });
          discarded++;
        } catch {
          skipped++; // being sent right now: the server's answer decides, nothing is half-deleted
        }
      }
      notify();
      return { discarded, skipped };
    },

    sendAsNew(o, operationId) {
      if (!owns(o)) return null;
      const it = d.store.get(operationId);
      if (!it || it.actorId !== o.subjectId || (it.state !== 'needs_review' && it.state !== 'needs_edit')) return null;
      const now = clock.now();
      const nextId = d.newId();
      // same evidence and payload, new identity: the server records it separately and routes it to review
      const payload = { ...it.payload };
      d.store.insertCapturing(
        {
          operationId: nextId,
          actorId: it.actorId,
          hubId: it.hubId,
          aggregateId: it.aggregateId,
          commandType: it.commandType,
          payloadVersion: it.payloadVersion,
          payload,
          payloadHash: 'pending',
          localFileRefs: it.localFileRefs,
          observedAt: it.observedAt,
        },
        now,
      );
      d.store.markReady(nextId, { payload, payloadHash: payloadHash(payload) }, now);
      // close the parked item without deleting the evidence the new item now references
      d.store.discard(operationId, o.subjectId, `superseded_by:${nextId}`, now);
      notify();
      void api.drain();
      return d.store.mustGet(nextId);
    },

    online: () => reachable,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return api;
}

/**
 * FileVault over URIs from the capture screen (no expo-file-system yet): finalise records the URI and its hash, upload
 * reads the bytes again and hands them to `put`. Files are not moved or encrypted here, which is why device policy keeps
 * real users' offline evidence off until protected storage is verified.
 */
export function createUriFileVault(io: {
  read(uri: string): Promise<Uint8Array>;
  put(target: UploadTarget, bytes: Uint8Array): Promise<void>;
  release?(uri: string): Promise<void>;
}): FileVault {
  const refs = new Map<string, string>();
  const stat = async (ref: string): Promise<StoredFile | null> => {
    const uri = refs.get(ref);
    if (!uri) return null;
    try {
      const bytes = await io.read(uri);
      return { ref, sizeBytes: bytes.length, sha256: sha256BytesHex(bytes) };
    } catch {
      return null;
    }
  };
  return {
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
    async finalize(tempRef, finalRef) {
      refs.set(finalRef, tempRef);
      const s = await stat(finalRef);
      if (!s) {
        refs.delete(finalRef);
        throw new Error('capture_unreadable');
      }
      return s;
    },
    exists: async (ref) => refs.has(ref),
    stat,
    async remove(ref) {
      const uri = refs.get(ref);
      refs.delete(ref);
      if (uri && ![...refs.values()].includes(uri)) await io.release?.(uri);
    },
    async upload(ref, target) {
      const uri = refs.get(ref);
      if (!uri) throw new Error('file vanished during upload');
      await io.put(target, await io.read(uri));
    },
    listFinalRefs: async () => [...refs.keys()],
  };
}
