// FO-08 Horses (tab root): the hub's horses with today's care status, plus the person's shift and, for reviewers,
// the review queue. Sunlight-readable: flat dense rows inside one glass group, status as icon + word.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { EmptyState, GlassInput, GlassScreen, ListGroup, Row, StatusBadge, StatusNote, type StatusTone } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories } from '../data/repositories';
import { pendingPunchIn, punchOutcome } from '../domain/evidence';
import { addDays, localDateIn, summarizeHorses, type HorseStatus, type HorseSummary } from '../domain/horses';
import type { FieldOpsScope, ReviewQueue, ShiftStatus } from '../domain/types';
import { shown, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { Heading, NotConnected, Provenance, ResourceGate } from './parts';

const TZ = 'Asia/Kolkata';
/** A search field appears only when the list is long enough to need one (visual stack: "search if useful"). */
const SEARCH_FROM = 8;
const STATUS: Record<HorseStatus, { key: string; tone: StatusTone }> = {
  overdue: { key: 'fo.horses.status.overdue', tone: 'danger' },
  needs_action: { key: 'fo.horses.status.needsAction', tone: 'warning' },
  due: { key: 'fo.horses.status.due', tone: 'info' },
  on_time: { key: 'fo.horses.status.onTime', tone: 'success' },
  all_done: { key: 'fo.horses.status.allDone', tone: 'success' },
  no_tasks: { key: 'fo.horses.status.noTasks', tone: 'neutral' },
  not_assigned: { key: 'fo.horses.status.notAssigned', tone: 'neutral' },
  inactive: { key: 'fo.horses.status.inactive', tone: 'neutral' },
};

export function HorsesRoute() {
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  if (!ctx.repos) return <NotConnected t={t} testID="fo08-horses" />;
  return (
    <HorsesView
      repos={ctx.repos}
      scope={ctx.scope}
      contextKey={ctx.contextKey}
      canPunch={ctx.capabilities ? ctx.capabilities.punchIn === true : ctx.scope.role !== 'SCHOOL_ADMIN'}
      t={t}
      onOpenHorse={(id) => router.push({ pathname: '/field/horses/[horseId]', params: { horseId: id } })}
      onOpenShift={() => router.push('/field/shift')}
      onOpenReview={() => router.push('/field/review')}
    />
  );
}

export function HorsesView({
  repos,
  scope,
  contextKey,
  canPunch,
  t,
  now = Date.now,
  onOpenHorse,
  onOpenShift,
  onOpenReview,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  contextKey: string;
  canPunch: boolean;
  t: Translator;
  now?: () => number;
  onOpenHorse: (horseId: string) => void;
  onOpenShift: () => void;
  onOpenReview: () => void;
}) {
  const today = localDateIn(now(), TZ);
  const [query, setQuery] = useState('');
  const { items: queue } = useOutbox(repos.outbox, { subjectId: scope.subjectId, hubId: scope.hubId });
  const data = useFieldResource(`${contextKey}:fo:horses:${today}`, async () => {
    const [horses, timeline] = await Promise.all([repos.horses.listHorses(scope), repos.care.timeline(scope, today, addDays(today, 0))]);
    return { horses, timeline };
  });
  // grooms are never reviewers (G9 review_roles); everyone else asks the server, 42501 → the entry stays hidden
  const review = useFieldResource<ReviewQueue | null>(scope.role === 'GROOM' ? null : `${contextKey}:fo:reviewProbe`, () => repos.review.queue(scope));
  const shift = useFieldResource<ShiftStatus | null>(canPunch ? `${contextKey}:fo:shiftProbe` : null, () => repos.shift.status(scope));
  const { retry: retryData } = data;
  const { retry: retryReview } = review;
  const { retry: retryShift } = shift;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      retryData();
      retryReview();
      retryShift();
    }, [retryData, retryReview, retryShift]),
  );

  const reviewData = shown(review)?.data;
  const shiftData = shown(shift)?.data ?? null;
  const pendingPunch = pendingPunchIn(queue);
  const shiftLine = (() => {
    if (pendingPunch) return { value: t.t('fo.horses.shiftPending'), tone: 'info' as StatusTone, badge: t.t('fo.shift.badge.pending') };
    if (!shiftData) return { value: t.t('fo.horses.shiftUnknown'), tone: 'neutral' as StatusTone, badge: null };
    if (!shiftData.open) return { value: t.t('fo.horses.shiftNone'), tone: 'neutral' as StatusTone, badge: null };
    const o = punchOutcome(shiftData.open, shiftData.thresholdM);
    return {
      value: t.t('fo.horses.shiftOpen', { time: t.time(Date.parse(shiftData.open.punchInAt), 'Asia/Kolkata') }),
      tone: (o === 'needs_review' || o === 'review_rejected' ? 'warning' : 'success') as StatusTone,
      badge: t.t(`fo.shift.badge.${o}`),
    };
  })();

  return (
    <GlassScreen edges={['top', 'left', 'right']} testID="fo08-horses">
      <Heading eyebrow={t.t('fo.common.fieldOps')} title={t.t('fo.horses.title')} subtitle={t.date(now(), TZ)} />
      <Provenance source={repos.source} t={t} />
      {canPunch || (reviewData && reviewData.kind === 'ok') ? (
        <ListGroup title={t.t('fo.horses.workGroup')} material="thick">
          {canPunch ? (
            <Row
              testID="fo08-open-shift"
              emphasis
              icon="time-outline"
              label={t.t('fo.shift.title')}
              value={shiftLine.value}
              onPress={onOpenShift}
              trailing={shiftLine.badge ? <StatusBadge label={shiftLine.badge} tone={shiftLine.tone} /> : undefined}
              accessibilityHint={t.t('fo.horses.shiftHint')}
            />
          ) : null}
          {reviewData && reviewData.kind === 'ok' ? (
            <Row
              testID="fo08-open-review"
              emphasis
              icon="shield-checkmark-outline"
              label={t.t('fo.review.title')}
              value={reviewData.items.length === 0 ? t.t('fo.review.nothing') : t.t('fo.horses.reviewOpen', { count: reviewData.items.length })}
              onPress={onOpenReview}
              trailing={reviewData.items.length > 0 ? <StatusBadge label={t.t('fo.horses.reviewBadge', { count: reviewData.items.length })} tone="warning" /> : undefined}
            />
          ) : null}
        </ListGroup>
      ) : null}
      <ResourceGate r={data} t={t} loadingLabel={t.t('fo.horses.loading')} deniedMessage={t.t('fo.horses.denied')} testIDPrefix="fo08">
        {({ horses, timeline }) => {
          const ov = summarizeHorses(horses, timeline, queue, now(), today);
          const q = query.trim().toLowerCase();
          const shownHorses = q ? ov.horses.filter((h) => h.horse.name.toLowerCase().includes(q)) : ov.horses;
          if (horses.length === 0) {
            return <EmptyState icon="leaf-outline" title={t.t('fo.horses.emptyTitle')} message={t.t('fo.horses.empty')} testID="fo08-empty" />;
          }
          const headline =
            !ov.careShown
              ? null
              : ov.totals.overdue + ov.totals.needsAction + ov.totals.due === 0
                ? t.t('fo.horses.summaryOk')
                : [
                    ov.totals.overdue ? t.t('fo.horses.summaryOverdue', { count: ov.totals.overdue }) : null,
                    ov.totals.needsAction ? t.t('fo.horses.summaryAction', { count: ov.totals.needsAction }) : null,
                    ov.totals.due ? t.t('fo.horses.summaryDue', { count: ov.totals.due }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
          return (
            <View style={{ gap: space.lg }}>
              {ov.careShown ? (
                <StatusNote
                  tone={ov.totals.overdue ? 'danger' : ov.totals.needsAction ? 'warning' : ov.totals.due ? 'info' : 'success'}
                  message={headline ?? ''}
                  testID="fo08-summary"
                />
              ) : (
                <StatusNote tone="info" message={t.t('fo.horses.careForAssigned')} testID="fo08-care-note" />
              )}
              {ov.horses.length > SEARCH_FROM ? (
                <GlassInput label={t.t('fo.horses.searchLabel')} value={query} onChangeText={setQuery} placeholder={t.t('fo.horses.searchPlaceholder')} autoCorrect={false} testID="fo08-search" />
              ) : null}
              {shownHorses.length === 0 ? (
                <EmptyState icon="search-outline" title={t.t('fo.horses.searchEmptyTitle')} message={t.t('fo.horses.searchEmpty', { query: query.trim() })} testID="fo08-search-empty" />
              ) : (
                <ListGroup title={t.t('fo.horses.listTitle', { count: ov.horses.length })} testID="fo08-list">
                  {shownHorses.map((h) => (
                    <HorseRow key={h.horse.horseId} s={h} t={t} onPress={() => onOpenHorse(h.horse.horseId)} />
                  ))}
                </ListGroup>
              )}
              {ov.inactive.length > 0 ? (
                <ListGroup title={t.t('fo.horses.inactiveTitle')} material="thin">
                  {ov.inactive.map((h) => (
                    <HorseRow key={h.horse.horseId} s={h} t={t} onPress={() => onOpenHorse(h.horse.horseId)} />
                  ))}
                </ListGroup>
              ) : null}
            </View>
          );
        }}
      </ResourceGate>
    </GlassScreen>
  );
}

function HorseRow({ s, t, onPress }: { s: HorseSummary; t: Translator; onPress: () => void }) {
  const st = STATUS[s.status];
  const c = s.counts;
  const parts: string[] = [];
  if (c && c.total > 0) {
    parts.push(t.t('fo.horses.progress', { done: c.completed, total: c.total }));
    if (c.sent) parts.push(t.t('fo.horses.sent', { count: c.sent }));
    if (c.next) parts.push(t.t('fo.horses.next', { task: t.t(`care.taskType.${c.next.taskType}`), time: t.time(c.next.dueAt, c.next.timezone) }));
  } else {
    parts.push([s.horse.breed, s.horse.temperament].filter(Boolean).join(' · ') || t.t('fo.horses.noDetails'));
  }
  const badge = s.status === 'overdue' && c ? t.t('fo.horses.status.overdueCount', { count: c.overdue }) : t.t(st.key);
  return (
    <Row
      testID={`fo08-horse-${s.horse.horseId}`}
      emphasis
      icon="leaf-outline"
      label={s.horse.name}
      value={parts.join(' · ')}
      onPress={onPress}
      accessibilityLabel={`${s.horse.name}, ${parts.join(', ')}, ${badge}`}
      trailing={s.status === 'not_assigned' ? undefined : <StatusBadge label={badge} tone={st.tone} />}
    />
  );
}
