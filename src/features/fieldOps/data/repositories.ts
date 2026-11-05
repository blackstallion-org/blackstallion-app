/**
 * Field horses/attendance/sync/reviews (FO-08..FO-20): repository contract.
 * Implementations: fixtures in `src/dev/fixtures/fieldOps.ts` (development only, synthetic), server in `./server.ts`.
 * Every call carries the scope; implementations refuse other scopes. Failures are thrown as FieldCommandError
 * (forbidden / notFound / conflict / invalid / network / signedOut / unexpected) with user-safe text.
 */
import type { CaptureResult as QueueCaptureResult } from '@/features/sync/domain/capture';
import type { OutboxDurability } from '@/features/sync/domain/outboxStore';
import type { DrainResult } from '@/features/sync/domain/worker';
import type { QueueItem } from '@/features/sync/domain/types';

import type { LocationReading } from '../domain/evidence';
import type {
  CareTimeline,
  FieldOpsScope,
  HubHorse,
  PolicyFlags,
  PostureCapability,
  RankCandidate,
  RankProposalRequest,
  RankProposalResult,
  ReviewDecisionRequest,
  ReviewDecisionResult,
  ReviewItem,
  ReviewKind,
  ReviewQueue,
  ShiftStatus,
} from '../domain/types';

export interface HorsesRepository {
  /** hub_horses(): the caller's hub (SUPER_ADMIN: all). Microchips are dropped on read. */
  listHorses(scope: FieldOpsScope): Promise<HubHorse[]>;
}

export interface CareRepository {
  /** field.my_care_timeline(from, to): hub-local dates, at most 14 days apart; assigned staff only. */
  timeline(scope: FieldOpsScope, from: string, to: string): Promise<CareTimeline>;
}

export interface ShiftRepository {
  status(scope: FieldOpsScope): Promise<ShiftStatus>;
  /** field_punch_out: online only (the server stamps its own receive time). */
  punchOut(scope: FieldOpsScope, attendanceId: string): Promise<{ attendanceId: string; punchOutAt: string; duplicate: boolean }>;
}

export interface PolicyRepository {
  flags(scope: FieldOpsScope): Promise<PolicyFlags>;
}

export interface ReviewRepository {
  /** field_review_queue(hub): `denied` on 42501 (the screen and its entry are hidden). */
  queue(scope: FieldOpsScope): Promise<ReviewQueue>;
  item(scope: FieldOpsScope, kind: ReviewKind, itemId: string): Promise<ReviewItem>;
  /** field_review_decide / field_decide_rank_proposal. PT409 → FieldCommandError('conflict'). */
  decide(scope: FieldOpsScope, req: ReviewDecisionRequest): Promise<ReviewDecisionResult>;
  /** Short-lived signed URL for private evidence; null when the build has no media access (fixtures). */
  evidenceUrl(scope: FieldOpsScope, media: { bucket: string; path: string }): Promise<string | null>;
}

export interface RankRepository {
  candidate(scope: FieldOpsScope, cadetId: string): Promise<RankCandidate>;
  propose(scope: FieldOpsScope, req: RankProposalRequest): Promise<RankProposalResult>;
}

export interface PostureRepository {
  capability(scope: FieldOpsScope): Promise<PostureCapability>;
}

export interface OutboxOwner {
  subjectId: string;
  hubId: string | null;
}

export interface CarePhoto {
  uri: string;
  mimeType: string;
}

/** The G5 outbox for this phone, shared by FO-10 (care proof), FO-11 (punch-in) and FO-12..FO-15. */
export interface FieldOutbox {
  /** 'memory' = lost if the app closes: screens say "kept until the app closes", never "saved on this phone". */
  readonly durability: OutboxDurability;
  /** devicePolicy: real users may keep proof on the phone only once storage protection is verified. */
  readonly offlineEvidenceAllowed: boolean;
  /** The signed-in person whose work may be listed and sent. null on sign-out: nothing is listed or sent. */
  setSession(who: OutboxOwner | null): void;
  /** Owner's items only; another account's work is never listed. */
  list(who: OutboxOwner): QueueItem[];
  otherAccountPending(who: OutboxOwner): number;
  get(who: OutboxOwner, operationId: string): QueueItem | null;
  captureCare(
    who: OutboxOwner,
    input: { occurrenceId: string; horseId: string; photo: CarePhoto; observedAt: number; location: LocationReading | null },
  ): Promise<QueueCaptureResult>;
  queuePunchIn(who: OutboxOwner, input: { observedAt: number; location: LocationReading | null }): Promise<QueueItem>;
  /** Sends what is due for the current session; concurrent calls share one run. */
  drain(): Promise<DrainResult>;
  retry(who: OutboxOwner, operationId: string): boolean;
  /** FO-14: owner-confirmed discard (tombstone first, then local files). */
  discard(who: OutboxOwner, operationId: string): Promise<void>;
  /** SH-06/SH-10: unsent items of this person (acknowledged and discarded work excluded). */
  pendingCount(subjectId: string): number;
  /** SH-06 "Discard" after the person confirmed: tombstones first, then local files; in-flight items are left alone. */
  discardAllFor(subjectId: string): Promise<{ discarded: number; skipped: number }>;
  /** FO-15 "send as new": a new operation id with the same evidence; the parked item is closed, never resent. */
  sendAsNew(who: OutboxOwner, operationId: string): QueueItem | null;
  /** last network outcome seen by the transport (true until a request fails to reach the server) */
  online(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface FieldOpsRepositories {
  /** Provenance: synthetic previews must never look like records. */
  source: 'synthetic-preview' | 'server';
  horses: HorsesRepository;
  care: CareRepository;
  shift: ShiftRepository;
  policy: PolicyRepository;
  review: ReviewRepository;
  rank: RankRepository;
  posture: PostureRepository;
  outbox: FieldOutbox;
}
