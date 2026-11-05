// Location evidence, care-task submission phases and shift outcomes (FO-10, FO-11).
// Rules: the server decides; the app only hints. Weak or missing location never blocks a submission and never reads as
// "verified": it goes to a supervisor. Nothing is "Done"/"Completed" until the server says so.
import { localEvidenceState } from '../../care/domain/timeline';
import type { QueueItem } from '../../sync/domain/types';
import type { PunchInReceipt, ServerCareOccurrence, ShiftRecord, VerificationState } from './types';

export interface LocationReading {
  latitude: number;
  longitude: number;
  /** metres, 68 % radius as reported by the OS; null when the OS gave none */
  accuracyM: number | null;
  /** device time of the fix (epoch ms) */
  at: number;
}

export type LocationQuality = 'good' | 'weak' | 'missing';

/** PROPOSED defaults (G5 hub_settings.max_accuracy_m = 50; merged delta punch radius 50 m). Hints only. */
export const CARE_ACCURACY_HINT_M = 50;
export const PUNCH_RADIUS_M = 50;

export function locationQuality(reading: LocationReading | null, maxAccuracyM: number): LocationQuality {
  if (!reading) return 'missing';
  if (reading.accuracyM == null || !Number.isFinite(reading.accuracyM) || reading.accuracyM > maxAccuracyM) return 'weak';
  return 'good';
}

/** "±12 m" style; rounds up so the app never overstates precision. */
export function formatAccuracy(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  return `±${Math.ceil(m)} m`;
}

// ------------------------------------------------------------------ FO-10 care task phase
export type CarePhase =
  | 'cancelled'
  /** accepted by a supervisor (server status completed) */
  | 'completed'
  | 'ready'
  /** in the outbox, not yet sent */
  | 'saved'
  | 'sending'
  /** server receipt: received, NOT accepted */
  | 'received'
  | 'review_required'
  | 'rejected'
  /** stuck locally: open Sync */
  | 'needs_action';

export interface CareTaskView {
  phase: CarePhase;
  /** the newest local outbox item for this occurrence, if any */
  item: QueueItem | null;
  reviewReasons: string[];
  receivedAt: string | null;
  /** capture is allowed now; `warnAlreadySent` asks for a confirmation first (the server routes it to review) */
  canCapture: boolean;
  warnAlreadySent: boolean;
}

export function careTaskView(occ: ServerCareOccurrence, queue: readonly QueueItem[]): CareTaskView {
  const mine = queue
    .filter((q) => q.commandType === 'care.submitEvidence' && q.aggregateId === occ.occurrenceId && q.state !== 'discarded')
    .sort((a, b) => b.createdAt - a.createdAt);
  const item = mine[0] ?? null;
  const local = localEvidenceState(item ?? undefined);
  const receipt = item?.serverReceipt ?? null;
  const reasons = Array.isArray(receipt?.reviewReasons) ? (receipt.reviewReasons as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const receivedAt = typeof receipt?.receivedAt === 'string' ? receipt.receivedAt : null;
  let phase: CarePhase;
  if (occ.status === 'cancelled') phase = 'cancelled';
  else if (local === 'captured') phase = 'saved';
  else if (local === 'sending') phase = 'sending';
  else if (local === 'needs_action') phase = 'needs_action';
  else if (occ.status === 'completed' || occ.latestSubmissionState === 'accepted') phase = 'completed';
  // once acknowledged, the server's view is fresher than the local receipt (a supervisor may have decided since)
  else if (occ.latestSubmissionState === 'rejected') phase = 'rejected';
  else if (occ.latestSubmissionState === 'review_required' || local === 'review_required') phase = 'review_required';
  else if (occ.latestSubmissionState === 'received' || local === 'received') phase = 'received';
  else phase = 'ready';
  const pending = phase === 'saved' || phase === 'sending';
  return {
    phase,
    item,
    reviewReasons: reasons,
    receivedAt,
    canCapture: !pending && phase !== 'cancelled' && phase !== 'needs_action',
    warnAlreadySent: phase === 'completed' || phase === 'received' || phase === 'review_required',
  };
}

// ------------------------------------------------------------------ FO-11 shift outcome
export type PunchOutcome =
  /** sent, waiting for the academy */
  | 'pending'
  /** recorded and, under the current policy, not routed to review (still not "verified") */
  | 'recorded'
  | 'needs_review'
  | 'review_accepted'
  | 'review_rejected';

/**
 * G9 rule: an app punch-in skips review only when it is within_radius AND the accuracy threshold flag is on AND the
 * accuracy is within it. Everything else is reviewed. Acceptance never turns into "verified presence".
 */
export function punchOutcome(
  rec: { verificationState: VerificationState | null; accuracyM: number | null; review?: ShiftRecord['review'] },
  thresholdM: number | null,
): Exclude<PunchOutcome, 'pending'> {
  if (rec.review) return rec.review.decision === 'accepted' ? 'review_accepted' : 'review_rejected';
  if (rec.verificationState !== 'within_radius') return 'needs_review';
  if (thresholdM == null) return 'needs_review';
  if (rec.accuracyM == null || rec.accuracyM > thresholdM) return 'needs_review';
  return 'recorded';
}

export function receiptToOutcome(r: PunchInReceipt, accuracyM: number | null, thresholdM: number | null): Exclude<PunchOutcome, 'pending'> {
  return punchOutcome({ verificationState: r.verificationState, accuracyM }, thresholdM);
}

/** Why a punch-in goes to review, as an i18n key. */
export function punchReasonKey(state: VerificationState | null, thresholdM: number | null): string {
  switch (state) {
    case 'low_accuracy':
      return 'fo.shift.reason.lowAccuracy';
    case 'outside_radius':
      return 'fo.shift.reason.outsideRadius';
    case 'no_location':
      return 'fo.shift.reason.noLocation';
    case 'hub_location_unknown':
      return 'fo.shift.reason.hubUnknown';
    default:
      return thresholdM == null ? 'fo.shift.reason.reviewAll' : 'fo.shift.reason.aboveThreshold';
  }
}

/** The pending (not yet acknowledged) punch-in in the outbox, if any. */
export function pendingPunchIn(queue: readonly QueueItem[]): QueueItem | null {
  return (
    queue
      .filter((q) => q.commandType === 'shift.punchIn' && q.state !== 'discarded' && q.state !== 'acknowledged')
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

/** Care review reasons (G5) → i18n keys. Unknown reasons fall back to a generic line. */
export function careReasonKey(reason: string): string {
  const known = ['location_missing', 'weak_location_accuracy', 'outside_geofence', 'observed_in_future', 'task_already_completed', 'task_already_submitted', 'task_cancelled'];
  return known.includes(reason) ? `fo.reason.${reason}` : 'fo.reason.other';
}
