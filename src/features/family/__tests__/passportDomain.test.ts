/**
 * Ported from g6-prework/test/passport.test.ts (vitest → jest, unchanged assertions) plus the live-record adapter.
 * The family scope cache tests are not ported: the app scopes by resource key (useScopedResource) and refuses
 * unlinked children in the repositories (familyServer.test.ts).
 */
import { projectPassport, replayRank, ScopeError } from '../domain/passport';
import { toPassportInput } from '../domain/passportLive';
import type { PassportInput, RankEvent, SessionRevision } from '../domain/passportTypes';

const A = 'cadet-a';
const rev = (o: Partial<SessionRevision> & Pick<SessionRevision, 'id' | 'sessionDate'>): SessionRevision => ({
  cadetId: A, revision: 1, supersedesId: null, status: 'published',
  scores: { riding: 6, ground: 6, stable: 6 }, skills: [], correctionReason: null,
  publishedAt: `${o.sessionDate}T05:00:00Z`, hasClip: false, ...o,
});
const rank = (o: Partial<RankEvent> & Pick<RankEvent, 'id' | 'kind' | 'rank' | 'recordedAt'>): RankEvent => ({
  cadetId: A, previousRank: null, ruleVersion: null, evidenceRevisionIds: [], targetEventId: null, reason: null, ...o,
});
const base = (o: Partial<PassportInput> = {}): PassportInput => ({
  cadetId: A, serverCurrentRank: null, sessions: [], rankEvents: [], badgeEvents: [],
  rankRule: { configured: false }, dataAsOf: '2026-11-12T06:00:00Z', ...o,
});

describe('passport projection', () => {
  it('shows only the current revision of a corrected session, flagged with its reason', () => {
    const v = projectPassport(base({
      sessions: [
        rev({ id: 'r1', sessionDate: '2026-11-03', status: 'superseded', scores: { riding: 9, ground: 6, stable: 8 },
              skills: [{ code: 'trot', label: 'Rising trot', achieved: true }] }),
        rev({ id: 'r2', sessionDate: '2026-11-03', revision: 2, supersedesId: 'r1', correctionReason: 'Mis-keyed riding score',
              scores: { riding: 7, ground: 6, stable: 8 }, skills: [{ code: 'trot', label: 'Rising trot', achieved: false }] }),
      ],
    }));
    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0]).toMatchObject({ revisionId: 'r2', corrected: true, correctionReason: 'Mis-keyed riding score', earlierVersions: 1 });
    expect(v.sessions[0]!.scores.riding).toBe(7);
    // the skill only existed in the superseded revision, so it must not count
    expect(v.skills).toEqual([]);
  });

  it('keeps a withdrawn session visible as withdrawn, without skills or clip', () => {
    const v = projectPassport(base({ sessions: [rev({ id: 'w', sessionDate: '2026-11-01', status: 'withdrawn', hasClip: true,
      skills: [{ code: 'tack', label: 'Tack up', achieved: true }] })] }));
    expect(v.sessions[0]).toMatchObject({ withdrawn: true, hasClip: false, achievedSkills: [] });
    expect(v.skills).toEqual([]);
  });

  it('lists skills once, from the earliest current evidence, sorted by label', () => {
    const v = projectPassport(base({ sessions: [
      rev({ id: 'a', sessionDate: '2026-10-20', skills: [{ code: 'trot', label: 'Rising trot', achieved: true }] }),
      rev({ id: 'b', sessionDate: '2026-10-27', skills: [{ code: 'trot', label: 'Rising trot', achieved: true }, { code: 'halt', label: 'Halt & walk', achieved: true }] }),
    ] }));
    expect(v.skills.map((s) => [s.label, s.firstAchievedOn, s.evidenceRevisionId])).toEqual([
      ['Halt & walk', '2026-10-27', 'b'], ['Rising trot', '2026-10-20', 'a'],
    ]);
  });

  it('shows a revoked rank award as withdrawn, not erased, and uses the server current rank', () => {
    const events = [
      rank({ id: 'e1', kind: 'awarded', rank: 'CADET_SQUIRE', recordedAt: '2026-09-01T05:00:00Z' }),
      rank({ id: 'e2', kind: 'awarded', rank: 'CADET_RIDER', previousRank: 'CADET_SQUIRE', recordedAt: '2026-10-01T05:00:00Z', evidenceRevisionIds: ['a', 'b'] }),
      rank({ id: 'e3', kind: 'revoked', rank: 'CADET_RIDER', previousRank: 'CADET_SQUIRE', targetEventId: 'e2', reason: 'Awarded to the wrong cadet', recordedAt: '2026-10-02T05:00:00Z' }),
    ];
    const v = projectPassport(base({ serverCurrentRank: 'CADET_SQUIRE', rankEvents: events }));
    expect(v.currentRank?.label).toBe('Cadet Squire');
    expect(v.integrityWarning).toBeNull();
    expect(v.rankTimeline.map((e) => [e.label, e.status])).toEqual([['Cadet Rider', 'revoked'], ['Cadet Squire', 'current']]);
    expect(v.rankTimeline[0]!.note).toContain('Awarded to the wrong cadet');
  });

  it('marks a corrected award and its replacement accurately', () => {
    const events = [
      rank({ id: 'e1', kind: 'awarded', rank: 'CADET_KNIGHT', recordedAt: '2026-10-01T05:00:00Z' }),
      rank({ id: 'e2', kind: 'corrected', rank: 'CADET_RIDER', targetEventId: 'e1', reason: 'Wrong rank selected', recordedAt: '2026-10-01T06:00:00Z' }),
    ];
    const v = projectPassport(base({ serverCurrentRank: 'CADET_RIDER', rankEvents: events }));
    expect(v.rankTimeline.map((e) => [e.label, e.status])).toEqual([['Cadet Rider', 'current'], ['Cadet Knight', 'corrected']]);
    expect(v.rankTimeline[0]!.note).toContain('Wrong rank selected');
  });

  it('flags (but does not "fix") a server current rank that disagrees with history — live finding W3/W4', () => {
    const v = projectPassport(base({ serverCurrentRank: 'CADET_KNIGHT',
      rankEvents: [rank({ id: 'e1', kind: 'awarded', rank: 'CADET_RIDER', recordedAt: '2026-10-01T05:00:00Z' })] }));
    expect(v.integrityWarning).toBe('rank-history-mismatch');
    expect(v.currentRank?.rank).toBe('CADET_KNIGHT'); // display what the server says; report, never recompute
  });

  it('never invents a promotion threshold when rules are not configured', () => {
    const v = projectPassport(base({ sessions: Array.from({ length: 40 }, (_, i) =>
      rev({ id: `s${i}`, sessionDate: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, scores: { riding: 10, ground: 10, stable: 10 } })) }));
    expect(v.currentRank).toBeNull();
    expect(v.rankRuleNote).toMatch(/no automatic promotion/);
    expect(JSON.stringify(v)).not.toMatch(/next ?rank|threshold|progressToNext/i);
  });

  it('rejects a payload containing another cadet’s records', () => {
    expect(() => projectPassport(base({ sessions: [rev({ id: 'x', sessionDate: '2026-11-01', cadetId: 'cadet-b' })] }))).toThrow(ScopeError);
  });

  it('reports an empty passport for a new cadet', () => {
    expect(projectPassport(base()).empty).toBe(true);
  });

  it('replayRank follows award, correction and revocation order', () => {
    expect(replayRank([
      rank({ id: '1', kind: 'awarded', rank: 'CADET_SQUIRE', recordedAt: '2026-01-01T00:00:00Z' }),
      rank({ id: '2', kind: 'awarded', rank: 'CADET_RIDER', previousRank: 'CADET_SQUIRE', recordedAt: '2026-02-01T00:00:00Z' }),
      rank({ id: '3', kind: 'revoked', rank: 'CADET_RIDER', previousRank: 'CADET_SQUIRE', targetEventId: '2', recordedAt: '2026-02-02T00:00:00Z' }),
    ])).toBe('CADET_SQUIRE');
  });
});

describe('live records → passport (adapter)', () => {
  const live = {
    cadetId: A,
    currentRank: 'CADET_RIDER',
    sessions: [
      { id: 's1', sessionDate: '2026-10-03', version: 1, scores: { riding: 6, ground: 5, stable: 7 }, skills: [{ id: 'k1', name: 'Halt and walk on' }], hasClip: true },
      { id: 's2', sessionDate: '2026-11-07', version: 2, scores: { riding: 8, ground: 6, stable: 8 }, skills: [{ id: 'k1', name: 'Halt and walk on' }, { id: 'k2', name: 'Rising trot' }], hasClip: false },
    ],
    rankChanges: [
      { id: 'r1', fromRank: 'CADET_SQUIRE', toRank: 'CADET_RIDER', promotedAt: '2026-10-17T11:00:00Z' },
      { id: 'r0', fromRank: null, toRank: 'NOT_A_RANK', promotedAt: '2026-09-01T00:00:00Z' },
    ],
    achievements: [
      { id: 'a1', type: 'MILESTONE', title: 'First canter', awardedAt: '2026-10-24T10:30:00Z' },
      { id: 'a2', type: 'MILESTONE', title: 'Undated legacy row', awardedAt: null },
    ],
    dataAsOf: '2026-11-08T00:00:00Z',
  };

  it('shows the server rank, a timeline from rank_history only, skills from their earliest published evidence', () => {
    const v = projectPassport(toPassportInput(live));
    expect(v.currentRank).toEqual({ rank: 'CADET_RIDER', label: 'Cadet Rider' });
    expect(v.integrityWarning).toBeNull();
    expect(v.rankTimeline.map((e) => [e.label, e.status])).toEqual([['Cadet Rider', 'current']]); // unknown rank dropped, not guessed
    expect(v.skills.map((s) => [s.label, s.firstAchievedOn, s.evidenceRevisionId])).toEqual([
      ['Halt and walk on', '2026-10-03', 's1'],
      ['Rising trot', '2026-11-07', 's2'],
    ]);
    expect(v.sessions[0]).toMatchObject({ revisionId: 's2', corrected: true });
    expect(v.badges.map((b) => b.label)).toEqual(['First canter']); // an undated row is not placed on a timeline
  });

  it('flags a current rank that history does not support, and never invents a promotion rule', () => {
    const v = projectPassport(toPassportInput({ ...live, currentRank: 'CADET_KNIGHT' }));
    expect(v.integrityWarning).toBe('rank-history-mismatch');
    expect(v.currentRank?.label).toBe('Cadet Knight');
    expect(v.rankRuleNote).toMatch(/awarded by the academy/);
  });

  it('a new cadet with no history: server rank only, empty timeline', () => {
    const v = projectPassport(toPassportInput({ ...live, sessions: [], rankChanges: [], achievements: [], currentRank: 'CADET_SQUIRE' }));
    expect(v.currentRank?.label).toBe('Cadet Squire');
    expect(v.rankTimeline).toEqual([]);
    expect(v.empty).toBe(true);
  });
});
