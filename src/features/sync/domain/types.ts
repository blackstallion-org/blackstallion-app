// Offline queue model (10_OFFLINE_DEVICE_AND_FAILURE_DESIGN.md §Queue record and worker).

/**
 * capturing      row written, evidence file not yet finalised (crash here is recovered at launch)
 * ready          persisted and waiting for the worker
 * leased         a worker owns it until leaseUntil (expired leases are recovered)
 * uploading      private media upload in progress
 * submitting     record command sent, waiting for the server receipt
 * acknowledged   server receipt persisted (terminal; local file cleaned up later)
 * retry_wait     transient failure; next attempt at nextAttemptAt
 * needs_attention transient failures exceeded the attempt budget; kept, retry is manual
 * needs_edit     server rejected the input (validation)
 * needs_review   conflict that a person must look at (e.g. idempotency key reused with different content)
 * blocked        permission failure (revoked, not assigned, cross-hub); quarantined, never auto-retried
 * needs_recapture the local evidence file is missing or unreadable
 * discarded      deliberately discarded by the owner (tombstone kept)
 */
export type QueueState =
  | 'capturing'
  | 'ready'
  | 'leased'
  | 'uploading'
  | 'submitting'
  | 'acknowledged'
  | 'retry_wait'
  | 'needs_attention'
  | 'needs_edit'
  | 'needs_review'
  | 'blocked'
  | 'needs_recapture'
  | 'discarded';

export const ACTIVE_STATES: readonly QueueState[] = ['leased', 'uploading', 'submitting'];
export const ELIGIBLE_STATES: readonly QueueState[] = ['ready', 'retry_wait'];
export const ATTENTION_STATES: readonly QueueState[] = [
  'needs_attention',
  'needs_edit',
  'needs_review',
  'blocked',
  'needs_recapture',
];
export const TERMINAL_STATES: readonly QueueState[] = ['acknowledged', 'discarded'];

export type CommandType = 'care.submitEvidence';

export interface UploadProgress {
  /** server object path returned by the upload intent */
  mediaPath: string | null;
  done: boolean;
}

export interface ServerReceipt {
  receiptId: string;
  replayed: boolean;
  receivedAt?: string;
  [key: string]: unknown;
}

export interface QueueItem {
  operationId: string;
  /** owner: the authenticated subject that created the work; never reassigned */
  actorId: string;
  hubId: string;
  aggregateId: string;
  commandType: CommandType;
  payloadVersion: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  dependencyIds: string[];
  localFileRefs: string[];
  state: QueueState;
  attemptCount: number;
  nextAttemptAt: number | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  createdAt: number;
  observedAt: number;
  updatedAt: number;
  acknowledgedAt: number | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  upload: UploadProgress;
  serverReceipt: ServerReceipt | null;
}

export interface Tombstone {
  operationId: string;
  actorId: string;
  discardedAt: number;
  reason: string;
  hadEvidence: boolean;
  previousState: QueueState;
}
