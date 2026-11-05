// FO-15 conflict review. A queued item the server refused with a conflict (409) or not-found (404) is parked in
// `needs_review`; it is never resent or overwritten by itself. This model explains both sides and lists the only
// allowed paths. None of them changes or replaces the academy's record:
//  * send_as_new  a NEW operation id with the same local evidence; the server keeps both and routes the new one to a
//                 supervisor (G5: evidence for an already submitted/completed task → review_required)
//  * keep_server  discard the local copy (FO-14 confirmation)
//  * open_shift   go to FO-11 (e.g. punch out the open shift first)
//  * later        leave it parked
import type { QueueItem } from '../../sync/domain/types';
import type { ServerCareOccurrence, ShiftStatus } from './types';

export type ConflictKind =
  | 'care_already_has_proof'
  | 'care_operation_reused'
  | 'care_task_gone'
  | 'punch_already_open'
  | 'punch_operation_reused'
  | 'blocked'
  | 'not_a_conflict'
  | 'unknown';

export type ConflictPath = 'send_as_new' | 'keep_server' | 'open_shift' | 'later';

export interface ConflictView {
  kind: ConflictKind;
  /** i18n key explaining what happened */
  explanationKey: string;
  paths: ConflictPath[];
}

const has = (code: string | null, needle: string) => (code ?? '').toLowerCase().includes(needle);

export function conflictView(
  item: QueueItem,
  server: { occurrence?: ServerCareOccurrence | null; shift?: ShiftStatus | null },
): ConflictView {
  if (item.state === 'blocked') {
    // the server refused the person's grant (revoked, not assigned, other hub): kept for review, never resent from here
    return { kind: 'blocked', explanationKey: 'fo.conflict.blocked', paths: ['later', 'keep_server'] };
  }
  if (item.state !== 'needs_review' && item.state !== 'needs_edit') {
    return { kind: 'not_a_conflict', explanationKey: 'fo.conflict.notConflict', paths: ['later'] };
  }
  const code = item.lastErrorCode;
  if (item.commandType === 'care.submitEvidence') {
    if (has(code, 'task_not_found') || (server.occurrence === null && !has(code, 'idempotency'))) {
      return { kind: 'care_task_gone', explanationKey: 'fo.conflict.careGone', paths: ['keep_server', 'later'] };
    }
    if (has(code, 'idempotency') || has(code, 'operation id already used')) {
      return { kind: 'care_operation_reused', explanationKey: 'fo.conflict.careReused', paths: ['send_as_new', 'keep_server', 'later'] };
    }
    const st = server.occurrence?.status;
    if (st === 'completed' || st === 'submitted') {
      return { kind: 'care_already_has_proof', explanationKey: 'fo.conflict.careHasProof', paths: ['send_as_new', 'keep_server', 'later'] };
    }
    return { kind: 'unknown', explanationKey: 'fo.conflict.unknown', paths: ['keep_server', 'later'] };
  }
  if (has(code, 'already punched in')) {
    return { kind: 'punch_already_open', explanationKey: 'fo.conflict.punchOpen', paths: ['open_shift', 'keep_server', 'later'] };
  }
  if (has(code, 'operation id already used') || has(code, 'idempotency')) {
    return { kind: 'punch_operation_reused', explanationKey: 'fo.conflict.punchReused', paths: ['send_as_new', 'keep_server', 'later'] };
  }
  return { kind: 'unknown', explanationKey: 'fo.conflict.unknown', paths: ['keep_server', 'later'] };
}

/** These states open FO-15 (conflict, refused input, refused grant). */
export const isConflictState = (s: QueueItem['state']) => s === 'needs_review' || s === 'needs_edit' || s === 'blocked';
