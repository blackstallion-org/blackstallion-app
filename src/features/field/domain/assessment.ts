/**
 * Client-side mirror of field_publish_session's input rules (foundations/live-delta MIG:393-399) so staff see
 * problems before sending. The server still enforces every rule; these limits must stay equal to the server's.
 */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const NOTES_MAX = 2000;
export const SKILLS_MAX = 20;

export type ScoreKey = 'riding' | 'ground' | 'stable';
export const SCORE_KEYS: readonly ScoreKey[] = ['riding', 'ground', 'stable'];

export type AssessmentDraft = {
  riding: number | null;
  ground: number | null;
  stable: number | null;
  notes: string;
  skillIds: readonly string[];
};

export type ValidAssessment = {
  riding: number;
  ground: number;
  stable: number;
  notes: string | null;
  skillIds: string[] | null;
};

export type AssessmentErrors = Partial<Record<ScoreKey | 'notes' | 'skills', string>>;

export const emptyDraft = (): AssessmentDraft => ({ riding: null, ground: null, stable: null, notes: '', skillIds: [] });

/** Postgres char_length counts code points, not UTF-16 units. */
export const codePointLength = (s: string): number => Array.from(s).length;

const scoreLabel: Record<ScoreKey, string> = { riding: 'Riding', ground: 'Ground', stable: 'Stable' };

export function validateAssessment(d: AssessmentDraft):
  | { ok: true; value: ValidAssessment }
  | { ok: false; errors: AssessmentErrors } {
  const errors: AssessmentErrors = {};
  for (const k of SCORE_KEYS) {
    const v = d[k];
    if (v === null || !Number.isInteger(v) || v < SCORE_MIN || v > SCORE_MAX) {
      errors[k] = `Give a ${scoreLabel[k].toLowerCase()} score from ${SCORE_MIN} to ${SCORE_MAX}.`;
    }
  }
  const notes = d.notes.trim();
  if (codePointLength(notes) > NOTES_MAX) errors.notes = `Notes are limited to ${NOTES_MAX} characters.`;
  const skills = Array.from(new Set(d.skillIds.filter((s) => s.length > 0))).sort();
  if (skills.length > SKILLS_MAX) errors.skills = `Choose at most ${SKILLS_MAX} skills.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      riding: d.riding as number,
      ground: d.ground as number,
      stable: d.stable as number,
      notes: notes.length > 0 ? notes : null,
      skillIds: skills.length > 0 ? skills : null,
    },
  };
}

/** Stable key of what will be sent; a changed payload must get a new operation id (server: same id + new hash = 409). */
export const assessmentPayloadKey = (checkInOperationId: string, v: ValidAssessment): string =>
  JSON.stringify([checkInOperationId, v.riding, v.ground, v.stable, v.notes ?? '', v.skillIds ?? []]);
