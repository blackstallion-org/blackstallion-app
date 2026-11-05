/**
 * SH-10 account-deletion request (BACKEND_CONTRACT_V2 §3.5, MIG9 `app_private.g9_deletion_json`). Pure.
 * A request only: no RPC deletes or anonymises anything; staff complete it under the retention rules (D12, unsigned).
 */
export type DeletionStatus = 'requested' | 'in_review' | 'completed' | 'rejected' | 'cancelled';

export type DeletionRequest = {
  requestId: string;
  status: DeletionStatus;
  reason: string | null;
  requestedAt: string;
  statusChangedAt: string;
  statusNote: string | null;
  version: number;
  canCancel: boolean;
};

export class DeletionShapeError extends Error {
  constructor(readonly field: string) {
    super(`Unexpected deletion request shape (${field})`);
    this.name = 'DeletionShapeError';
  }
}

const STATUSES: readonly DeletionStatus[] = ['requested', 'in_review', 'completed', 'rejected', 'cancelled'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates the server's request object `R`. Throws DeletionShapeError rather than guessing. */
export function parseDeletionRequest(raw: unknown): DeletionRequest {
  if (!isObj(raw)) throw new DeletionShapeError('request');
  const s = (k: string): string => {
    const v = raw[k];
    if (typeof v !== 'string' || !v) throw new DeletionShapeError(k);
    return v;
  };
  const optional = (k: string): string | null => {
    const v = raw[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') throw new DeletionShapeError(k);
    return v;
  };
  const status = s('status') as DeletionStatus;
  if (!STATUSES.includes(status)) throw new DeletionShapeError('status');
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new DeletionShapeError('version');
  if (typeof raw.can_cancel !== 'boolean') throw new DeletionShapeError('can_cancel');
  return {
    requestId: s('request_id'),
    status,
    reason: optional('reason'),
    requestedAt: s('requested_at'),
    statusChangedAt: s('status_changed_at'),
    statusNote: optional('status_note'),
    version,
    canCancel: raw.can_cancel,
  };
}

/** Requested or in review: the server allows only one open request per person. */
export const isOpenRequest = (r: DeletionRequest | null | undefined): r is DeletionRequest =>
  !!r && (r.status === 'requested' || r.status === 'in_review');

/** The deliberate typed confirmation (SH-10). Same word in every language; case and spaces are forgiven. */
export const DELETE_CONFIRM_WORD = 'DELETE';
export const confirmationMatches = (typed: string): boolean => typed.trim().toUpperCase() === DELETE_CONFIRM_WORD;

/** Server limit (MIG9: `reason` 1..1000 after trim; empty → null). */
export const MAX_DELETION_REASON = 1000;
export const normaliseReason = (reason: string): string | null => {
  const t = reason.trim();
  return t ? t : null;
};

/** Short, non-secret reference the person can quote to the academy (first 8 hex digits of the request id). */
export const requestReference = (requestId: string): string => requestId.replace(/-/g, '').slice(0, 8).toUpperCase();
