import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { ExperienceSwitchButton } from '@/features/identity/ExperienceSwitch';
import {
  AppText,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  OptionGroup,
  PreviewBanner,
  Screen,
  Section,
} from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

import type { FamilyHomeData } from './types';

/** F01 Family home — representative layout on synthetic data (G2). */
export function FamilyHomeScreen() {
  const { state, contextKey } = useAuthorizedAccess();
  const { familyHome } = useRepositories();
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const scope = {
    subjectId: state.session.subjectId,
    experience: 'family' as const,
    children: state.session.scope?.children,
    displayName: state.session.displayName,
  };
  const home = useScopedResource(`${contextKey}:home:${childId ?? 'default'}`, () => familyHome.getHome(scope, childId));

  return (
    <Screen edges={['top', 'left', 'right']} testID="family-home">
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Family
        </AppText>
        <AppText variant="title" header>
          Hello, {state.session.displayName}
        </AppText>
        <ExperienceSwitchButton />
      </View>
      {home.status === 'loading' ? <LoadingState label="Loading family home" testID="family-home-loading" /> : null}
      {home.status === 'error' ? (
        <ErrorState
          testID="family-home-error"
          message={home.message}
          onRetry={home.retry}
          details={home.reference ? `Reference: ${home.reference}` : undefined}
        />
      ) : null}
      {home.status === 'ready' ? <FamilyHomeBody data={home.data} onSelectChild={setChildId} /> : null}
    </Screen>
  );
}

function FamilyHomeBody({ data, onSelectChild }: { data: FamilyHomeData; onSelectChild: (id: string) => void }) {
  const { colors } = useTheme();
  const selected = data.children.find((c) => c.id === data.selectedChildId);
  return (
    <>
      {data.source === 'synthetic-preview' ? <PreviewBanner /> : null}
      <AppText tone="muted">{data.hubName}</AppText>
      {!selected ? (
        <Card>
          <EmptyState
            testID="family-home-empty"
            icon="people-outline"
            title="No linked child yet"
            message="When your academy links your child to this account, their progress appears here. Contact your academy office if this looks wrong."
          />
        </Card>
      ) : (
        <>
          {data.children.length > 1 ? (
            <OptionGroup
              testID="child-switcher"
              label="Child"
              options={data.children.map((c) => ({ value: c.id, label: c.name }))}
              value={selected.id}
              onChange={onSelectChild}
            />
          ) : null}
          <Section title="Next session">
            <Card testID="next-session">
              {data.nextSession ? (
                <>
                  <AppText variant="headline">{data.nextSession.label}</AppText>
                  <AppText tone="muted">{data.nextSession.detail}</AppText>
                </>
              ) : (
                <AppText tone="muted">No session scheduled.</AppText>
              )}
            </Card>
          </Section>
          <Section title="Latest assessment">
            <Card testID="latest-assessment">
              {data.latestAssessment ? (
                <>
                  <View style={styles.rowBetween}>
                    <AppText variant="label">{data.latestAssessment.dateLabel}</AppText>
                    {data.latestAssessment.corrected ? <Badge label="Corrected" tone="info" /> : null}
                  </View>
                  <View style={styles.scores}>
                    <Score label="Riding" value={data.latestAssessment.riding} />
                    <Score label="Ground" value={data.latestAssessment.ground} />
                    <Score label="Stable" value={data.latestAssessment.stable} />
                  </View>
                  <View style={styles.chips}>
                    {data.latestAssessment.skills.map((s) => (
                      <Badge key={s} label={`✓ ${s}`} tone="success" />
                    ))}
                  </View>
                </>
              ) : (
                <EmptyState
                  testID="assessment-empty"
                  icon="ribbon-outline"
                  title="No assessments yet"
                  message={`They appear here after ${selected.name}'s first session.`}
                />
              )}
            </Card>
          </Section>
          {data.recentAttendance.length > 0 ? (
            <Section title="Recent sessions">
              <Card>
                <View
                  style={styles.dots}
                  accessible
                  accessibilityLabel={`Attended ${data.recentAttendance.filter(Boolean).length} of the last ${data.recentAttendance.length} sessions`}
                >
                  {data.recentAttendance.map((attended, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        { backgroundColor: attended ? colors.ink : 'transparent', borderColor: colors.borderStrong },
                      ]}
                    />
                  ))}
                </View>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.score} accessible accessibilityLabel={`${label} ${value} out of 10`}>
      <AppText variant="display">{value}</AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  score: { minWidth: 64, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dots: { flexDirection: 'row', gap: space.md },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
});
