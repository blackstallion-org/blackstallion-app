// Field horses / attendance / sync / reviews (FO-08..FO-20): domain types. Pure TypeScript.
// Server sources: merged delta 20261104001700 (hub_horses, field_punch_in/out), G5 field.* (care), G9 (review, rank,
// capability, flags). Nothing here has a "verified" value: evidence is received, needs review, accepted or rejected.
import type { ServerCareOccurrence } from '../../care/domain/careTypes';

export type { ServerCareOccurrence };

/** Who is asking. Every repository call carries it; fixture and server repositories refuse other scopes. */
export interface FieldOpsScope {
  subjectId: string;
  experience: 'field';
  hubId: string | null;
  role: string | null;
}

/** hub_horses() minus microchip_iso_id, which the app never keeps or shows (FO-08 acceptance). */
export interface HubHorse {
  horseId: string;
  hubId: string;
  name: string;
  breed: string | null;
  heightHands: number | null;
  temperament: string | null;
  active: boolean;
}

/** field.my_care_timeline answers only assigned GROOM/INSTRUCTOR staff; a hub admin gets 42501 'not_field_staff'. */
export type CareTimeline =
  | { kind: 'ok'; occurrences: ServerCareOccurrence[]; fetchedAt: number }
  | { kind: 'not_assigned_staff' };

// ------------------------------------------------------------------ flags (G9 app_policy_flags)
export interface PolicyFlags {
  rankProposals: { enabled: boolean; proposerRoles: string[]; approverRole: string | null };
  /** null = every app punch-in goes to review (flag off or no value). */
  attendanceAccuracyThresholdM: number | null;
  postureAnalysis: { enabled: boolean; provider: string | null };
  reviewRoles: { careEvidence: string[]; shiftAttendance: string[] };
}

export const DEFAULT_FLAGS: PolicyFlags = {
  rankProposals: { enabled: false, proposerRoles: ['INSTRUCTOR'], approverRole: 'SUPER_ADMIN' },
  attendanceAccuracyThresholdM: null,
  postureAnalysis: { enabled: false, provider: null },
  reviewRoles: { careEvidence: ['SCHOOL_ADMIN'], shiftAttendance: ['SCHOOL_ADMIN'] },
};

// ------------------------------------------------------------------ shift (FO-11)
export type VerificationState = 'within_radius' | 'outside_radius' | 'low_accuracy' | 'no_location' | 'hub_location_unknown';

export interface ShiftRecord {
  attendanceId: string;
  /** server receive time (staff_attendance.punch_in_time default now()) */
  punchInAt: string;
  punchOutAt: string | null;
  /** device time sent as evidence */
  observedAt: string | null;
  accuracyM: number | null;
  distanceM: number | null;
  verificationState: VerificationState | null;
  operationId: string | null;
  /** G9 app_review_decisions for this row, readable by the staff member (subject_user_id = caller) */
  review: { decision: 'accepted' | 'rejected'; reason: string; decidedAt: string } | null;
}

export interface ShiftStatus {
  /** open punch-in (no punch-out within the server's 24 h window) */
  open: ShiftRecord | null;
  recent: ShiftRecord[];
  /** D11: no server path accepts a selfie yet, so photo proof is not collected. */
  photoProof: 'not_supported' | 'optional' | 'required';
  thresholdM: number | null;
}

export interface PunchInReceipt {
  attendanceId: string;
  verificationState: VerificationState | null;
  distanceM: number | null;
  duplicate: boolean;
}

// ------------------------------------------------------------------ review (FO-17/18, G9 §3.6)
export type ReviewKind = 'care_evidence' | 'shift_attendance' | 'rank_proposal';
export const REVIEW_KINDS: readonly ReviewKind[] = ['care_evidence', 'shift_attendance', 'rank_proposal'];

export interface ReviewItem {
  kind: ReviewKind;
  itemId: string;
  hubId: string;
  version: number;
  state: 'open' | 'accepted' | 'rejected';
  reasons: string[];
  subjectUserId: string | null;
  subjectName: string | null;
  observedAt: string | null;
  receivedAt: string | null;
  accuracyM: number | null;
  distanceM: number | null;
  horseName: string | null;
  taskType: string | null;
  dueAt: string | null;
  late: boolean | null;
  media: { bucket: string; path: string } | null;
  cadetId: string | null;
  cadetName: string | null;
  fromRank: string | null;
  toRank: string | null;
  evidenceSessionIds: string[];
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  canDecide: boolean;
}

export type ReviewQueue = { kind: 'ok'; items: ReviewItem[]; fetchedAt: number } | { kind: 'denied' };

export interface ReviewDecisionRequest {
  kind: ReviewKind;
  itemId: string;
  expectedVersion: number;
  /** care/shift: accepted|rejected; rank: approved|rejected (mapped by the repository) */
  decision: 'accept' | 'reject';
  reason: string;
  operationId: string;
}

export interface ReviewDecisionResult {
  kind: ReviewKind;
  itemId: string;
  decision: 'accepted' | 'rejected';
  decidedAt: string;
  duplicate: boolean;
}

// ------------------------------------------------------------------ rank (FO-19, G9 §3.7)
export type Rank = 'CADET_SQUIRE' | 'CADET_RIDER' | 'CADET_KNIGHT' | 'SOVEREIGN_LANCER';
export const RANKS: readonly Rank[] = ['CADET_SQUIRE', 'CADET_RIDER', 'CADET_KNIGHT', 'SOVEREIGN_LANCER'];

export interface RankCandidate {
  cadetId: string;
  name: string;
  currentRank: Rank | null;
  /** published (brass_stamp_verified) sessions, newest first */
  sessions: { sessionId: string; sessionDate: string; riding: number | null; ground: number | null; stable: number | null }[];
}

export interface RankProposalRequest {
  cadetId: string;
  toRank: Rank;
  evidenceSessionIds: string[];
  note: string | null;
  operationId: string;
}

export interface RankProposalResult {
  proposalId: string;
  fromRank: string;
  toRank: string;
  status: 'proposed';
  proposedAt: string;
  duplicate: boolean;
}

// ------------------------------------------------------------------ capability (FO-20, G9 §3.9)
export interface PostureCapability {
  status: 'unavailable';
  reason: 'feature_disabled' | 'provider_not_configured' | 'provider_not_integrated' | 'unknown';
}
