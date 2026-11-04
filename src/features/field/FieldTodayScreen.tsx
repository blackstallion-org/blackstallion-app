import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { ExperienceSwitchButton } from '@/features/identity/ExperienceSwitch';
import {
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  PreviewBanner,
  Screen,
  Section,
  StatusMessage,
} from '@/ui/components';
import { space } from '@/ui/tokens';

import type { FieldTodayData } from './types';

export function useFieldToday() {
  const { state, contextKey } = useAuthorizedAccess();
  const { fieldToday } = useRepositories();
  return useScopedResource(`${contextKey}:today`, () =>
    fieldToday.getToday({ subjectId: state.session.subjectId, experience: 'field' }),
  );
}

/** W01 Today — representative layout on synthetic data (G2). */
export function FieldTodayScreen() {
  const { state } = useAuthorizedAccess();
  const today = useFieldToday();
  return (
    <Screen
      edges={['top', 'left', 'right']}
      testID="field-today"
      footer={
        <View style={{ gap: space.xs }}>
          <Button size="field" icon="qr-code-outline" label="Scan QR" disabled accessibilityHint="Scanning is built in a later gate" />
          <AppText variant="caption" tone="muted" align="center">
            Scanning arrives with the session workflow (G4).
          </AppText>
        </View>
      }
    >
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Field Ops
        </AppText>
        <AppText variant="title" header>
          Today
        </AppText>
        <AppText tone="muted">{state.session.displayName}</AppText>
        <ExperienceSwitchButton />
      </View>
      {today.status === 'loading' ? <LoadingState label="Loading today" testID="field-today-loading" /> : null}
      {today.status === 'error' ? (
        <ErrorState message={today.message} onRetry={today.retry} details={today.reference ? `Reference: ${today.reference}` : undefined} />
      ) : null}
      {today.status === 'ready' ? <TodayBody data={today.data} /> : null}
    </Screen>
  );
}

const careTone = { done: 'success', due: 'warning', overdue: 'danger' } as const;
const careLabel = { done: 'Done', due: 'Due', overdue: 'Overdue' } as const;

function TodayBody({ data }: { data: FieldTodayData }) {
  return (
    <>
      {data.source === 'synthetic-preview' ? <PreviewBanner /> : null}
      <View style={styles.meta}>
        <AppText variant="headline">
          {data.hubName} · {data.dateLabel}
        </AppText>
        <Badge label={`${data.roleLabel}`} tone="neutral" />
        {data.pendingSyncCount > 0 ? <Badge label={`Sync ${data.pendingSyncCount}`} tone="info" /> : null}
      </View>
      {data.overdueCareCount > 0 ? (
        <StatusMessage
          tone="warning"
          message={`${data.overdueCareCount} overdue care task${data.overdueCareCount === 1 ? '' : 's'}`}
        />
      ) : null}
      {data.sessions.length > 0 ? (
        <Section title="Sessions">
          <Card>
            {data.sessions.map((s, i) => (
              <ListRow
                key={s.id}
                label={`${s.time} · ${s.title}`}
                value={`${s.cadetCount} cadets`}
                icon="time-outline"
                divider={i < data.sessions.length - 1}
              />
            ))}
          </Card>
        </Section>
      ) : null}
      <Section title="Care">
        <Card>
          {data.care.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" title="No care tasks" message="Nothing is assigned to you today." />
          ) : (
            data.care.map((c, i) => (
              <View
                key={c.id}
                style={[styles.careRow, i > 0 && styles.careGap]}
                accessible
                accessibilityLabel={`${c.time}, ${c.horse}, ${c.task}, ${careLabel[c.state]}`}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">
                    {c.time} · {c.horse}
                  </AppText>
                  <AppText tone="muted">{c.task}</AppText>
                </View>
                <Badge label={careLabel[c.state]} tone={careTone[c.state]} />
              </View>
            ))
          )}
        </Card>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.sm },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  careRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  careGap: { marginTop: space.sm },
});
