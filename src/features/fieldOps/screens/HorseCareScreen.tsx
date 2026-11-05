// FO-09 Horse care detail: identity (no microchip) and this person's tasks for the horse, chronological, grouped by
// hub-local day, completed ones kept visible. Rows open FO-10.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { EmptyState, GlassScreen, ListGroup, Row, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories } from '../data/repositories';
import { addDays, horseCareDays, localDateIn } from '../domain/horses';
import { safeId } from '../domain/review';
import type { FieldOpsScope } from '../domain/types';
import { backOr, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { CARE_TONE, NotConnected, Provenance, ResourceGate, TASK_ICON } from './parts';

const TZ = 'Asia/Kolkata';

export function HorseCareRoute() {
  const params = useLocalSearchParams<{ horseId?: string }>();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field/horses');
  const header = { onBack: back, title: t.t('fo.horse.screenTitle'), backLabel: t.t('fo.common.back') };
  if (!ctx.repos) return <NotConnected t={t} header={header} testID="fo09-horse" />;
  const horseId = safeId(params.horseId);
  if (!horseId) {
    return (
      <GlassScreen header={header} testID="fo09-horse">
        <UnavailableState title={t.t('fo.common.notFoundTitle')} message={t.t('fo.horse.notFound')} testID="fo09-notfound" />
      </GlassScreen>
    );
  }
  return (
    <HorseCareView
      repos={ctx.repos}
      scope={ctx.scope}
      contextKey={ctx.contextKey}
      horseId={horseId}
      t={t}
      onBack={back}
      onOpenTask={(taskId) => router.push({ pathname: '/field/horses/care/[taskId]', params: { taskId } })}
    />
  );
}

export function HorseCareView({
  repos,
  scope,
  contextKey,
  horseId,
  t,
  now = Date.now,
  onBack,
  onOpenTask,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  contextKey: string;
  horseId: string;
  t: Translator;
  now?: () => number;
  onBack: () => void;
  onOpenTask: (occurrenceId: string) => void;
}) {
  const today = localDateIn(now(), TZ);
  const { items: queue } = useOutbox(repos.outbox, { subjectId: scope.subjectId, hubId: scope.hubId });
  const r = useFieldResource(`${contextKey}:fo:horse:${horseId}:${today}`, async () => {
    const [horses, timeline] = await Promise.all([repos.horses.listHorses(scope), repos.care.timeline(scope, addDays(today, -1), addDays(today, 1))]);
    return { horse: horses.find((h) => h.horseId === horseId) ?? null, timeline };
  });
  return (
    <GlassScreen header={{ onBack, title: t.t('fo.horse.screenTitle'), backLabel: t.t('fo.common.back') }} testID="fo09-horse">
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={r} t={t} loadingLabel={t.t('fo.horse.loading')} notFoundMessage={t.t('fo.horse.notFound')} testIDPrefix="fo09">
        {({ horse, timeline }) => {
          if (!horse) return <UnavailableState title={t.t('fo.common.notFoundTitle')} message={t.t('fo.horse.notFound')} testID="fo09-notfound" />;
          const days = horseCareDays(horseId, timeline, queue, now());
          const facts = [
            horse.breed,
            horse.heightHands != null ? t.t('fo.horse.hands', { hands: horse.heightHands }) : null,
            horse.temperament,
          ].filter(Boolean) as string[];
          return (
            <View style={{ gap: space.xl }}>
              <View style={styles.identity} testID="fo09-identity">
                <AppText variant="title" header>
                  {horse.name}
                </AppText>
                {facts.length ? <AppText tone="muted">{facts.join(' · ')}</AppText> : null}
                {!horse.active ? <StatusBadge label={t.t('fo.horses.status.inactive')} tone="neutral" /> : null}
              </View>
              {timeline.kind !== 'ok' ? (
                <StatusNote tone="info" message={t.t('fo.horses.careForAssigned')} testID="fo09-care-note" />
              ) : days.length === 0 ? (
                <EmptyState icon="leaf-outline" title={t.t('fo.horse.emptyTitle')} message={t.t('fo.horse.empty', { horse: horse.name })} testID="fo09-empty" />
              ) : (
                days.map((d) => (
                  <ListGroup
                    key={d.localDate}
                    title={d.localDate === today ? t.t('fo.horse.today', { date: t.date(Date.parse(`${d.localDate}T06:30:00Z`), TZ) }) : t.date(Date.parse(`${d.localDate}T06:30:00Z`), TZ)}
                    testID={`fo09-day-${d.localDate}`}
                  >
                    {d.rows.map((row) => {
                      const time = t.time(row.dueAt, row.timezone);
                      const status = t.t(row.statusLabelKey);
                      const evidence = row.evidenceLabelKey ? t.t(row.evidenceLabelKey) : null;
                      return (
                        <Row
                          key={row.occurrenceId}
                          testID={`fo09-task-${row.occurrenceId}`}
                          emphasis
                          icon={TASK_ICON[row.taskType]}
                          label={`${time} · ${t.t(row.taskLabelKey)}`}
                          value={[evidence, row.isMedication ? t.t('fo.horse.medicationRow') : null].filter(Boolean).join(' · ') || undefined}
                          accessibilityLabel={[time, t.t(row.taskLabelKey), status, evidence].filter(Boolean).join(', ')}
                          onPress={() => onOpenTask(row.occurrenceId)}
                          trailing={<StatusBadge label={status} tone={CARE_TONE[row.status]} />}
                        />
                      );
                    })}
                  </ListGroup>
                ))
              )}
            </View>
          );
        }}
      </ResourceGate>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  identity: { gap: space.sm },
});
