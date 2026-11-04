// Durable evidence capture: persist the queue row, finalise the private file, then mark ready.
// "Saved on this phone" may only be shown after captureCareEvidence returns ok.
import type { Clock, FileVault, SessionPort } from './ports';
import { StorageFullError } from './ports';
import type { QueueStore } from './queueStore';
import { payloadHash } from './sha256';
import type { QueueItem } from './types';

export interface CaptureLocation {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

export interface CaptureInput {
  occurrenceId: string;
  horseId: string;
  hubId: string;
  tempPhotoRef: string;
  mimeType: 'image/jpeg';
  observedAt: number;
  location: CaptureLocation | null;
}

export interface CaptureDeps {
  store: QueueStore;
  files: FileVault;
  session: SessionPort;
  clock: Clock;
  newId: () => string;
  /** refuse to start a capture below this much free space (PROPOSED default 50 MB) */
  minFreeBytes?: number;
}

export type CaptureResult =
  | { ok: true; item: QueueItem }
  | { ok: false; error: 'no_session' | 'storage_full' | 'capture_failed' | 'not_allowed'; detail?: string };

export const DEFAULT_MIN_FREE_BYTES = 50 * 1024 * 1024;

export function evidenceRef(actorId: string, operationId: string): string {
  return `evidence/${actorId}/${operationId}.jpg`;
}

export async function captureCareEvidence(d: CaptureDeps, input: CaptureInput, allowed: boolean): Promise<CaptureResult> {
  if (!allowed) return { ok: false, error: 'not_allowed' };
  const who = d.session.current();
  if (!who) return { ok: false, error: 'no_session' };
  if ((await d.files.freeBytes()) < (d.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES)) {
    return { ok: false, error: 'storage_full' };
  }
  const operationId = d.newId();
  const finalRef = evidenceRef(who.subjectId, operationId);
  const basePayload = {
    occurrenceId: input.occurrenceId,
    horseId: input.horseId,
    observedAt: new Date(input.observedAt).toISOString(),
    location: input.location,
  };
  // 1. row first, in state `capturing`, so a crash during the file move is visible and recoverable at launch
  d.store.insertCapturing(
    {
      operationId,
      actorId: who.subjectId,
      hubId: input.hubId,
      aggregateId: input.occurrenceId,
      commandType: 'care.submitEvidence',
      payloadVersion: 1,
      payload: { ...basePayload, evidence: null },
      payloadHash: 'pending',
      localFileRefs: [finalRef],
      observedAt: input.observedAt,
    },
    d.clock.now(),
  );
  // 2. close + atomic move into private storage
  let stored;
  try {
    stored = await d.files.finalize(input.tempPhotoRef, finalRef);
  } catch (e) {
    d.store.deleteUncapturedRow(operationId); // nothing was saved; the caller tells the user to retake
    if (e instanceof StorageFullError) return { ok: false, error: 'storage_full' };
    return { ok: false, error: 'capture_failed', detail: e instanceof Error ? e.message : String(e) };
  }
  // 3. hash the final content and make it eligible for sync
  const payload = { ...basePayload, evidence: { sha256: stored.sha256, sizeBytes: stored.sizeBytes, mimeType: input.mimeType } };
  d.store.markReady(operationId, { payload, payloadHash: payloadHash(payload) }, d.clock.now());
  return { ok: true, item: d.store.mustGet(operationId) };
}

/** Launch-time recovery of captures interrupted by a crash or kill. Never deletes evidence. */
export async function recoverInterruptedCaptures(d: Pick<CaptureDeps, 'store' | 'files' | 'clock'>): Promise<{
  recovered: number;
  needsRecapture: number;
}> {
  let recovered = 0;
  let needsRecapture = 0;
  for (const it of d.store.capturingItems()) {
    const ref = it.localFileRefs[0];
    const st = ref ? await d.files.stat(ref) : null;
    if (st) {
      const base = it.payload as Record<string, unknown>;
      const payload = { ...base, evidence: { sha256: st.sha256, sizeBytes: st.sizeBytes, mimeType: 'image/jpeg' } };
      d.store.markReady(it.operationId, { payload, payloadHash: payloadHash(payload) }, d.clock.now());
      recovered++;
    } else {
      d.store.setState(it.operationId, 'needs_recapture', d.clock.now(), { code: 'capture_interrupted' });
      needsRecapture++;
    }
  }
  return { recovered, needsRecapture };
}
