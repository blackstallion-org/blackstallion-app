// Ported from g6-prework/src/spark (4 Nov 2026) unchanged in behaviour; pure TypeScript (lint-enforced).
import { addDays, localDate } from './localDay';
import type { SparkPolicy } from './policy';

/** A completion as recorded by the server. receivedAt is server time; the device clock is never used. */
export interface SparkCompletion {
  sparkId: string;
  serverReceivedAt: string;
}

export type StreakResult =
  | { enabled: false; reason: 'policy-not-approved'; completedToday: boolean }
  | { enabled: true; current: number; longest: number; completedToday: boolean; policyVersion: string };

/** Idempotency key for "complete this Spark": one completion per subject per Spark, ever. */
export function completionKey(subjectId: string, sparkId: string): string {
  return `spark-complete:${subjectId}:${sparkId}`;
}

/** Client-side merge mirrors the server's unique constraint so a duplicate never double-counts. */
export function mergeCompletion(list: SparkCompletion[], c: SparkCompletion): SparkCompletion[] {
  return list.some((x) => x.sparkId === c.sparkId) ? list : [...list, c];
}

export function computeStreak(completions: SparkCompletion[], policy: SparkPolicy, serverNow: string): StreakResult {
  const tz = policy.timeZone;
  const now = new Date(serverNow);
  const days = new Set<string>();
  const seen = new Set<string>();
  for (const c of completions) {
    if (seen.has(c.sparkId)) continue; // duplicate rows can never add a day twice
    seen.add(c.sparkId);
    if (new Date(c.serverReceivedAt).getTime() > now.getTime()) continue; // future-dated rows are ignored
    days.add(localDate(c.serverReceivedAt, tz));
  }
  const today = localDate(now, tz);
  const completedToday = days.has(today);
  if (policy.status !== 'APPROVED') return { enabled: false, reason: 'policy-not-approved', completedToday };

  let current = 0;
  let cursor = completedToday ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  let longest = 0;
  for (const d of [...days].sort()) {
    if (days.has(addDays(d, -1))) continue;
    let len = 0;
    let c = d;
    while (days.has(c)) {
      len += 1;
      c = addDays(c, 1);
    }
    longest = Math.max(longest, len);
  }
  return { enabled: true, current, longest, completedToday, policyVersion: policy.version };
}
