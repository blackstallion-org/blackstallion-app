// FO-17 Hub review queue: open items the server says this person may review at their hub, by segment (care proof,
// shift punch-ins, rank proposals when that policy is on). 42501 → not a reviewer: the screen says so and its entry is
// hidden elsewhere. Decisions happen on FO-18.
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState, GlassScreen, ListGroup, PermissionDeniedState, Row, SegmentedControl, StatusBadge, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories } from '../data/repositories';
import { formatAccuracy } from '../domain/evidence';
import { reviewReasonKey, reviewSegments } from '../domain/review';
import type { FieldOpsScope, ReviewItem, ReviewKind } from '../domain/types';
import { backOr, shown, useFieldOps, useFieldOpsT, useFieldResource } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { Heading, NotConnected, Provenance, ResourceGate } from './parts';

const SEGMENT_PARAM: Record<string, ReviewKind> = { care: 'care_evidence', shift: 'shift_attendance', rank: 'rank_proposal' };

export function ReviewQueueRoute() {
  const params = useLocalSearchParams<{ segment?: string }>();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field');
  if (!ctx.repos) return <NotConnected t={t} header={{ onBack: back, title: t.t('fo.review.title') }} testID="fo17-review" />;
  return (
    <ReviewQueueView
      repos={ctx.repos}
      scope={ctx.scope}
      contextKey={ctx.contextKey}
      t={t}
      initialKind={SEGMENT_PARAM[params.segment ?? ''] ?? 'care_evidence'}
      onBack={back}
      onOpenItem={(it) => router.push({ pathname: '/field/review/[kind]/[itemId]', params: { kind: it.kind, itemId: it.itemId } })}
    />
  );
}

export function ReviewQueueView({
  repos,
  scope,
  contextKey,
  t,
  initialKind = 'care_evidence',
  onBack,
  onOpenItem,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  contextKey: string;
  t: Translator;
  initialKind?: ReviewKind;
  onBack: () => void;
  onOpenItem: (it: ReviewItem) => void;
}) {
  const [kind, setKind] = useState<ReviewKind>(initialKind);
  const q = useFieldResource(`${contextKey}:fo:reviewQueue`, () => repos.review.queue(scope));
  const flags = useFieldResource(`${contextKey}:fo:flags`, () => repos.policy.flags(scope));
  const { retry } = q;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      retry();
    }, [retry]),
  );
  const rankOn = shown(flags)?.data.rankProposals.enabled === true;
  return (
    <GlassScreen header={{ onBack, title: t.t('fo.review.title'), backLabel: t.t('fo.common.back') }} testID="fo17-review">
      <Heading title={t.t('fo.review.heading')} subtitle={t.t('fo.review.subtitle')} />
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={q} t={t} loadingLabel={t.t('fo.review.loading')} deniedMessage={t.t('fo.review.denied')} testIDPrefix="fo17">
        {(queue, meta) => {
          if (queue.kind === 'denied') return <PermissionDeniedState title={t.t('fo.common.deniedTitle')} message={t.t('fo.review.denied')} testID="fo17-denied" />;
          const segs = reviewSegments(queue.items, rankOn);
          const current = segs.find((s) => s.kind === kind) ?? segs[0]!;
          return (
            <View style={{ gap: space.lg }}>
              {meta.stale ? <StatusNote tone="warning" message={t.t('fo.review.offlineDecisions')} testID="fo17-offline" /> : null}
              <SegmentedControl
                label={t.t('fo.review.segmentsLabel')}
                testID="fo17-segments"
                value={current.kind}
                onChange={setKind}
                segments={segs.map((s) => ({ value: s.kind, label: t.t(`fo.review.segment.${s.kind}`, { count: s.items.length }) }))}
              />
              {current.items.length === 0 ? (
                <EmptyState icon="checkmark-done-outline" title={t.t('fo.review.nothing')} message={t.t(`fo.review.empty.${current.kind}`)} testID="fo17-empty" />
              ) : (
                <ListGroup title={t.t(`fo.review.listTitle.${current.kind}`)} testID={`fo17-list-${current.kind}`}>
                  {current.items.map((it) => (
                    <ReviewRow key={`${it.kind}:${it.itemId}`} it={it} t={t} viewerId={scope.subjectId} onPress={() => onOpenItem(it)} />
                  ))}
                </ListGroup>
              )}
            </View>
          );
        }}
      </ResourceGate>
    </GlassScreen>
  );
}

function ReviewRow({ it, t, viewerId, onPress }: { it: ReviewItem; t: Translator; viewerId: string; onPress: () => void }) {
  const who = it.subjectName ?? t.t('fo.review.someone');
  const at = it.receivedAt ? t.time(Date.parse(it.receivedAt), 'Asia/Kolkata') : '—';
  let label: string;
  let value: string;
  if (it.kind === 'care_evidence') {
    label = `${it.horseName ?? '—'} · ${it.taskType ? t.t(`care.taskType.${it.taskType}`) : ''}`;
    value = [who, t.t('fo.review.receivedAt', { time: at })].filter(Boolean).join(' · ');
  } else if (it.kind === 'shift_attendance') {
    label = t.t('fo.review.punchLabel', { name: who });
    value = [t.t('fo.review.receivedAt', { time: at }), formatAccuracy(it.accuracyM), it.distanceM != null ? t.t('fo.shift.meters', { meters: Math.round(it.distanceM) }) : null].filter(Boolean).join(' · ');
  } else {
    label = `${it.cadetName ?? '—'} · ${t.t(`fo.rank.name.${it.fromRank ?? 'none'}`)} → ${t.t(`fo.rank.name.${it.toRank ?? 'none'}`)}`;
    value = t.t('fo.review.proposedBy', { name: who });
  }
  const own = it.subjectUserId === viewerId;
  const reason = it.reasons[0];
  const badge = own ? t.t('fo.review.ownRecord') : reason ? t.t(reviewReasonKey(it.kind, reason).replace('fo.reason.', 'fo.reasonShort.')) : t.t('fo.review.toCheck');
  // overdue/late proof is labelled separately from the reason it needs review
  const late = it.kind === 'care_evidence' && it.late === true;
  return (
    <Row
      testID={`fo17-item-${it.itemId}`}
      emphasis
      icon={it.kind === 'care_evidence' ? 'camera-outline' : it.kind === 'shift_attendance' ? 'time-outline' : 'ribbon-outline'}
      label={label}
      value={value}
      onPress={onPress}
      accessibilityLabel={[label, value, badge, late ? t.t('fo.review.lateBadge') : null].filter(Boolean).join(', ')}
      trailing={
        <View style={styles.badges}>
          <StatusBadge label={badge} tone={own ? 'neutral' : reason && reason !== 'review_all_policy' ? 'warning' : 'info'} />
          {late ? <StatusBadge label={t.t('fo.review.lateBadge')} tone="danger" icon="alarm-outline" /> : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  badges: { alignItems: 'flex-end', gap: space.xs },
});
