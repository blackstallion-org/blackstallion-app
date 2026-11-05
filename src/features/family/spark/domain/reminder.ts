// Ported from g6-prework/src/spark (4 Nov 2026) unchanged in behaviour; pure TypeScript (lint-enforced).
import { addDays, localDate, zonedTimeToUtc } from './localDay';
import type { SparkPolicy } from './policy';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export interface ReminderPrefs {
  sparkReminder: boolean;
}

export type ReminderPlan =
  | { schedule: false; reason: 'pref-off' | 'permission-denied' | 'permission-not-asked' | 'policy-not-approved' }
  | { schedule: true; fireAtUtc: string; localDate: string; localTime: string; timeZone: string; bestEffort: true };

/**
 * Decide the next morning reminder. Local notifications are best effort: the OS may delay or drop them
 * (battery savers, Focus). The app also shows today's Spark on Home, so a missed reminder loses nothing.
 * We never ask for permission here; the settings screen asks in context when the user turns the reminder on.
 */
export function planSparkReminder(prefs: ReminderPrefs, permission: NotificationPermission, policy: SparkPolicy, now: Date): ReminderPlan {
  if (!prefs.sparkReminder) return { schedule: false, reason: 'pref-off' };
  if (permission === 'denied') return { schedule: false, reason: 'permission-denied' };
  if (permission === 'undetermined') return { schedule: false, reason: 'permission-not-asked' };
  if (policy.status !== 'APPROVED') return { schedule: false, reason: 'policy-not-approved' };
  const today = localDate(now, policy.timeZone);
  let day = today;
  let at = zonedTimeToUtc(day, policy.releaseLocalTime, policy.timeZone);
  if (at.getTime() <= now.getTime()) {
    day = addDays(today, 1);
    at = zonedTimeToUtc(day, policy.releaseLocalTime, policy.timeZone);
  }
  return { schedule: true, fireAtUtc: at.toISOString(), localDate: day, localTime: policy.releaseLocalTime, timeZone: policy.timeZone, bestEffort: true };
}

/** Text for Settings when a reminder cannot be scheduled. */
export function reminderStatusText(plan: ReminderPlan): string {
  if (plan.schedule) return `Next reminder ${plan.localDate} at ${plan.localTime}. Phones can delay reminders; today's Spark is always on Home.`;
  switch (plan.reason) {
    case 'pref-off': return 'Morning reminder is off.';
    case 'permission-denied': return 'Notifications are turned off for this app in your phone settings. Today’s Spark is still on Home.';
    case 'permission-not-asked': return 'Turn on the reminder to choose whether this app may notify you.';
    case 'policy-not-approved': return 'Morning reminders start once the academy confirms the Spark schedule.';
  }
}
