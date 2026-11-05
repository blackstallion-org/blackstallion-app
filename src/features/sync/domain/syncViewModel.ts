// Sync screen model (W07): pending work, progress, actionable errors, retry/edit/review/recapture and deliberate discard.
import { ATTENTION_STATES, type QueueItem, type QueueState } from './types';

export type SyncAction = 'retry' | 'edit' | 'review' | 'recapture' | 'discard' | 'sign_in';

export interface SyncRow {
  operationId: string;
  aggregateId: string;
  /** i18n key + params for the item title, e.g. field.sync.careItem {horse, task} */
  titleKey: string;
  titleParams: Record<string, string>;
  state: QueueState;
  messageKey: string;
  messageParams: Record<string, string | number>;
  actions: SyncAction[];
  /** shown when the user picks Discard: the work was never sent and the photo will be deleted */
  discardWarningKey: 'field.sync.discardWarning' | null;
  observedAt: number;
  /** FO-13 details: what it is, how often it was tried, why it has not gone, and the server receipt */
  commandType: QueueItem['commandType'];
  createdAt: number;
  attemptCount: number;
  lastErrorCode: string | null;
  acknowledgedAt: number | null;
  receivedAt: string | null;
  reviewRequired: boolean;
}

export interface SyncSection {
  key: 'needsAction' | 'inProgress' | 'waiting' | 'sent';
  titleKey: string;
  rows: SyncRow[];
}

export interface SyncScreenModel {
  sections: SyncSection[];
  pendingCount: number;
  progress: { done: number; total: number };
  /** other accounts' work on this phone: count only, content never shown */
  otherAccountPending: number;
  orphanFiles: number;
  paused: 'auth_required' | 'offline' | null;
  canSyncNow: boolean;
}

export interface CareLabelResolver {
  (aggregateId: string): { horse: string; taskKey: string } | null;
}

const MESSAGE: Partial<Record<QueueState, string>> = {
  capturing: 'sync.state.ready',
  ready: 'sync.state.ready',
  leased: 'sync.state.sending',
  uploading: 'sync.state.sending',
  submitting: 'sync.state.sending',
  retry_wait: 'sync.state.retryAt',
  needs_attention: 'sync.state.needsAttention',
  needs_edit: 'sync.state.needsEdit',
  needs_review: 'sync.state.needsReview',
  blocked: 'sync.state.blocked',
  needs_recapture: 'sync.state.needsRecapture',
  acknowledged: 'sync.state.acknowledged',
};

export function actionsFor(it: QueueItem): SyncAction[] {
  switch (it.state) {
    case 'retry_wait':
      return it.lastErrorCode === 'auth_required' ? ['sign_in', 'discard'] : ['retry', 'discard'];
    case 'needs_attention':
      return ['retry', 'review', 'discard'];
    case 'needs_edit':
      return ['edit', 'discard'];
    case 'needs_review':
      return ['review', 'discard'];
    case 'blocked':
      // FO-13 acceptance: blocked items offer no Retry. The grant was refused; the item is kept for review or an
      // explicit discard, never resent by a tap that could look like a way around the refusal.
      return ['review', 'discard'];
    case 'needs_recapture':
      return ['recapture', 'discard'];
    case 'ready':
      return ['discard'];
    case 'acknowledged':
      return it.serverReceipt?.reviewState === 'review_required' ? ['review'] : [];
    default:
      return []; // in progress: no destructive action while a worker holds the lease
  }
}

export function buildSyncScreenModel(input: {
  items: readonly QueueItem[];
  now: number;
  formatTime: (at: number) => string;
  label: CareLabelResolver;
  otherAccountPending: number;
  orphanFiles: number;
  online: boolean;
  recentWindowMs?: number;
}): SyncScreenModel {
  const recent = input.recentWindowMs ?? 24 * 3_600_000;
  const rows = input.items
    .filter((it) => it.state !== 'discarded')
    .filter((it) => it.state !== 'acknowledged' || (it.acknowledgedAt ?? 0) >= input.now - recent)
    .map((it): SyncRow => {
      const lbl = input.label(it.aggregateId);
      const authPaused = it.state === 'retry_wait' && it.lastErrorCode === 'auth_required';
      const messageKey = authPaused ? 'sync.state.signIn' : !input.online && it.state === 'retry_wait' ? 'sync.state.offline' : MESSAGE[it.state] ?? 'sync.state.ready';
      const messageParams: Record<string, string | number> = {};
      if (messageKey === 'sync.state.retryAt' && it.nextAttemptAt) messageParams.time = input.formatTime(it.nextAttemptAt);
      if (messageKey === 'sync.state.acknowledged') messageParams.time = input.formatTime(it.acknowledgedAt ?? input.now);
      const actions = actionsFor(it);
      const punch = it.commandType === 'shift.punchIn';
      return {
        operationId: it.operationId,
        aggregateId: it.aggregateId,
        titleKey: punch ? 'sync.item.punchIn' : 'field.sync.careItem',
        titleParams: punch ? { time: input.formatTime(it.observedAt) } : { horse: lbl?.horse ?? '—', task: lbl?.taskKey ?? 'care.timeline.title' },
        state: it.state,
        messageKey,
        messageParams,
        actions,
        discardWarningKey: actions.includes('discard') ? 'field.sync.discardWarning' : null,
        observedAt: it.observedAt,
        commandType: it.commandType,
        createdAt: it.createdAt,
        attemptCount: it.attemptCount,
        lastErrorCode: it.lastErrorCode,
        acknowledgedAt: it.acknowledgedAt,
        receivedAt: typeof it.serverReceipt?.receivedAt === 'string' ? it.serverReceipt.receivedAt : null,
        reviewRequired: it.serverReceipt?.reviewState === 'review_required',
      };
    });
  const by = (pred: (r: SyncRow) => boolean) => rows.filter(pred).sort((a, b) => a.observedAt - b.observedAt);
  const needsAction = by((r) => ATTENTION_STATES.includes(r.state) || r.messageKey === 'sync.state.signIn');
  const inProgress = by((r) => r.state === 'leased' || r.state === 'uploading' || r.state === 'submitting');
  const waiting = by((r) => (r.state === 'ready' || r.state === 'retry_wait' || r.state === 'capturing') && r.messageKey !== 'sync.state.signIn');
  const sent = by((r) => r.state === 'acknowledged').reverse();
  const pendingCount = needsAction.length + inProgress.length + waiting.length;
  const sections: SyncSection[] = [
    { key: 'needsAction', titleKey: 'sync.section.needsAction', rows: needsAction },
    { key: 'inProgress', titleKey: 'sync.section.inProgress', rows: inProgress },
    { key: 'waiting', titleKey: 'sync.section.waiting', rows: waiting },
    { key: 'sent', titleKey: 'sync.section.sent', rows: sent },
  ];
  return {
    sections: sections.filter((s) => s.rows.length > 0),
    pendingCount,
    progress: { done: sent.length, total: sent.length + pendingCount },
    otherAccountPending: input.otherAccountPending,
    orphanFiles: input.orphanFiles,
    paused: needsAction.some((r) => r.messageKey === 'sync.state.signIn') ? 'auth_required' : !input.online ? 'offline' : null,
    canSyncNow: input.online && waiting.length + needsAction.filter((r) => r.actions.includes('retry')).length > 0,
  };
}
