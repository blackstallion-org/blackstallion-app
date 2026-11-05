import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { GlassButton, GlassCard, GlassScreen, ListGroup, Row, ScoreTile, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { SyntheticBanner, useBackTo } from '../components/FamilyChrome';
import { PrivateClip } from '../components/PrivateClip';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import type { SessionDetail } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { dayLabel, instantDay } from '../domain/format';
import { routeId } from '../domain/progress';
import { useFamilyResource, useSessionVideoConsent } from '../hooks';
import { CLIP_COPY, SCORE_LABEL, SESSION_COPY } from '../strings';

/**
 * FA-03 Session detail (`/family/sessions/[recordId]`). The record id comes from a link, so it is untrusted: a
 * malformed id is "not available" without a request; a well-formed id is read under RLS and shown only when it belongs
 * to a child in the access snapshot and is published. Another family's record looks exactly like a missing one.
 */
export function SessionDetailScreen() {
  const params = useLocalSearchParams<{ recordId?: string }>();
  const recordId = routeId(params.recordId);
  const back = useBackTo('/family/progress');
  const { repos } = useFamily();
  return (
    <GlassScreen header={{ onBack: back, title: SESSION_COPY.title }} testID="family-session">
      {!repos ? <FamilyUnconnected testID="session" /> : recordId ? <SessionLoader recordId={recordId} /> : <SessionNotFound />}
    </GlassScreen>
  );
}

function SessionLoader({ recordId }: { recordId: string }) {
  const { scope } = useFamily();
  const res = useFamilyResource(['session', recordId], (r) => r.sessions.get(scope, recordId));
  return (
    <ResourceGate resource={res} loadingLabel={SESSION_COPY.loading} rows={3} notFound={<SessionNotFound />} testID="session">
      {(d) => <SessionBody d={d} />}
    </ResourceGate>
  );
}

function SessionNotFound() {
  const router = useRouter();
  return (
    <GlassCard>
      <UnavailableState title={SESSION_COPY.notFoundTitle} message={SESSION_COPY.notFound} testID="session-not-found" />
      <GlassButton variant="secondary" label={SESSION_COPY.toProgress} icon="trending-up-outline" onPress={() => router.replace('/family/progress')} />
    </GlassCard>
  );
}

function SessionBody({ d }: { d: SessionDetail }) {
  const router = useRouter();
  const { linked } = useFamily();
  const child = linked.find((c) => c.id === d.childId);
  const consent = useSessionVideoConsent(d.clip ? d.childId : null);
  const latest = d.corrections[0];
  return (
    <>
      <SyntheticBanner source={d.source} />
      <View style={styles.head}>
        <AppText variant="secondary" tone="accent" style={styles.strong}>
          {child?.firstName}
        </AppText>
        <AppText variant="title" header testID="session-date">
          {dayLabel(d.date)}
        </AppText>
      </View>

      {d.version > 1 ? (
        <StatusNote
          tone="info"
          title={SESSION_COPY.correctedTitle}
          message={latest ? SESSION_COPY.corrected(instantDay(latest.at), latest.reason) : SESSION_COPY.correctedNoDate}
          testID="correction-notice"
        />
      ) : null}

      <GlassCard testID="session-scores">
        <View style={styles.cardHead}>
          <AppText variant="section" header>
            {SESSION_COPY.scoresTitle}
          </AppText>
          <AppText variant="secondary" tone="muted">
            {SESSION_COPY.scoresMeta}
          </AppText>
        </View>
        <View style={styles.scores}>
          <ScoreTile label={SCORE_LABEL.riding} value={d.scores.riding} />
          <ScoreTile label={SCORE_LABEL.ground} value={d.scores.ground} />
          <ScoreTile label={SCORE_LABEL.stable} value={d.scores.stable} />
        </View>
      </GlassCard>

      <GlassCard testID="session-skills">
        <AppText variant="section" header>
          {SESSION_COPY.skillsTitle}
        </AppText>
        {d.skills.length > 0 ? (
          <View style={styles.chips}>
            {d.skills.map((s) => (
              <StatusBadge key={s.id} label={s.name} tone="success" />
            ))}
          </View>
        ) : (
          <AppText tone="muted">{SESSION_COPY.noSkills}</AppText>
        )}
      </GlassCard>

      <GlassCard testID="session-notes">
        <AppText variant="section" header>
          {SESSION_COPY.notesTitle}
        </AppText>
        <AppText tone={d.notes ? 'default' : 'muted'}>{d.notes ?? SESSION_COPY.noNotes}</AppText>
      </GlassCard>

      <View style={styles.clip} testID="session-clip">
        <AppText variant="section" header>
          {SESSION_COPY.clipTitle}
        </AppText>
        <PrivateClip clip={d.clip} childName={child?.firstName ?? ''} consent={consent} heading={CLIP_COPY.play} />
      </View>

      {d.clip && consent.status === 'ready' && consent.allowed ? (
        <ListGroup>
          <Row icon="git-compare-outline" label={SESSION_COPY.compare} onPress={() => router.push({ pathname: '/family/compare', params: { recent: d.id } })} testID="session-compare" />
        </ListGroup>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  strong: { fontWeight: '600' },
  cardHead: { gap: space.xs },
  scores: { flexDirection: 'row', gap: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  clip: { gap: space.sm },
});
