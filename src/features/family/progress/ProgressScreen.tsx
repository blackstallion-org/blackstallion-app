import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/ui/components';
import { imageLibrary } from '@/ui/imageLibrary';
import { EmptyState, GlassButton, GlassCard, GlassScreen, ListGroup, Pill, Row, SegmentedControl, StatusBadge, StatusNote } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, space } from '@/ui/tokens';

import { ChildSwitcher, FamilyTitle, NoLinkedChild, SyntheticBanner } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import { ScoreTrendChart } from '../components/ScoreTrendChart';
import type { FamilyChild, ProgressData, SessionSummary } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { dayLabel } from '../domain/format';
import { asRank } from '../domain/passportLive';
import { RANK_LABEL } from '../domain/passportTypes';
import { useFamilyResource, useSessionVideoConsent } from '../hooks';
import { CLIP_COPY, PROGRESS_COPY } from '../strings';

type View_ = 'sessions' | 'clips';

/**
 * FA-02 Progress (tab root) with the FA-04 Hall of Valour as its in-screen "Clips" view (`?view=clips`).
 * Published sessions only, current revisions only; keyset pages so a newly published session never shifts the list.
 */
export function ProgressScreen() {
  const { repos, selected, linked } = useFamily();
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const view: View_ = params.view === 'clips' ? 'clips' : 'sessions';
  const setView = useCallback((v: View_) => router.setParams({ view: v === 'clips' ? 'clips' : undefined }), [router]);
  return (
    <GlassScreen edges={['top', 'left', 'right']} testID="family-progress">
      {/* With several children the chips name the child; with one, the eyebrow does. */}
      <FamilyTitle eyebrow={linked.length === 1 ? selected?.firstName : undefined} title={PROGRESS_COPY.title} />
      <ChildSwitcher />
      {!repos ? (
        <FamilyUnconnected testID="progress" />
      ) : !selected ? (
        <NoLinkedChild testID="progress" />
      ) : (
        <>
          <SegmentedControl
            label={PROGRESS_COPY.views}
            segments={[
              { value: 'sessions', label: PROGRESS_COPY.sessions },
              { value: 'clips', label: PROGRESS_COPY.clips },
            ]}
            value={view}
            onChange={setView}
            testID="progress-view"
          />
          {view === 'sessions' ? <SessionsView key={selected.id} child={selected} /> : <ClipsView key={selected.id} child={selected} />}
        </>
      )}
    </GlassScreen>
  );
}

function SessionsView({ child }: { child: FamilyChild }) {
  const { scope } = useFamily();
  const res = useFamilyResource(['progress', child.id], (r) => r.progress.get(scope, child.id));
  return (
    <ResourceGate resource={res} loadingLabel={PROGRESS_COPY.loading} rows={3} testID="progress">
      {(data) => <SessionsBody data={data} child={child} />}
    </ResourceGate>
  );
}

function SessionsBody({ data, child }: { data: ProgressData; child: FamilyChild }) {
  const router = useRouter();
  const { repos, scope } = useFamily();
  const [older, setOlder] = useState<{ sessions: SessionSummary[]; cursor: string | null; error: string | null }>({ sessions: [], cursor: data.nextCursor, error: null });
  const all = [...data.sessions, ...older.sessions];
  const loadOlder = async () => {
    if (!repos || !older.cursor) return;
    try {
      const page = await repos.progress.older(scope, child.id, older.cursor);
      setOlder((o) => ({ sessions: [...o.sessions, ...page.sessions.filter((s) => !all.some((x) => x.id === s.id))], cursor: page.nextCursor, error: null }));
    } catch (e) {
      setOlder((o) => ({ ...o, error: e instanceof Error ? e.message : PROGRESS_COPY.loading }));
    }
  };
  const rank = asRank(data.currentRank);
  return (
    <>
      <SyntheticBanner source={data.source} />
      <GlassCard
        variant="photo"
        image={imageLibrary.groundwork.source}
        height={168}
        radius={radius.hero - 4}
        onPress={() => router.push('/family/passport')}
        accessibilityLabel={`${PROGRESS_COPY.rankLabel}: ${rank ? RANK_LABEL[rank] : PROGRESS_COPY.rankUnknown}. ${PROGRESS_COPY.rankAction}`}
        testID="rank-card"
        contentStyle={styles.rankContent}
      >
        <View style={styles.rankTop}>
          <Pill label={PROGRESS_COPY.rankEyebrow} icon="ribbon-outline" material="thick" />
        </View>
        <View style={styles.rankRow}>
          <View style={styles.flex}>
            <AppText variant="secondary" tone="onPhotoMuted">
              {PROGRESS_COPY.rankLabel}
            </AppText>
            <AppText variant="section" tone="onPhoto">
              {rank ? RANK_LABEL[rank] : PROGRESS_COPY.rankUnknown}
            </AppText>
          </View>
          <View style={styles.rankAction}>
            <Icon name="chevron-forward" size={22} />
          </View>
        </View>
      </GlassCard>

      {all.length === 0 ? (
        <GlassCard>
          <EmptyState testID="progress-empty" icon="ribbon-outline" title={PROGRESS_COPY.emptyTitle} message={PROGRESS_COPY.empty(child.firstName)} />
        </GlassCard>
      ) : (
        <>
          <GlassCard testID="trend-card">
            <View style={styles.cardHead}>
              <AppText variant="section" header>
                {PROGRESS_COPY.trendTitle}
              </AppText>
              <AppText variant="secondary" tone="muted">
                {PROGRESS_COPY.trendMeta(Math.min(all.length, 10))}
              </AppText>
            </View>
            <ScoreTrendChart sessions={all} />
          </GlassCard>

          <ListGroup title={PROGRESS_COPY.historyTitle} testID="session-history">
            {all.map((s) => (
              <Row
                key={s.id}
                label={dayLabel(s.date)}
                value={PROGRESS_COPY.rowScores(s.scores.riding, s.scores.ground, s.scores.stable)}
                onPress={() => router.push({ pathname: '/family/sessions/[recordId]', params: { recordId: s.id } })}
                accessibilityLabel={[dayLabel(s.date), PROGRESS_COPY.rowScores(s.scores.riding, s.scores.ground, s.scores.stable), s.corrected ? PROGRESS_COPY.corrected : null, s.hasClip ? PROGRESS_COPY.clip : null].filter(Boolean).join(', ')}
                testID={`session-row-${s.id}`}
                trailing={
                  s.corrected || s.hasClip ? (
                    <View style={styles.badges} pointerEvents="none">
                      {s.corrected ? <StatusBadge label={PROGRESS_COPY.corrected} tone="info" icon="create-outline" /> : null}
                      {s.hasClip ? <StatusBadge label={PROGRESS_COPY.clip} icon="videocam-outline" /> : null}
                    </View>
                  ) : undefined
                }
              />
            ))}
          </ListGroup>
          {older.error ? <StatusNote tone="danger" message={older.error} /> : null}
          {older.cursor ? <GlassButton variant="secondary" icon="time-outline" label={PROGRESS_COPY.older} onPress={loadOlder} testID="load-older" /> : null}
        </>
      )}
    </>
  );
}

/** FA-04 Hall of Valour: the child's private clips (metadata tiles; no thumbnails are generated or cached). */
function ClipsView({ child }: { child: FamilyChild }) {
  const { scope } = useFamily();
  const router = useRouter();
  const res = useFamilyResource(['clips', child.id], (r) => r.progress.clips(scope, child.id));
  const consent = useSessionVideoConsent(child.id);
  return (
    <ResourceGate resource={res} loadingLabel={PROGRESS_COPY.loading} rows={2} testID="clips">
      {(data) => (
        <>
          <SyntheticBanner source={data.source} />
          <View style={styles.cardHead}>
            <AppText variant="section" header>
              {PROGRESS_COPY.hallTitle}
            </AppText>
            <AppText tone="muted">{PROGRESS_COPY.hallIntro(child.firstName)}</AppText>
          </View>
          {data.clips.length === 0 ? (
            <GlassCard>
              <EmptyState testID="clips-empty" icon="videocam-outline" title={PROGRESS_COPY.clipsEmptyTitle} message={PROGRESS_COPY.clipsEmpty} />
            </GlassCard>
          ) : (
            <>
              {consent.status === 'ready' && !consent.allowed ? (
                <StatusNote tone="warning" title={CLIP_COPY.consentTitle} message={CLIP_COPY.consent(child.firstName)} testID="clips-consent-missing" />
              ) : null}
              <View style={styles.grid} testID="clip-grid">
                {data.clips.map((c) => (
                  <ClipTile key={c.id} clip={c} locked={consent.status !== 'ready' || !consent.allowed} onPress={() => router.push({ pathname: '/family/sessions/[recordId]', params: { recordId: c.id } })} />
                ))}
              </View>
              {consent.status === 'ready' && !consent.allowed ? (
                <GlassButton variant="secondary" icon="shield-checkmark-outline" label={CLIP_COPY.manageConsent} onPress={() => router.push('/family/consents')} />
              ) : data.clips.length >= 2 ? (
                <GlassButton variant="secondary" icon="git-compare-outline" label={PROGRESS_COPY.compare} onPress={() => router.push('/family/compare')} testID="open-compare" />
              ) : null}
            </>
          )}
        </>
      )}
    </ResourceGate>
  );
}

const ClipTile = memo(function ClipTile({ clip, locked, onPress }: { clip: SessionSummary; locked: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tileCell}>
      <GlassCard
        onPress={onPress}
        accessibilityLabel={`${PROGRESS_COPY.clipTile}, ${dayLabel(clip.date)}${locked ? `, ${CLIP_COPY.consentTitle}` : ''}`}
        contentStyle={styles.tile}
        testID={`clip-tile-${clip.id}`}
      >
        <View style={[styles.tileIcon, { backgroundColor: rgba(colors.accent, 0.16) }]}>
          <Icon name={locked ? 'lock-closed' : 'play'} size={20} color={colors.accentText} />
        </View>
        <View style={styles.tileText}>
          <AppText variant="bodyStrong">{dayLabel(clip.date)}</AppText>
          <AppText variant="caption" tone="muted">
            {locked ? CLIP_COPY.consentTitle : PROGRESS_COPY.clipTile}
          </AppText>
        </View>
      </GlassCard>
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  rankContent: { justifyContent: 'space-between' },
  rankTop: { flexDirection: 'row' },
  rankRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  rankAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cardHead: { gap: space.xs },
  badges: { gap: space.xs, alignItems: 'flex-end' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tileCell: { flexGrow: 1, flexBasis: '45%' },
  tile: { minHeight: 132, padding: space.lg, justifyContent: 'space-between', gap: space.md },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tileText: { gap: 2 },
});
