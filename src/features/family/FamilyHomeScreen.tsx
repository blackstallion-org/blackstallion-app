import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { ExperienceSwitchButton } from '@/features/identity/ExperienceSwitch';
import { AppText, Icon } from '@/ui/components';
import { imageLibrary } from '@/ui/imageLibrary';
import {
  Chip,
  EmptyState,
  ErrorState,
  GlassButton,
  GlassCard,
  GlassScreen,
  ListGroup,
  LoadingState,
  Pill,
  Row,
  ScoreTile,
  Skeleton,
  StatusBadge,
  LiquidDisplayText,
  SyntheticDataBanner,
} from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import type { FamilyEvent } from './data/repositories';
import { dateTile, eventWhen } from './domain/format';
import { useFamily } from './FamilyContext';
import { useFamilyResource } from './hooks';
import { HOME_LINKS } from './strings';
import type { FamilyHomeData } from './types';

/** FA-01 copy (EN). Kept here until the shared string catalogue step. */
const HOME_COPY = {
  greeting: (name: string) => `Hello, ${name}`,
  showing: 'Progress for',
  welcome: 'Welcome to the academy',
  childGroup: 'Child',
  latest: 'Latest assessment',
  corrected: 'Corrected',
  noAssessmentsTitle: 'No assessments yet',
  noAssessments: (child: string) => `They appear here after ${child}'s first session.`,
  noChildTitle: 'No linked child yet',
  noChild: 'When your academy links your child to this account, their progress appears here. Contact your academy office if this looks wrong.',
  attendance: (n: number, of: number) => `Attended ${n} of the last ${of} sessions`,
  recent: 'Recent sessions',
  sparkEyebrow: 'Daily Spark',
  sparkTitle: 'Today’s Spark',
  sparkBody: 'A short listen to share before the next ride.',
  sparkAction: 'Listen',
  loading: 'Loading family home',
} as const;

/**
 * FA-01 Family home: editorial hero (family-hero art, child selector), the
 * latest PUBLISHED assessment, and one clear next action. No schedule is shown:
 * no schedule source exists yet (16 §3), so nothing is invented.
 */
export function FamilyHomeScreen() {
  const { state, contextKey } = useAuthorizedAccess();
  const { familyHome } = useRepositories();
  const { selected, select } = useFamily();
  const params = useLocalSearchParams<{ cadet?: string }>();
  // Deep link /family?cadet=<id> (check-in push): honoured only for a linked child; anything else is ignored.
  useEffect(() => {
    if (typeof params.cadet === 'string') select(params.cadet);
  }, [params.cadet, select]);
  const childId = selected?.id;
  const scope = {
    subjectId: state.session.subjectId,
    experience: 'family' as const,
    children: state.session.scope?.children,
    displayName: state.session.displayName,
  };
  const home = useScopedResource(`${contextKey}:home:${childId ?? 'default'}`, () => familyHome.getHome(scope, childId));

  return (
    <GlassScreen edges={['top', 'left', 'right']} testID="family-home">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="overline" tone="muted">
            FAMILY
          </AppText>
          {/* Script greeting (decorative lettering, one accessible header) + the name in the serif. */}
          <LiquidDisplayText text="Hello," role="display" accessibilityLabel={HOME_COPY.greeting(state.session.displayName)} />
          <AppText variant="title" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.greetName}>
            {state.session.displayName}
          </AppText>
        </View>
      </View>
      <ExperienceSwitchButton />
      {home.status === 'loading' ? <HomeSkeleton /> : null}
      {home.status === 'error' ? (
        <GlassCard>
          <ErrorState testID="family-home-error" message={home.message} onRetry={home.retry} details={home.reference ? `Reference: ${home.reference}` : undefined} />
        </GlassCard>
      ) : null}
      {home.status === 'ready' ? <FamilyHomeBody data={home.data} onSelectChild={select} /> : null}
    </GlassScreen>
  );
}

function HomeSkeleton() {
  const { width } = useWindowDimensions();
  return (
    <View style={{ gap: space.lg }} testID="family-home-loading">
      <View style={[styles.heroSkeleton, { height: heroHeight(width) }]}>
        <Skeleton height={heroHeight(width)} />
      </View>
      <LoadingState label={HOME_COPY.loading} rows={1} />
    </View>
  );
}

const heroHeight = (width: number) => Math.round(Math.min(340, Math.max(190, (Math.min(width, 560) - space.screenInset * 2) * 0.66)));

function FamilyHomeBody({ data, onSelectChild }: { data: FamilyHomeData; onSelectChild: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const { spark: legacySpark, familyApp } = useRepositories();
  const spark = familyApp?.spark ?? legacySpark;
  const router = useRouter();
  const latestSessionId = data.latestAssessment?.sessionId;
  const openLatest = useCallback(
    () => latestSessionId ? router.push({ pathname: '/family/sessions/[recordId]', params: { recordId: latestSessionId } }) : router.push('/family/progress'),
    [router, latestSessionId],
  );
  const selected = data.children.find((c) => c.id === data.selectedChildId);
  return (
    <>
      {data.source === 'synthetic-preview' ? <SyntheticDataBanner /> : null}
      <GlassCard variant="photo" image={imageLibrary.familyCourtyard.source} height={heroHeight(width)} testID="family-hero" contentStyle={styles.heroContent}>
        <View style={styles.heroTop}>
          <Pill label={data.hubName} icon="location-outline" material="thick" />
        </View>
        <View style={styles.heroBottom}>
          {selected ? (
            <>
              <AppText variant="secondary" tone="onPhotoMuted">
                {HOME_COPY.showing}
              </AppText>
              <AppText variant="title" tone="onPhoto" numberOfLines={2}>
                {selected.name}
              </AppText>
            </>
          ) : (
            <AppText variant="title" tone="onPhoto">
              {HOME_COPY.welcome}
            </AppText>
          )}
          {selected && data.children.length > 1 ? (
            <View testID="child-switcher" accessibilityRole="radiogroup" accessibilityLabel={HOME_COPY.childGroup} style={styles.chips}>
              {data.children.map((c) => (
                <Chip key={c.id} role="radio" label={c.name} selected={c.id === selected.id} onPress={() => onSelectChild(c.id)} material="thick" testID={`child-switcher-${c.id}`} />
              ))}
            </View>
          ) : null}
        </View>
      </GlassCard>

      {!selected ? (
        <GlassCard>
          <EmptyState testID="family-home-empty" icon="people-outline" title={HOME_COPY.noChildTitle} message={HOME_COPY.noChild} />
        </GlassCard>
      ) : (
        <>
          <GlassCard testID="latest-assessment">
            <View style={styles.rowBetween}>
              <View style={{ gap: 2 }}>
                <AppText variant="secondary" tone="muted" header>
                  {HOME_COPY.latest}
                </AppText>
                {data.latestAssessment ? <AppText variant="section">{data.latestAssessment.dateLabel}</AppText> : null}
              </View>
              {data.latestAssessment?.corrected ? <StatusBadge label={HOME_COPY.corrected} tone="info" icon="create-outline" /> : null}
            </View>
            {data.latestAssessment ? (
              <>
                <View style={styles.scores}>
                  <ScoreTile label="Riding" value={data.latestAssessment.riding} />
                  <ScoreTile label="Ground" value={data.latestAssessment.ground} />
                  <ScoreTile label="Stable" value={data.latestAssessment.stable} />
                </View>
                {data.latestAssessment.skills.length > 0 ? (
                  <View style={styles.chipsWrap}>
                    {data.latestAssessment.skills.map((s) => (
                      <StatusBadge key={s} label={s} tone="success" />
                    ))}
                  </View>
                ) : null}
                <GlassButton
                  variant="secondary"
                  icon="document-text-outline"
                  label={data.latestAssessment.sessionId ? HOME_LINKS.viewSession : HOME_LINKS.allSessions}
                  onPress={openLatest}
                  testID="view-latest-session"
                />
              </>
            ) : (
              <EmptyState testID="assessment-empty" icon="ribbon-outline" title={HOME_COPY.noAssessmentsTitle} message={HOME_COPY.noAssessments(selected.name)} />
            )}
          </GlassCard>

          {spark ? (
            <GlassCard variant="photo" image={imageLibrary.sparkHoof.source} cutout block="copper" height={170} testID="spark-entry">
              <View style={styles.sparkTop}>
                <Pill label={HOME_COPY.sparkEyebrow} icon="sparkles-outline" material="thick" />
              </View>
              <View style={styles.sparkRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="section" tone="onPhoto">
                    {HOME_COPY.sparkTitle}
                  </AppText>
                  <AppText variant="secondary" tone="onPhoto">
                    {HOME_COPY.sparkBody}
                  </AppText>
                </View>
                <GlassButton label={HOME_COPY.sparkAction} icon="headset-outline" fullWidth={false} onPress={() => router.push('/family/spark')} testID="open-spark" />
              </View>
            </GlassCard>
          ) : null}

          <NextEvent />

          {data.recentAttendance.length > 0 ? <Attendance attended={data.recentAttendance} /> : null}

          {familyApp ? (
            <ListGroup title={HOME_LINKS.title} testID="home-links">
              <Row icon="ribbon-outline" label={HOME_LINKS.passport} value={HOME_LINKS.passportHint} onPress={() => router.push('/family/passport')} testID="home-open-passport" />
              <Row icon="shield-checkmark-outline" label={HOME_LINKS.consent} value={HOME_LINKS.consentHint} onPress={() => router.push('/family/consents')} testID="home-open-consents" />
            </ListGroup>
          ) : null}
        </>
      )}
    </>
  );
}

/** The next published event with open replies (real date from the server). Hidden when there is none or it can't load. */
function NextEvent() {
  const router = useRouter();
  const { scope, linked } = useFamily();
  const { colors } = useTheme();
  const res = useFamilyResource(['events'], (r) => r.events.list(scope));
  const [now] = useState(() => Date.now());
  if (res.status !== 'ready' || linked.length === 0) return null;
  const next: FamilyEvent | undefined = res.data.events.find((e) => e.status === 'published' && Date.parse(e.startsAt) > now);
  if (!next) return null;
  const tile = dateTile(next.startsAt);
  const going = next.children.filter((c) => c.status === 'confirmed').map((c) => c.firstName);
  return (
    <GlassCard
      onPress={() => router.push({ pathname: '/family/events/[eventId]', params: { eventId: next.id } })}
      accessibilityLabel={`${HOME_LINKS.nextEvent}: ${next.title}, ${eventWhen(next.startsAt, next.endsAt)}. ${HOME_LINKS.openEvent}`}
      testID="home-next-event"
      contentStyle={styles.eventCard}
    >
      <View style={[styles.eventTile, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
        <AppText variant="caption" tone="accent" style={styles.eyebrow}>
          {tile?.month}
        </AppText>
        <AppText variant="section">{tile?.day}</AppText>
      </View>
      <View style={styles.eventText}>
        <AppText variant="secondary" tone="muted">
          {HOME_LINKS.nextEvent}
        </AppText>
        <AppText variant="bodyStrong">{next.title}</AppText>
        <AppText variant="secondary" tone="muted">
          {eventWhen(next.startsAt, next.endsAt)}
        </AppText>
        {going.length > 0 ? <StatusBadge label={`${going.join(', ')} going`} tone="success" /> : null}
      </View>
    </GlassCard>
  );
}

function Attendance({ attended }: { attended: boolean[] }) {
  const { colors } = useTheme();
  const n = attended.filter(Boolean).length;
  return (
    <GlassCard>
      <AppText variant="secondary" tone="muted" header>
        {HOME_COPY.recent}
      </AppText>
      <View style={styles.dotsRow} accessible accessibilityLabel={HOME_COPY.attendance(n, attended.length)}>
        <View style={styles.dots}>
          {attended.map((a, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: a ? colors.accent : 'transparent', borderColor: a ? colors.accent : colors.borderStrong }]}>
              {a ? <Icon name="checkmark" size={14} color={colors.onPrimary} /> : null}
            </View>
          ))}
        </View>
        <AppText variant="secondary" tone="muted" style={{ flex: 1 }}>
          {HOME_COPY.attendance(n, attended.length)}
        </AppText>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  headerText: { flex: 1, gap: 2 },
  eyebrow: { fontWeight: '600' },
  heroSkeleton: { borderRadius: radius.hero, overflow: 'hidden' },
  heroContent: { gap: space.md },
  greetName: { marginTop: -space.sm },
  heroTop: { flexDirection: 'row' },
  heroBottom: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: space.sm },
  scores: { flexDirection: 'row', gap: space.lg },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sparkTop: { flexDirection: 'row', flex: 1 },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  dots: { flexDirection: 'row', gap: space.sm },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  eventCard: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  eventTile: { width: 56, borderRadius: radius.control, borderWidth: 1, alignItems: 'center', paddingVertical: space.sm },
  eventText: { flex: 1, gap: 2 },
});
