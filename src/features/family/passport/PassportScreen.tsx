import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/ui/components';
import { imageLibrary } from '@/ui/imageLibrary';
import { ErrorState, GlassButton, GlassCard, GlassScreen, ListGroup, Pill, Row, StatusBadge, StatusNote } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

import { ChildSwitcher, NoLinkedChild, SyntheticBanner, useBackTo } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import type { FamilyChild, PassportData } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { instantDay, instantStamp, dayLabel } from '../domain/format';
import { projectPassport, ScopeError, type PassportView, type RankTimelineEntry } from '../domain/passport';
import { RANK_LABEL } from '../domain/passportTypes';
import { useFamilyResource } from '../hooks';
import { COMMON, PASSPORT_COPY } from '../strings';

/** Public website origin for "Verify publicly" (the website owns /verify/*; the app must not claim it). */
const WEBSITE = (process.env.EXPO_PUBLIC_WEBSITE_URL ?? '').replace(/\/$/, '');
const verifyUrl = (code: string): string | null => (/^https:\/\/[^\s/]+$/.test(WEBSITE) && /^[A-Z0-9-]{4,40}$/.test(code) ? `${WEBSITE}/verify/${code}` : null);

/**
 * FA-05 Passport & ranks. Everything shown comes from server rows, projected by the ported g6 `projectPassport`:
 * the CURRENT rank is the server's (never recomputed), the timeline is rank_history, skills come from published
 * sessions only, badges from achievements. No promotion threshold or "next rank" progress is invented (D15).
 */
export function PassportScreen() {
  const back = useBackTo('/family/progress');
  const { repos, selected } = useFamily();
  return (
    <GlassScreen header={{ onBack: back, title: PASSPORT_COPY.title }} testID="family-passport">
      <ChildSwitcher />
      {!repos ? <FamilyUnconnected testID="passport" /> : !selected ? <NoLinkedChild testID="passport" /> : <PassportLoader key={selected.id} child={selected} />}
    </GlassScreen>
  );
}

function PassportLoader({ child }: { child: FamilyChild }) {
  const { scope } = useFamily();
  const res = useFamilyResource(['passport', child.id], (r) => r.passport.get(scope, child.id));
  return (
    <ResourceGate resource={res} loadingLabel={PASSPORT_COPY.loading} rows={3} testID="passport">
      {(data) => <PassportBody data={data} child={child} />}
    </ResourceGate>
  );
}

function PassportBody({ data, child }: { data: PassportData; child: FamilyChild }) {
  let view: PassportView;
  try {
    view = projectPassport(data.input);
  } catch (e) {
    // A payload that mixes in another cadet's rows is never displayed.
    if (e instanceof ScopeError) return <ErrorState message="This passport could not be shown." details={COMMON.details('ERR-SCOPE')} testID="passport-scope-error" />;
    throw e;
  }
  return <PassportContent data={data} view={view} child={child} />;
}

function PassportContent({ data, view, child }: { data: PassportData; view: PassportView; child: FamilyChild }) {
  const router = useRouter();
  const { colors } = useTheme();
  const rankLabel = view.currentRank?.label ?? RANK_LABEL.CADET_SQUIRE;
  const verify = data.passportCode ? verifyUrl(data.passportCode) : null;
  return (
    <>
      <SyntheticBanner source={data.source} />
      <GlassCard variant="photo" image={imageLibrary.saddle.source} cutout block="brown" height={200} testID="passport-credential" contentStyle={styles.credential}>
        <View style={styles.credTop}>
          <Pill label={PASSPORT_COPY.credential} icon="shield-outline" material="thick" />
        </View>
        <View style={styles.credBottom}>
          <AppText variant="title" tone="onPhoto" numberOfLines={2}>
            {child.firstName}
          </AppText>
          {data.passportCode ? (
            <View accessible accessibilityLabel={`${PASSPORT_COPY.code} ${data.passportCode.split('').join(' ')}`}>
              <AppText variant="caption" tone="onPhotoMuted">
                {PASSPORT_COPY.code}
              </AppText>
              <AppText variant="bodyStrong" tone="onPhoto" style={styles.code} selectable>
                {data.passportCode}
              </AppText>
            </View>
          ) : null}
          <View style={styles.rankLine} accessible accessibilityLabel={`${PASSPORT_COPY.rank}: ${view.currentRank?.label ?? '—'}. ${PASSPORT_COPY.rankFromServer}`} testID="passport-rank">
            <Icon name="ribbon" size={22} color={colors.onPhoto} />
            <View style={styles.flex}>
              <AppText variant="section" tone="onPhoto">
                {view.currentRank?.label ?? '—'}
              </AppText>
              <AppText variant="caption" tone="onPhotoMuted">
                {PASSPORT_COPY.rankFromServer}
              </AppText>
            </View>
          </View>
        </View>
      </GlassCard>

      <StatusNote tone="info" message={view.rankRuleNote} testID="rank-rule-note" />
      {view.integrityWarning ? <StatusNote tone="warning" message={PASSPORT_COPY.integrity} testID="rank-integrity" /> : null}

      {view.rankTimeline.length === 0 ? (
        <GlassCard testID="rank-timeline-empty">
          <AppText variant="section" header>
            {PASSPORT_COPY.timelineTitle}
          </AppText>
          <AppText tone="muted">{PASSPORT_COPY.timelineEmpty(rankLabel)}</AppText>
        </GlassCard>
      ) : (
        <ListGroup title={PASSPORT_COPY.timelineTitle} testID="rank-timeline">
          {view.rankTimeline.map((e) => (
            <Row key={e.eventId} icon="ribbon-outline" label={e.label} value={[PASSPORT_COPY.awarded(instantDay(e.recordedAt)), e.note].filter(Boolean).join(' · ')} trailing={<TimelineBadge entry={e} />} />
          ))}
        </ListGroup>
      )}

      {view.skills.length === 0 ? (
        <GlassCard>
          <AppText variant="section" header>
            {PASSPORT_COPY.skillsTitle}
          </AppText>
          <AppText tone="muted">{PASSPORT_COPY.skillsEmpty}</AppText>
        </GlassCard>
      ) : (
        <ListGroup title={PASSPORT_COPY.skillsTitle} testID="passport-skills">
          {view.skills.map((s) => (
            <Row
              key={s.code}
              icon="checkmark-circle-outline"
              label={s.label}
              value={PASSPORT_COPY.skillFirst(dayLabel(s.firstAchievedOn))}
              onPress={() => router.push({ pathname: '/family/sessions/[recordId]', params: { recordId: s.evidenceRevisionId } })}
            />
          ))}
        </ListGroup>
      )}

      <ListGroup title={PASSPORT_COPY.badgesTitle} testID="passport-badges">
        {view.badges.length === 0 ? (
          <Row label={PASSPORT_COPY.badgesEmpty} />
        ) : (
          view.badges.map((b) => (
            <Row key={`${b.badgeCode}-${b.awardedAt}`} icon="medal-outline" label={b.label} value={[instantDay(b.awardedAt), b.note].filter(Boolean).join(' · ')} trailing={b.status === 'revoked' ? <StatusBadge label={PASSPORT_COPY.status.revoked} tone="warning" /> : undefined} />
          ))
        )}
      </ListGroup>

      {verify ? (
        <GlassButton variant="secondary" icon="open-outline" label={PASSPORT_COPY.verify} onPress={() => Linking.openURL(verify)} testID="passport-verify" />
      ) : (
        <AppText variant="secondary" tone="muted" testID="passport-verify-note">
          {PASSPORT_COPY.verifyNote}
        </AppText>
      )}
      <AppText variant="caption" tone="muted">
        {PASSPORT_COPY.asOf(instantStamp(view.dataAsOf))}
      </AppText>
    </>
  );
}

function TimelineBadge({ entry }: { entry: RankTimelineEntry }) {
  const tone = entry.status === 'current' ? 'success' : entry.status === 'revoked' ? 'warning' : entry.status === 'corrected' ? 'info' : 'neutral';
  return <StatusBadge label={PASSPORT_COPY.status[entry.status]} tone={tone} icon={entry.status === 'earlier' ? null : undefined} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  credential: { gap: space.md },
  credTop: { flexDirection: 'row' },
  credBottom: { gap: space.md },
  code: { letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
  rankLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
