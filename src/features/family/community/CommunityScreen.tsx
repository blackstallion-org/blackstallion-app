import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { imageLibrary } from '@/ui/imageLibrary';
import { EmptyState, GlassCard, GlassScreen, ListGroup, Pill, Row, StatusBadge } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, space } from '@/ui/tokens';

import { FamilyTitle, NoLinkedChild, SyntheticBanner } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import type { EventList, FamilyEvent } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { dateTile, eventWhen, instantDay, timeRange } from '../domain/format';
import { useFamilyResource } from '../hooks';
import { COMMUNITY_COPY } from '../strings';

/** FA-09 Community (tab root): the academy's published events for the family's hubs, with real dates. */
export function CommunityScreen() {
  const { repos, linked } = useFamily();
  return (
    <GlassScreen edges={['top', 'left', 'right']} testID="family-community">
      <FamilyTitle title={COMMUNITY_COPY.title} />
      {!repos ? <FamilyUnconnected testID="community" /> : linked.length === 0 ? <NoLinkedChild testID="community" /> : <CommunityLoader />}
    </GlassScreen>
  );
}

function CommunityLoader() {
  const { scope } = useFamily();
  const res = useFamilyResource(['events'], (r) => r.events.list(scope));
  return (
    <>
      <GlassCard variant="photo" image={imageLibrary.communityArena.source} block="fir" height={212} radius={radius.hero - 4} testID="community-hero" contentStyle={styles.heroContent}>
        <View style={styles.row}>
          <Pill label={COMMUNITY_COPY.heroPill} icon="calendar-outline" material="thick" />
        </View>
        <AppText variant="section" tone="onPhoto">
          {COMMUNITY_COPY.heroTitle}
        </AppText>
      </GlassCard>
      <AppText variant="secondary" tone="muted">
        {COMMUNITY_COPY.heroBody}
      </AppText>
      <ResourceGate resource={res} loadingLabel={COMMUNITY_COPY.loading} rows={2} testID="community">
        {(data) => <Feed data={data} />}
      </ResourceGate>
    </>
  );
}

function Feed({ data }: { data: EventList }) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const upcoming = data.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) >= now);
  const past = data.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) < now).reverse();
  const open = (e: FamilyEvent) => router.push({ pathname: '/family/events/[eventId]', params: { eventId: e.id } });
  if (data.events.length === 0) {
    return (
      <>
        <SyntheticBanner source={data.source} />
        <GlassCard>
          <EmptyState testID="community-empty" icon="calendar-clear-outline" title={COMMUNITY_COPY.emptyTitle} message={COMMUNITY_COPY.empty} />
        </GlassCard>
      </>
    );
  }
  return (
    <>
      <SyntheticBanner source={data.source} />
      {upcoming.length > 0 ? (
        <View style={styles.section} testID="events-upcoming">
          <AppText variant="secondary" tone="muted" header style={styles.sectionTitle}>
            {COMMUNITY_COPY.upcoming}
          </AppText>
          {upcoming.map((e) => (
            <EventCard key={e.id} event={e} onPress={() => open(e)} />
          ))}
        </View>
      ) : null}
      {past.length > 0 ? (
        <ListGroup title={COMMUNITY_COPY.past} testID="events-past">
          {past.map((e) => (
            <Row key={e.id} icon="time-outline" label={e.title} value={instantDay(e.startsAt)} onPress={() => open(e)} testID={`event-row-${e.id}`} />
          ))}
        </ListGroup>
      ) : null}
    </>
  );
}

function statusOf(e: FamilyEvent): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }[] {
  if (e.status === 'cancelled') return [{ label: COMMUNITY_COPY.cancelled, tone: 'danger' }];
  const out: { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }[] = e.children
    .filter((c) => c.status === 'confirmed')
    .map((c) => ({ label: COMMUNITY_COPY.going(c.firstName), tone: 'success' }));
  if (e.seatsLeft <= 0) out.push({ label: COMMUNITY_COPY.full, tone: 'warning' });
  else if (e.rsvpOpen) out.push({ label: COMMUNITY_COPY.placesLeft(e.seatsLeft), tone: 'neutral' });
  else out.push({ label: COMMUNITY_COPY.closed, tone: 'neutral' });
  return out;
}

function EventCard({ event, onPress }: { event: FamilyEvent; onPress: () => void }) {
  const { colors } = useTheme();
  const tile = dateTile(event.startsAt);
  const badges = statusOf(event);
  return (
    <GlassCard onPress={onPress} accessibilityLabel={[event.title, eventWhen(event.startsAt, event.endsAt), event.venue, ...badges.map((b) => b.label)].join(', ')} testID={`event-card-${event.id}`} contentStyle={styles.card}>
      <View style={[styles.tile, { backgroundColor: rgba(colors.accent, 0.14), borderColor: rgba(colors.accent, 0.35) }]}>
        <AppText variant="caption" tone="accent" style={styles.strong}>
          {tile?.month}
        </AppText>
        <AppText variant="section" style={styles.tabular}>
          {tile?.day}
        </AppText>
        <AppText variant="caption" tone="muted">
          {tile?.weekday}
        </AppText>
      </View>
      <View style={styles.cardText}>
        <AppText variant="bodyStrong" style={event.status === 'cancelled' ? styles.struck : undefined}>
          {event.title}
        </AppText>
        <AppText variant="secondary" tone="muted">
          {timeRange(event.startsAt, event.endsAt)} · {event.venue}
        </AppText>
        <View style={styles.badges}>
          {badges.map((b) => (
            <StatusBadge key={b.label} label={b.label} tone={b.tone} icon={b.tone === 'neutral' ? null : undefined} />
          ))}
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  heroContent: { gap: space.md },
  section: { gap: space.md },
  sectionTitle: { paddingHorizontal: space.xs },
  card: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  tile: { width: 64, borderRadius: radius.control, borderWidth: 1, alignItems: 'center', paddingVertical: space.sm },
  cardText: { flex: 1, gap: space.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  strong: { fontWeight: '700' },
  tabular: { fontVariant: ['tabular-nums'] },
  struck: { textDecorationLine: 'line-through' },
});
