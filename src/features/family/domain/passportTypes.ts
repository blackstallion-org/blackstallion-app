// Ported from g6-prework/src/passport/types.ts (4 Nov 2026), unchanged in behaviour; pure TypeScript (lint-enforced).
// Server-shaped records the passport screen consumes. The live adapter (passportLive.ts) maps today's tables
// (cadets.current_rank, rank_history, achievements, training_sessions) into these shapes; nothing here is computed on
// the phone that the server owns (rank, promotion, verification).

export type Rank = 'CADET_SQUIRE' | 'CADET_RIDER' | 'CADET_KNIGHT' | 'SOVEREIGN_LANCER';

export const RANK_LABEL: Record<Rank, string> = {
  CADET_SQUIRE: 'Cadet Squire',
  CADET_RIDER: 'Cadet Rider',
  CADET_KNIGHT: 'Cadet Knight',
  SOVEREIGN_LANCER: 'Sovereign Lancer',
};

export interface SkillResult {
  code: string;
  label: string;
  achieved: boolean;
}

/** One published (or later superseded/withdrawn) assessment revision for one cadet and session day. */
export interface SessionRevision {
  id: string;
  cadetId: string;
  /** Hub-local calendar date of the session, YYYY-MM-DD. */
  sessionDate: string;
  revision: number;
  supersedesId: string | null;
  status: 'published' | 'superseded' | 'withdrawn';
  scores: { riding: number; ground: number; stable: number };
  skills: SkillResult[];
  correctionReason: string | null;
  publishedAt: string; // ISO instant, server time
  hasClip: boolean;
}

export interface RankEvent {
  id: string;
  cadetId: string;
  kind: 'awarded' | 'corrected' | 'revoked';
  rank: Rank;
  previousRank: Rank | null;
  /** Server rule version that justified the award; null when awarded manually without a configured rule. */
  ruleVersion: string | null;
  evidenceRevisionIds: string[];
  /** For 'corrected' and 'revoked': the event being corrected or revoked. */
  targetEventId: string | null;
  reason: string | null;
  recordedAt: string; // ISO instant, server time
}

export interface BadgeEvent {
  id: string;
  cadetId: string;
  badgeCode: string;
  label: string;
  kind: 'awarded' | 'revoked';
  targetEventId: string | null;
  evidenceRevisionIds: string[];
  reason: string | null;
  recordedAt: string;
}

export type RankRuleStatus =
  | { configured: false }
  | { configured: true; version: string; description: string };

export interface PassportInput {
  cadetId: string;
  /** cadets.current_rank as the server reports it. The phone never derives this. */
  serverCurrentRank: Rank | null;
  sessions: SessionRevision[];
  rankEvents: RankEvent[];
  badgeEvents: BadgeEvent[];
  rankRule: RankRuleStatus;
  dataAsOf: string;
}
