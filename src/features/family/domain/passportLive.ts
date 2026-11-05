// Maps the LIVE records a guardian can read (16 §2; SLICE_CONTRACT §B) into the g6 PassportInput. Pure TypeScript.
// Live corrections are in place (training_sessions.version + training_session_corrections), so every row is the
// current revision ('published'); rank_history rows are rank changes written by the server trigger (each one an
// award of `to_rank`); achievements are awards with no revocation model. Unknown rank strings are dropped, never
// guessed. No rank rule is configured (D15 PROPOSED), so the projection says ranks are awarded by the academy.

import type { BadgeEvent, PassportInput, Rank, RankEvent, SessionRevision } from './passportTypes';

const RANKS: readonly Rank[] = ['CADET_SQUIRE', 'CADET_RIDER', 'CADET_KNIGHT', 'SOVEREIGN_LANCER'];
export const asRank = (v: unknown): Rank | null => (typeof v === 'string' && (RANKS as readonly string[]).includes(v) ? (v as Rank) : null);

export interface LiveSessionRecord {
  id: string;
  sessionDate: string;
  version: number;
  scores: { riding: number; ground: number; stable: number };
  /** Skills recorded as achieved in this session (session_skills → skills). */
  skills: readonly { id: string; name: string }[];
  hasClip: boolean;
}

export interface LiveRankChange {
  id: string;
  fromRank: string | null;
  toRank: string;
  /** Server time (rank_history.promoted_at). */
  promotedAt: string;
}

export interface LiveAchievement {
  id: string;
  type: string;
  title: string;
  /** Server time (achievements.awarded_at); null in legacy rows. */
  awardedAt: string | null;
}

export interface LivePassportRecords {
  cadetId: string;
  currentRank: string | null;
  sessions: readonly LiveSessionRecord[];
  rankChanges: readonly LiveRankChange[];
  achievements: readonly LiveAchievement[];
  dataAsOf: string;
}

export function toPassportInput(r: LivePassportRecords): PassportInput {
  const sessions: SessionRevision[] = r.sessions.map((s) => ({
    id: s.id,
    cadetId: r.cadetId,
    sessionDate: s.sessionDate,
    revision: s.version,
    supersedesId: null,
    status: 'published',
    scores: s.scores,
    skills: s.skills.map((k) => ({ code: k.id, label: k.name, achieved: true })),
    correctionReason: null,
    publishedAt: `${s.sessionDate}T00:00:00Z`,
    hasClip: s.hasClip,
  }));
  const rankEvents: RankEvent[] = [];
  for (const c of r.rankChanges) {
    const rank = asRank(c.toRank);
    if (!rank) continue;
    rankEvents.push({
      id: c.id,
      cadetId: r.cadetId,
      kind: 'awarded',
      rank,
      previousRank: asRank(c.fromRank),
      ruleVersion: null,
      evidenceRevisionIds: [],
      targetEventId: null,
      reason: null,
      recordedAt: c.promotedAt,
    });
  }
  const badgeEvents: BadgeEvent[] = r.achievements
    .filter((a) => a.awardedAt !== null)
    .map((a) => ({
      id: a.id,
      cadetId: r.cadetId,
      badgeCode: a.type,
      label: a.title,
      kind: 'awarded',
      targetEventId: null,
      evidenceRevisionIds: [],
      reason: null,
      recordedAt: a.awardedAt as string,
    }));
  return {
    cadetId: r.cadetId,
    serverCurrentRank: asRank(r.currentRank),
    sessions,
    rankEvents,
    badgeEvents,
    rankRule: { configured: false },
    dataAsOf: r.dataAsOf,
  };
}
