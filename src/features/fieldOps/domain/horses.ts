// FO-08 / FO-09: hub horses with today's care status, and one horse's chronological task list.
// Server occurrences + local outbox → rows, reusing the G5 timeline rules (no client-computed "overdue").
import { buildCareTimeline, type CareDay, type CareRow } from '../../care/domain/timeline';
import type { QueueItem } from '../../sync/domain/types';
import type { CareTimeline, HubHorse, ServerCareOccurrence } from './types';

export type HorseStatus = 'overdue' | 'needs_action' | 'due' | 'on_time' | 'all_done' | 'no_tasks' | 'not_assigned' | 'inactive';

export interface HorseCareCounts {
  total: number;
  /** accepted by a supervisor (occurrence completed) */
  completed: number;
  /** proof saved/sending/received/under review: not "done" until accepted */
  sent: number;
  due: number;
  overdue: number;
  needsAction: number;
  next: { taskType: CareRow['taskType']; dueAt: number; timezone: string } | null;
}

export interface HorseSummary {
  horse: HubHorse;
  /** null when this person has no care duties to show (hub admin) or the horse has none today */
  counts: HorseCareCounts | null;
  status: HorseStatus;
}

export interface HorsesOverview {
  horses: HorseSummary[];
  inactive: HorseSummary[];
  totals: { overdue: number; needsAction: number; due: number; horsesWithTasks: number };
  /** false for a hub admin: field.my_care_timeline answers assigned staff only */
  careShown: boolean;
}

const STATUS_RANK: Record<HorseStatus, number> = {
  overdue: 0,
  needs_action: 1,
  due: 2,
  on_time: 3,
  all_done: 4,
  no_tasks: 5,
  not_assigned: 6,
  inactive: 7,
};

function countsFor(rows: CareRow[], now: number): HorseCareCounts {
  const c: HorseCareCounts = { total: rows.length, completed: 0, sent: 0, due: 0, overdue: 0, needsAction: 0, next: null };
  for (const r of rows) {
    if (r.status === 'completed') c.completed++;
    else if (r.evidence === 'needs_action' || r.evidence === 'rejected') c.needsAction++;
    else if (r.status === 'overdue') c.overdue++;
    else if (r.status === 'submitted') c.sent++;
    else if (r.status === 'due' || r.status === 'past_due') c.due++;
    if (!c.next && r.status !== 'completed' && r.status !== 'submitted' && r.dueAt >= now - 15 * 60_000) {
      c.next = { taskType: r.taskType, dueAt: r.dueAt, timezone: r.timezone };
    }
  }
  return c;
}

function statusOf(c: HorseCareCounts | null, careShown: boolean): HorseStatus {
  if (!careShown) return 'not_assigned';
  if (!c || c.total === 0) return 'no_tasks';
  if (c.overdue > 0) return 'overdue';
  if (c.needsAction > 0) return 'needs_action';
  if (c.due > 0) return 'due';
  if (c.completed === c.total) return 'all_done';
  return 'on_time';
}

/**
 * Today's view for the hub's horses. `today` is the hub-local date (YYYY-MM-DD). Horses are kept in the server order
 * (by name) within a status band so the ones needing attention come first.
 */
export function summarizeHorses(
  horses: readonly HubHorse[],
  timeline: CareTimeline,
  queue: readonly QueueItem[],
  now: number,
  today: string,
): HorsesOverview {
  const careShown = timeline.kind === 'ok';
  const todays: ServerCareOccurrence[] = timeline.kind === 'ok' ? timeline.occurrences.filter((o) => o.localDate === today) : [];
  const day = buildCareTimeline(todays, queue, now).find((d) => d.localDate === today);
  const byHorse = new Map<string, CareRow[]>();
  for (const r of day?.rows ?? []) {
    const list = byHorse.get(r.horseId) ?? [];
    list.push(r);
    byHorse.set(r.horseId, list);
  }
  const active: HorseSummary[] = [];
  const inactive: HorseSummary[] = [];
  for (const h of horses) {
    if (!h.active) {
      inactive.push({ horse: h, counts: null, status: 'inactive' });
      continue;
    }
    const rows = byHorse.get(h.horseId);
    const counts = careShown && rows ? countsFor(rows, now) : null;
    active.push({ horse: h, counts, status: statusOf(counts, careShown) });
  }
  const order = horses.map((h) => h.horseId);
  active.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || order.indexOf(a.horse.horseId) - order.indexOf(b.horse.horseId));
  const totals = { overdue: 0, needsAction: 0, due: 0, horsesWithTasks: 0 };
  for (const s of active) {
    if (!s.counts) continue;
    totals.overdue += s.counts.overdue;
    totals.needsAction += s.counts.needsAction;
    totals.due += s.counts.due;
    if (s.counts.total > 0) totals.horsesWithTasks++;
  }
  return { horses: active, inactive, totals, careShown };
}

/** FO-09: this horse's tasks, chronological, grouped by hub-local day. Completed tasks stay visible. */
export function horseCareDays(horseId: string, timeline: CareTimeline, queue: readonly QueueItem[], now: number): CareDay[] {
  if (timeline.kind !== 'ok') return [];
  return buildCareTimeline(
    timeline.occurrences.filter((o) => o.horseId === horseId),
    queue.filter((q) => q.commandType === 'care.submitEvidence'),
    now,
  );
}

/** The occurrence behind FO-10, only when it is in this person's timeline (deep links can't reach other tasks). */
export function findOccurrence(timeline: CareTimeline, occurrenceId: string): ServerCareOccurrence | null {
  if (timeline.kind !== 'ok') return null;
  return timeline.occurrences.find((o) => o.occurrenceId === occurrenceId) ?? null;
}

/** Hub-local YYYY-MM-DD for a timezone; falls back to a fixed +05:30 (all pilot hubs are in India). */
export function localDateIn(at: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const s = `${get('year')}-${get('month')}-${get('day')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  } catch {
    // fall through
  }
  const d = new Date(at + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD ± days (calendar arithmetic on the date only). */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
