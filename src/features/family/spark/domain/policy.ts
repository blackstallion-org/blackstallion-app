// Ported from g6-prework/src/spark (4 Nov 2026) unchanged in behaviour; pure TypeScript (lint-enforced).
// Daily Spark policy. Every value comes from the server so the client never hard-codes a business rule.
// The DEFAULT below mirrors decision D18 in 12_DECISION_REGISTER.md, which is PROPOSED (unsigned).
// While status !== 'APPROVED', streaks are disabled and only completion is recorded.

export interface SparkPolicy {
  status: 'PROPOSED' | 'APPROVED';
  /** IANA zone whose calendar day defines "a day" (hub-local). */
  timeZone: string;
  /** Local wall-clock time the day's Spark is released and the reminder fires, HH:MM. */
  releaseLocalTime: string;
  /** Fraction of the audio that must actually be heard (seeks don't count) to complete, 0–1. */
  completionMinCoverage: number;
  /** Whose streak: the signed-in guardian or each cadet (M13, unresolved). */
  streakScope: 'guardian' | 'cadet';
  version: string;
}

export const D18_PROPOSED: SparkPolicy = {
  status: 'PROPOSED',
  timeZone: 'Asia/Kolkata',
  releaseLocalTime: '06:00',
  completionMinCoverage: 0.9,
  streakScope: 'guardian',
  version: 'D18-proposed-2026-11-04',
};
