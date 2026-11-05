// Ported from g6-prework/src/passport/projectPassport.ts (4 Nov 2026), unchanged in behaviour; pure TypeScript.

import { RANK_LABEL, type BadgeEvent, type PassportInput, type Rank, type RankEvent, type SessionRevision } from './passportTypes';

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

export interface SessionEntry {
  revisionId: string;
  sessionDate: string;
  scores: SessionRevision['scores'];
  achievedSkills: string[];
  corrected: boolean;
  correctionReason: string | null;
  withdrawn: boolean;
  earlierVersions: number;
  hasClip: boolean;
}

export interface SkillEntry {
  code: string;
  label: string;
  firstAchievedOn: string;
  evidenceRevisionId: string;
}

export interface RankTimelineEntry {
  eventId: string;
  rank: Rank;
  label: string;
  recordedAt: string;
  status: 'current' | 'earlier' | 'corrected' | 'revoked';
  note: string | null;
  evidenceCount: number;
  ruleVersion: string | null;
}

export interface BadgeEntry {
  badgeCode: string;
  label: string;
  awardedAt: string;
  status: 'active' | 'revoked';
  note: string | null;
}

export interface PassportView {
  cadetId: string;
  currentRank: { rank: Rank; label: string } | null;
  /** Shown instead of any "next rank" progress when rules are not configured on the server. */
  rankRuleNote: string;
  integrityWarning: 'rank-history-mismatch' | null;
  sessions: SessionEntry[];
  skills: SkillEntry[];
  rankTimeline: RankTimelineEntry[];
  badges: BadgeEntry[];
  dataAsOf: string;
  empty: boolean;
}

function assertScope(cadetId: string, rows: { cadetId: string }[], what: string): void {
  const stray = rows.find((r) => r.cadetId !== cadetId);
  if (stray) throw new ScopeError(`${what} for another cadet in passport payload`);
}

function byTimeAsc<T extends { recordedAt: string }>(a: T, b: T): number {
  return a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0;
}

/** Replays server rank events. Used only to cross-check the server's current rank, never to promote. */
export function replayRank(events: RankEvent[]): Rank | null {
  let rank: Rank | null = null;
  for (const e of [...events].sort(byTimeAsc)) {
    if (e.kind === 'awarded' || e.kind === 'corrected') rank = e.rank;
    else if (e.kind === 'revoked') rank = e.previousRank;
  }
  return rank;
}

function projectSessions(rows: SessionRevision[]): SessionEntry[] {
  const visible = rows.filter((r) => r.status === 'published' || r.status === 'withdrawn');
  const earlierCount = (r: SessionRevision): number => {
    let n = 0;
    let cursor = r.supersedesId;
    const index = new Map(rows.map((x) => [x.id, x]));
    while (cursor) {
      n += 1;
      cursor = index.get(cursor)?.supersedesId ?? null;
    }
    return n;
  };
  return visible
    .map((r) => ({
      revisionId: r.id,
      sessionDate: r.sessionDate,
      scores: r.scores,
      achievedSkills: r.status === 'published' ? r.skills.filter((s) => s.achieved).map((s) => s.label) : [],
      corrected: r.revision > 1,
      correctionReason: r.correctionReason,
      withdrawn: r.status === 'withdrawn',
      earlierVersions: earlierCount(r),
      hasClip: r.status === 'published' && r.hasClip,
    }))
    .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : a.sessionDate > b.sessionDate ? -1 : 0));
}

function projectSkills(rows: SessionRevision[]): SkillEntry[] {
  const best = new Map<string, SkillEntry>();
  for (const r of rows) {
    if (r.status !== 'published') continue; // superseded or withdrawn evidence never counts
    for (const s of r.skills) {
      if (!s.achieved) continue;
      const prev = best.get(s.code);
      if (!prev || r.sessionDate < prev.firstAchievedOn) {
        best.set(s.code, { code: s.code, label: s.label, firstAchievedOn: r.sessionDate, evidenceRevisionId: r.id });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function projectRankTimeline(events: RankEvent[], effective: Rank | null): RankTimelineEntry[] {
  const sorted = [...events].sort(byTimeAsc);
  const revoked = new Map<string, RankEvent>();
  const corrected = new Map<string, RankEvent>();
  for (const e of sorted) {
    if (e.kind === 'revoked' && e.targetEventId) revoked.set(e.targetEventId, e);
    if (e.kind === 'corrected' && e.targetEventId) corrected.set(e.targetEventId, e);
  }
  const awardLike = sorted.filter((e) => e.kind === 'awarded' || e.kind === 'corrected');
  const lastActive = [...awardLike].reverse().find((e) => !revoked.has(e.id) && !corrected.has(e.id));
  return awardLike
    .map<RankTimelineEntry>((e) => {
      const rev = revoked.get(e.id);
      const cor = corrected.get(e.id);
      let status: RankTimelineEntry['status'] = 'earlier';
      let note: string | null = e.kind === 'corrected' ? `Corrected by the academy${e.reason ? `: ${e.reason}` : ''}` : null;
      if (rev) {
        status = 'revoked';
        note = `Withdrawn by the academy on ${rev.recordedAt.slice(0, 10)}${rev.reason ? `: ${rev.reason}` : ''}`;
      } else if (cor) {
        status = 'corrected';
        note = `Replaced by a correction on ${cor.recordedAt.slice(0, 10)}`;
      } else if (lastActive && e.id === lastActive.id && e.rank === effective) {
        status = 'current';
      }
      return {
        eventId: e.id,
        rank: e.rank,
        label: RANK_LABEL[e.rank],
        recordedAt: e.recordedAt,
        status,
        note,
        evidenceCount: e.evidenceRevisionIds.length,
        ruleVersion: e.ruleVersion,
      };
    })
    .reverse();
}

function projectBadges(events: BadgeEvent[]): BadgeEntry[] {
  const sorted = [...events].sort(byTimeAsc);
  const revoked = new Map<string, BadgeEvent>();
  for (const e of sorted) if (e.kind === 'revoked' && e.targetEventId) revoked.set(e.targetEventId, e);
  return sorted
    .filter((e) => e.kind === 'awarded')
    .map((e) => {
      const r = revoked.get(e.id);
      return {
        badgeCode: e.badgeCode,
        label: e.label,
        awardedAt: e.recordedAt,
        status: r ? ('revoked' as const) : ('active' as const),
        note: r ? `Withdrawn by the academy on ${r.recordedAt.slice(0, 10)}${r.reason ? `: ${r.reason}` : ''}` : null,
      };
    })
    .reverse();
}

export function projectPassport(input: PassportInput): PassportView {
  assertScope(input.cadetId, input.sessions, 'session');
  assertScope(input.cadetId, input.rankEvents, 'rank event');
  assertScope(input.cadetId, input.badgeEvents, 'badge');

  const replayed = replayRank(input.rankEvents);
  const mismatch = input.rankEvents.length > 0 && replayed !== input.serverCurrentRank;
  const sessions = projectSessions(input.sessions);
  const rankRuleNote = input.rankRule.configured
    ? `Rank rule ${input.rankRule.version}: ${input.rankRule.description}`
    : 'Ranks are awarded by the academy. Progress below is what has been recorded; there is no automatic promotion.';

  return {
    cadetId: input.cadetId,
    currentRank: input.serverCurrentRank ? { rank: input.serverCurrentRank, label: RANK_LABEL[input.serverCurrentRank] } : null,
    rankRuleNote,
    integrityWarning: mismatch ? 'rank-history-mismatch' : null,
    sessions,
    skills: projectSkills(input.sessions),
    rankTimeline: projectRankTimeline(input.rankEvents, input.serverCurrentRank),
    badges: projectBadges(input.badgeEvents),
    dataAsOf: input.dataAsOf,
    empty: sessions.length === 0 && input.rankEvents.length === 0 && input.badgeEvents.length === 0,
  };
}
