// FO-01 Today, role sections owned by Field Ops: the person's shift (FO-11), the hub review queue for reviewers (FO-17),
// work waiting on this phone (FO-12) and today's care tasks (FO-10). Every figure comes from the same repositories the
// Horses/Shift/Sync screens use; nothing here is a fixture-only number. The server decides who sees what: a 42501 on the
// review queue hides that row, and care is listed only for staff assigned to horses.
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { View } from 'react-native';

import { GlassButton, ListGroup, LoadingState, Row, StatusBadge, StatusNote, type StatusTone } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { buildCareTimeline } from '../../care/domain/timeline';
import type { FieldOpsRepositories } from '../data/repositories';
import { pendingPunchIn, punchOutcome } from '../domain/evidence';
import { localDateIn } from '../domain/horses';
import type { CareTimeline, FieldOpsScope, ReviewQueue, ShiftStatus } from '../domain/types';
import { shown, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { CARE_TONE, TASK_ICON } from './parts';

const TZ = 'Asia/Kolkata';
/** Today shows the next few tasks; the Horses tab has the full day. */
const CARE_ROWS = 5;
const DONE_STATES = new Set(['acknowledged', 'discarded']);

export type TodayWorkProps = {
  /** UX only (capability punchIn); the server refuses punch-ins for other roles. */
  canPunch: boolean;
  onOpenShift: () => void;
  onOpenReview: () => void;
  onOpenSync: () => void;
  onOpenTask: (occurrenceId: string) => void;
  onOpenHorses: () => void;
  now?: () => number;
};

export function TodayWork(props: TodayWorkProps) {
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  if (!ctx.repos) return null;
  return <TodayWorkView {...props} repos={ctx.repos} scope={ctx.scope} contextKey={ctx.contextKey} t={t} />;
}

export function TodayWorkView({
  repos,
  scope,
  contextKey,
  t,
  canPunch,
  onOpenShift,
  onOpenReview,
  onOpenSync,
  onOpenTask,
  onOpenHorses,
  now = Date.now,
}: TodayWorkProps & { repos: FieldOpsRepositories; scope: FieldOpsScope; contextKey: string; t: Translator }) {
  const today = localDateIn(now(), TZ);
  const { items: queue } = useOutbox(repos.outbox, { subjectId: scope.subjectId, hubId: scope.hubId });
  const care = useFieldResource<CareTimeline>(`${contextKey}:fo:today-care:${today}`, () => repos.care.timeline(scope, today, today));
  // grooms are never reviewers (G9 review_roles); everyone else asks the server, 42501 → the row stays hidden
  const review = useFieldResource<ReviewQueue | null>(scope.role === 'GROOM' ? null : `${contextKey}:fo:reviewProbe`, () => repos.review.queue(scope));
  const shift = useFieldResource<ShiftStatus | null>(canPunch ? `${contextKey}:fo:shiftProbe` : null, () => repos.shift.status(scope));

  const { retry: retryCare } = care;
  const { retry: retryReview } = review;
  const { retry: retryShift } = shift;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      retryCare();
      retryReview();
      retryShift();
    }, [retryCare, retryReview, retryShift]),
  );

  const pending = queue.filter((q) => !DONE_STATES.has(q.state)).length;
  const reviewData = shown(review)?.data;
  const shiftData = shown(shift)?.data ?? null;
  const pendingPunch = pendingPunchIn(queue);
  const shiftLine = (() => {
    if (pendingPunch) return { value: t.t('fo.horses.shiftPending'), tone: 'info' as StatusTone, badge: t.t('fo.shift.badge.pending') };
    if (!shiftData) return { value: t.t('fo.horses.shiftUnknown'), tone: 'neutral' as StatusTone, badge: null };
    if (!shiftData.open) return { value: t.t('fo.horses.shiftNone'), tone: 'neutral' as StatusTone, badge: null };
    const o = punchOutcome(shiftData.open, shiftData.thresholdM);
    return {
      value: t.t('fo.horses.shiftOpen', { time: t.time(Date.parse(shiftData.open.punchInAt), TZ) }),
      tone: (o === 'needs_review' || o === 'review_rejected' ? 'warning' : 'success') as StatusTone,
      badge: t.t(`fo.shift.badge.${o}`),
    };
  })();
  const showReview = !!reviewData && reviewData.kind === 'ok';

  const careShown = shown(care);
  const rows =
    careShown && careShown.data.kind === 'ok'
      ? (buildCareTimeline(
          careShown.data.occurrences.filter((o) => o.localDate === today),
          queue,
          now(),
        ).find((d) => d.localDate === today)?.rows ?? [])
      : [];
  const overdue = rows.filter((r) => r.status === 'overdue').length;
  // attention first (overdue, past due, due), then by time; completed last
  const RANK: Record<string, number> = { overdue: 0, past_due: 1, due: 2, upcoming: 3, submitted: 4, completed: 5 };
  const ordered = [...rows].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.dueAt - b.dueAt);

  return (
    <View style={{ gap: space.lg }} testID="today-work">
      {canPunch || showReview || pending > 0 ? (
        <ListGroup title={t.t('fo.today.workTitle')} testID="today-work-group">
          {canPunch ? (
            <Row
              testID="today-open-shift"
              emphasis
              icon="time-outline"
              label={t.t('fo.shift.title')}
              value={shiftLine.value}
              onPress={onOpenShift}
              accessibilityHint={t.t('fo.horses.shiftHint')}
              trailing={shiftLine.badge ? <StatusBadge label={shiftLine.badge} tone={shiftLine.tone} /> : undefined}
            />
          ) : null}
          {showReview && reviewData.kind === 'ok' ? (
            <Row
              testID="today-open-review"
              emphasis
              icon="shield-checkmark-outline"
              label={t.t('fo.review.title')}
              value={reviewData.items.length === 0 ? t.t('fo.review.nothing') : t.t('fo.horses.reviewOpen', { count: reviewData.items.length })}
              onPress={onOpenReview}
              accessibilityHint={t.t('fo.today.reviewHint')}
              trailing={reviewData.items.length > 0 ? <StatusBadge label={t.t('fo.horses.reviewBadge', { count: reviewData.items.length })} tone="warning" /> : undefined}
            />
          ) : null}
          {pending > 0 ? (
            <Row
              testID="today-open-sync"
              emphasis
              icon="cloud-upload-outline"
              label={t.t('fo.today.syncTitle')}
              value={t.t('fo.today.syncValue', { count: pending })}
              onPress={onOpenSync}
              accessibilityHint={t.t('fo.today.syncHint')}
            />
          ) : null}
        </ListGroup>
      ) : null}

      {care.status === 'loading' ? (
        <LoadingState label={t.t('fo.today.loadingCare')} rows={1} />
      ) : !careShown ? (
        care.status === 'error' && care.kind === 'forbidden' ? null : (
          <View style={{ gap: space.sm }}>
            <StatusNote tone="warning" message={t.t('fo.today.careFailed')} testID="today-care-error" />
            <GlassButton variant="secondary" icon="refresh" label={t.t('fo.today.retry')} onPress={retryCare} testID="today-care-retry" />
          </View>
        )
      ) : careShown.data.kind === 'not_assigned_staff' ? null : (
        <View style={{ gap: space.sm }}>
          {careShown.stale ? <StatusNote tone="info" message={t.t('fo.common.staleSince', { time: t.time(careShown.at, TZ) })} testID="today-care-stale" /> : null}
          {overdue > 0 ? <StatusNote tone="danger" message={t.t('fo.today.careOverdue', { count: overdue })} testID="today-overdue" /> : null}
          <ListGroup title={t.t('fo.today.careTitle')} testID="today-care">
            {ordered.length === 0 ? (
              <Row icon="checkmark-done-outline" label={t.t('fo.today.careNone')} testID="today-care-none" />
            ) : (
              ordered.slice(0, CARE_ROWS).map((row) => {
                const time = t.time(row.dueAt, row.timezone);
                const status = t.t(row.statusLabelKey);
                return (
                  <Row
                    key={row.occurrenceId}
                    testID={`today-care-${row.occurrenceId}`}
                    emphasis
                    icon={TASK_ICON[row.taskType]}
                    label={`${time} · ${row.horseName}`}
                    value={t.t(row.taskLabelKey)}
                    accessibilityLabel={[time, row.horseName, t.t(row.taskLabelKey), status].join(', ')}
                    onPress={() => onOpenTask(row.occurrenceId)}
                    trailing={<StatusBadge label={status} tone={CARE_TONE[row.status]} />}
                  />
                );
              })
            )}
            <Row icon="leaf-outline" label={t.t('fo.today.careMore')} onPress={onOpenHorses} testID="today-care-more" />
          </ListGroup>
        </View>
      )}
    </View>
  );
}
