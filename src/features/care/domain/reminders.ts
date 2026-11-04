// Local reminder plan for assigned care tasks. Best effort only: the OS may delay, batch or drop local notifications
// (Doze/App Standby on Android, Focus/notification settings on iOS), and they never bypass silent mode. The Today
// timeline and server overdue detection remain the source of truth.
import type { QueueItem } from '../../sync/domain/types';
import type { ServerCareOccurrence } from './careTypes';

export interface PlannedReminder {
  /** stable id so re-planning replaces instead of duplicating */
  id: string;
  occurrenceId: string;
  fireAt: number;
  titleKey: 'reminder.title';
  bodyKey: 'reminder.body';
  /** generic content only: due time, never horse, person or medication details on the lock screen */
  params: { dueAt: number; timezone: string };
}

export interface ReminderOptions {
  leadMs: number; // PROPOSED: 10 min before due
  horizonMs: number; // only the next 24 h
  /** iOS keeps at most 64 pending local notifications per app; stay well below */
  maxPending: number;
}

export const DEFAULT_REMINDER_OPTIONS: ReminderOptions = { leadMs: 10 * 60_000, horizonMs: 24 * 3_600_000, maxPending: 20 };

export function planReminders(
  occurrences: readonly ServerCareOccurrence[],
  queue: readonly QueueItem[],
  now: number,
  opts: ReminderOptions = DEFAULT_REMINDER_OPTIONS,
): PlannedReminder[] {
  const withEvidence = new Set(
    queue.filter((q) => q.commandType === 'care.submitEvidence' && q.state !== 'discarded').map((q) => q.aggregateId),
  );
  return occurrences
    .filter((o) => o.status === 'pending' && !withEvidence.has(o.occurrenceId))
    .map((o) => ({ o, fireAt: o.dueAt - opts.leadMs }))
    .filter(({ fireAt }) => fireAt > now && fireAt <= now + opts.horizonMs)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, opts.maxPending)
    .map(({ o, fireAt }) => ({
      id: `care-${o.occurrenceId}`,
      occurrenceId: o.occurrenceId,
      fireAt,
      titleKey: 'reminder.title' as const,
      bodyKey: 'reminder.body' as const,
      params: { dueAt: o.dueAt, timezone: o.timezone },
    }));
}

/** Diff against what is currently scheduled so the adapter cancels stale reminders and adds new ones. */
export function diffReminders(scheduledIds: readonly string[], planned: readonly PlannedReminder[]): { cancel: string[]; add: PlannedReminder[] } {
  const want = new Set(planned.map((p) => p.id));
  const have = new Set(scheduledIds);
  return { cancel: scheduledIds.filter((id) => !want.has(id)), add: planned.filter((p) => !have.has(p.id)) };
}
