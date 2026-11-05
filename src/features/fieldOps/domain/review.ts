// FO-17/18/19 rules shared by screens and repositories. The server is the authority (G9 §3.6–3.7); these mirror its
// validation so the person gets an answer before a request, and never decide anything themselves.
import { RANKS, type Rank, type ReviewItem, type ReviewKind } from './types';

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const NOTE_MAX = 1000;
export const EVIDENCE_MIN = 1;
export const EVIDENCE_MAX = 20;

export type ReasonProblem = 'too_short' | 'too_long' | null;

export function reasonProblem(reason: string): ReasonProblem {
  const n = reason.trim().length;
  if (n < REASON_MIN) return 'too_short';
  if (n > REASON_MAX) return 'too_long';
  return null;
}

export interface ReviewSegment {
  kind: ReviewKind;
  items: ReviewItem[];
}

/** Segments only for kinds the server returned or that the person may review; rank only when items exist. */
export function reviewSegments(items: readonly ReviewItem[], rankEnabled: boolean): ReviewSegment[] {
  const by = (k: ReviewKind) => items.filter((i) => i.kind === k);
  const segs: ReviewSegment[] = [
    { kind: 'care_evidence', items: by('care_evidence') },
    { kind: 'shift_attendance', items: by('shift_attendance') },
  ];
  const rank = by('rank_proposal');
  if (rankEnabled || rank.length > 0) segs.push({ kind: 'rank_proposal', items: rank });
  return segs;
}

/** Plain-language key for one server review reason. */
export function reviewReasonKey(kind: ReviewKind, reason: string): string {
  if (kind === 'rank_proposal') return 'fo.reason.rank_change';
  const known = [
    'location_missing', 'weak_location_accuracy', 'outside_geofence', 'observed_in_future', 'task_already_completed',
    'task_already_submitted', 'task_cancelled', 'low_accuracy', 'outside_radius', 'no_location', 'hub_location_unknown',
    'review_all_policy', 'accuracy_above_threshold',
  ];
  return known.includes(reason) ? `fo.reason.${reason}` : 'fo.reason.other';
}

/**
 * Whether the decide buttons may be shown. The server's can_decide already excludes the person's own records; the
 * subject check is repeated so a stale or malformed row can never offer self-approval.
 */
export function mayDecide(item: ReviewItem, viewerId: string): boolean {
  return item.canDecide && item.state === 'open' && item.subjectUserId !== viewerId;
}

export function isRank(v: unknown): v is Rank {
  return typeof v === 'string' && (RANKS as readonly string[]).includes(v);
}

export type ProposalProblem = 'same_rank' | 'no_rank' | 'evidence_count' | 'note_too_long' | null;

export function proposalProblem(p: { currentRank: Rank | null; toRank: Rank | null; evidence: readonly string[]; note: string }): ProposalProblem {
  if (!p.toRank) return 'no_rank';
  if (p.toRank === p.currentRank) return 'same_rank';
  const n = new Set(p.evidence).size;
  if (n < EVIDENCE_MIN || n > EVIDENCE_MAX) return 'evidence_count';
  if (p.note.trim().length > NOTE_MAX) return 'note_too_long';
  return null;
}

/** Whether this role may propose under the flag's configured proposer roles (UX only; the server re-checks). */
export function mayPropose(role: string | null, proposerRoles: readonly string[]): boolean {
  return role !== null && proposerRoles.includes(role);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNTHETIC = /^syn-[a-z0-9-]{1,60}$/;

/** Deep-link guard: only well-formed ids and known kinds reach a repository. */
export function safeId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return UUID.test(v) || SYNTHETIC.test(v) ? v : null;
}

export function safeKind(v: unknown): ReviewKind | null {
  return v === 'care_evidence' || v === 'shift_attendance' || v === 'rank_proposal' ? v : null;
}
