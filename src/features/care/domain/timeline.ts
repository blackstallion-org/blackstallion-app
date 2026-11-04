// Assigned-staff care timeline: server occurrences + local queue state → rows the Today screen renders.
import type { QueueItem } from '../../sync/domain/types';
import type { CareTaskType, EvidenceDisplayState, ServerCareOccurrence } from './careTypes';

export type CareRowStatus = 'upcoming' | 'due' | 'past_due' | 'overdue' | 'submitted' | 'completed';

export interface CareRow {
  occurrenceId: string;
  horseId: string;
  horseName: string;
  taskType: CareTaskType;
  taskLabelKey: string;
  instructions: string;
  isMedication: boolean;
  dueAt: number;
  timezone: string;
  status: CareRowStatus;
  statusLabelKey: string;
  evidence: EvidenceDisplayState;
  evidenceLabelKey: string | null;
  /** capture is possible; `warnAlreadyCompleted` means the UI must warn first (server will route to review) */
  canCapture: boolean;
  warnAlreadyCompleted: boolean;
}

export interface CareDay {
  localDate: string;
  rows: CareRow[];
}

const DUE_WINDOW_MS = 60 * 60_000; // "Due now" from 60 min before due (display only)
/** Local hint only. The server decides overdue (D20 PROPOSED: due + 15 min); the UI never says "Overdue" by itself. */
const LOCAL_PAST_DUE_MS = 15 * 60_000;

const EVIDENCE_KEY: Record<EvidenceDisplayState, string | null> = {
  none: null,
  captured: 'care.evidence.captured',
  sending: 'care.evidence.sending',
  received: 'care.evidence.received',
  review_required: 'care.evidence.reviewRequired',
  accepted: 'care.evidence.accepted',
  rejected: 'care.evidence.rejected',
  needs_action: 'care.evidence.needsAction',
};

const STATUS_KEY: Record<CareRowStatus, string> = {
  upcoming: 'care.status.upcoming',
  due: 'care.status.due',
  past_due: 'care.status.pastDue',
  overdue: 'care.status.overdue',
  submitted: 'care.status.submitted',
  completed: 'care.status.completed',
};

/** Local queue state for one occurrence → evidence display state. Newest item wins. */
export function localEvidenceState(item: QueueItem | undefined): EvidenceDisplayState {
  if (!item) return 'none';
  switch (item.state) {
    case 'capturing':
    case 'ready':
    case 'retry_wait':
      return 'captured';
    case 'leased':
    case 'uploading':
    case 'submitting':
      return 'sending';
    case 'acknowledged': {
      const rs = item.serverReceipt?.reviewState;
      return rs === 'review_required' ? 'review_required' : 'received';
    }
    case 'discarded':
      return 'none';
    default:
      return 'needs_action';
  }
}

export function deriveEvidence(occ: ServerCareOccurrence, item: QueueItem | undefined): EvidenceDisplayState {
  const local = localEvidenceState(item);
  // unsent or stuck local work is what the person must act on; once acknowledged, the server's view is fresher
  if (local === 'captured' || local === 'sending' || local === 'needs_action') return local;
  if (occ.latestSubmissionState) return occ.latestSubmissionState;
  return local;
}

export function buildCareTimeline(occurrences: readonly ServerCareOccurrence[], queue: readonly QueueItem[], now: number): CareDay[] {
  const latestByOcc = new Map<string, QueueItem>();
  for (const it of queue) {
    if (it.commandType !== 'care.submitEvidence' || it.state === 'discarded') continue;
    const prev = latestByOcc.get(it.aggregateId);
    if (!prev || it.createdAt >= prev.createdAt) latestByOcc.set(it.aggregateId, it);
  }
  const days = new Map<string, CareRow[]>();
  for (const o of [...occurrences].sort((a, b) => a.dueAt - b.dueAt || a.occurrenceId.localeCompare(b.occurrenceId))) {
    if (o.status === 'cancelled') continue;
    const item = latestByOcc.get(o.occurrenceId);
    const evidence = deriveEvidence(o, item);
    let status: CareRowStatus;
    if (o.status === 'completed') status = 'completed';
    else if (o.overdue && (o.status === 'pending' || o.status === 'submitted') && evidence === 'none') status = 'overdue';
    else if (o.status === 'submitted' || evidence !== 'none') status = 'submitted';
    else if (now > o.dueAt + LOCAL_PAST_DUE_MS) status = 'past_due';
    else if (now >= o.dueAt - DUE_WINDOW_MS) status = 'due';
    else status = 'upcoming';
    const pendingLocal = evidence === 'captured' || evidence === 'sending';
    const row: CareRow = {
      occurrenceId: o.occurrenceId,
      horseId: o.horseId,
      horseName: o.horseName,
      taskType: o.taskType,
      taskLabelKey: `care.taskType.${o.taskType}`,
      instructions: o.instructions,
      isMedication: o.taskType === 'medication',
      dueAt: o.dueAt,
      timezone: o.timezone,
      status,
      statusLabelKey: STATUS_KEY[status],
      evidence,
      evidenceLabelKey: EVIDENCE_KEY[evidence],
      canCapture: !pendingLocal,
      warnAlreadyCompleted: o.status === 'completed' || o.status === 'submitted',
    };
    const list = days.get(o.localDate) ?? [];
    list.push(row);
    days.set(o.localDate, list);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([localDate, rows]) => ({ localDate, rows }));
}

/** Client-side hint before submitting; the server makes the real routing decision. */
export function locationHint(location: { accuracyM: number | null } | null, maxAccuracyM = 50): 'ok' | 'weak' | 'missing' {
  if (!location) return 'missing';
  if (location.accuracyM == null || location.accuracyM > maxAccuracyM) return 'weak';
  return 'ok';
}
