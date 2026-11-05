import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { AppText, Icon } from '@/ui/components';
import { imageLibrary } from '@/ui/imageLibrary';
import {
  EmptyState,
  ErrorState,
  GlassButton,
  GlassIconButton,
  GlassScreen,
  GlassSurface,
  LoadingState,
  PhotoBackdrop,
  Pill,
  StatusNote,
  UnavailableState,
} from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, space } from '@/ui/tokens';

import { ChildSwitcher } from '../components/FamilyChrome';
import { FamilyCommandError, type FamilyChild } from '../data/repositories';
import { CommandLatches, sparkAckKey } from '../domain/commandLatch';
import { instantTime } from '../domain/format';
import { useFamily } from '../FamilyContext';
import { SparkWaveform } from './SparkWaveform';
import { SPARK_COPY } from './strings';
import type { SparkContent, SparkFeature, SparkScope, SparkToday } from './types';
import { SEEK_STEP_MS, useSparkPlayback } from './useSparkPlayback';

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * FA-06 Daily Spark (full-screen, above the Family tabs). 6 Nov 2026 redesign: one flat Burgundy field, the hoof
 * cut-out standing on the colour at the top (never behind text), then title, waveform and transport in white. Spark is per child (C01). With the G9 source, a listen is acknowledged to the
 * server only when the DEVICE player reports continuous coverage ≥ the policy threshold (seeks never count), and the
 * screen says "Recorded" only after the server answers. Streak numbers appear only when the server's `spark_streaks`
 * flag is on (D18 PROPOSED → off). A simulated (development) player says it plays no sound and is never recorded.
 */
export function SparkScreen() {
  const router = useRouter();
  const { familyApp, spark: legacy } = useRepositories();
  const feature = familyApp?.spark ?? legacy;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/family'));
  return (
    <GlassScreen tone="burgundy" testID="family-spark" header={{ onBack: close, closeStyle: true, title: undefined }}>
      {feature ? (
        <SparkForChild feature={feature} />
      ) : (
        <SparkPanel>
          <UnavailableState title={SPARK_COPY.unavailableTitle} message={SPARK_COPY.unavailableMessage} testID="spark-unavailable" />
        </SparkPanel>
      )}
    </GlassScreen>
  );
}

function SparkForChild({ feature }: { feature: SparkFeature }) {
  const { selected, linked, scope } = useFamily();
  const sparkScope = useMemo<SparkScope>(
    () => ({ subjectId: scope.subjectId, experience: 'family', cadetId: selected?.id, children: scope.children ?? linked.map((c) => ({ cadetId: c.id, firstName: c.firstName, hubId: c.hubId })) }),
    [scope.subjectId, scope.children, selected?.id, linked],
  );
  // The pre-G9 source is guardian-wide; the G9 source needs a linked child.
  if (feature.repository.acknowledge && !selected) {
    return (
      <SparkPanel>
        <EmptyState icon="people-outline" title={SPARK_COPY.noChildTitle} message={SPARK_COPY.noChild} testID="spark-no-child" />
      </SparkPanel>
    );
  }
  return <SparkBody key={selected?.id ?? 'guardian'} feature={feature} scope={sparkScope} child={selected} />;
}

function SparkBody({ feature, scope, child }: { feature: SparkFeature; scope: SparkScope; child: FamilyChild | null }) {
  const { keyFor } = useFamily();
  const today = useScopedResource<SparkToday>(keyFor('spark', child?.id ?? '-'), () => feature.repository.getToday(scope));
  if (today.status === 'loading') {
    return (
      <SparkPanel bare>
        <LoadingState label={SPARK_COPY.loading} rows={1} testID="spark-loading" />
      </SparkPanel>
    );
  }
  if (today.status === 'error') {
    return (
      <SparkPanel>
        <ErrorState message={today.message} onRetry={today.retry} details={today.reference ? `Reference: ${today.reference}` : undefined} testID="spark-error" />
      </SparkPanel>
    );
  }
  if (!today.data.spark) {
    return (
      <SparkPanel before={<ChildSwitcher material="thick" />}>
        <EmptyState icon="sunny-outline" title={SPARK_COPY.emptyTitle} message={SPARK_COPY.emptyMessage} testID="spark-empty" />
      </SparkPanel>
    );
  }
  return <SparkPlayer content={today.data.spark} data={today.data} feature={feature} scope={scope} child={child} />;
}

type AckState = { kind: 'idle' } | { kind: 'done'; at: string } | { kind: 'failed'; message: string; retry: boolean };

function SparkPlayer({ content, data, feature, scope, child }: { content: SparkContent; data: SparkToday; feature: SparkFeature; scope: SparkScope; child: FamilyChild | null }) {
  const { colors } = useTheme();
  const { state, labels, simulated, coverage, actions } = useSparkPlayback(content, feature.createAudio);
  const progress = state.durationMs > 0 ? state.positionMs / state.durationMs : 0;
  const duration = state.durationMs || content.durationMs;
  const canPlay = labels.primaryAction !== 'none';
  const primaryIcon = labels.primaryAction === 'pause' ? 'pause' : labels.primaryAction === 'retry' ? 'refresh' : 'play';

  const acknowledge = feature.repository.acknowledge?.bind(feature.repository);
  const [latches] = useState(() => new CommandLatches());
  const [ack, setAck] = useState<AckState>(() => (data.acknowledgement?.acknowledged ? { kind: 'done', at: data.acknowledgement.at ?? '' } : { kind: 'idle' }));
  const [attempt, setAttempt] = useState(0);
  // Record once, only for a real DEVICE listen that covered enough of the audio (never for a simulated player).
  const eligible = Boolean(acknowledge && child && !simulated && coverage >= data.policy.completionMinCoverage);
  const waiting = ack.kind === 'idle';
  useEffect(() => {
    if (!eligible || !waiting || !acknowledge || !child) return;
    let live = true;
    const key = sparkAckKey(child.id, content.id);
    acknowledge(scope, { cadetId: child.id, sparkId: content.id, operationId: latches.idFor(key) })
      .then((r) => {
        latches.settle(key, 'acknowledged');
        if (live) setAck({ kind: 'done', at: r.acknowledgedAt });
      })
      .catch((e: unknown) => {
        const err = e instanceof FamilyCommandError ? e : new FamilyCommandError('unexpected', '');
        latches.settle(key, err.kind === 'network' ? 'network' : 'refused');
        const notToday = err.kind === 'conflict' && err.serverMessage.startsWith('spark_not_today:');
        if (live) setAck({ kind: 'failed', message: notToday ? SPARK_COPY.notToday : err.kind === 'network' ? SPARK_COPY.recordFailed : SPARK_COPY.recordRefused, retry: err.kind === 'network' });
      });
    return () => {
      live = false;
    };
  }, [eligible, waiting, attempt, acknowledge, child, content.id, scope, latches]);
  const retryAck = () => {
    setAck({ kind: 'idle' });
    setAttempt((n) => n + 1);
  };
  const sending = eligible && waiting;

  const showStreak = data.streak?.enabled === true && typeof data.streak.current === 'number';
  return (
    <>
      <SparkArt />
      <View style={styles.tags}>
        <Pill label={SPARK_COPY.category} icon="sparkles-outline" material="thick" />
        {data.source === 'synthetic-preview' ? <Pill label={SPARK_COPY.syntheticPill} icon="flask-outline" material="thick" testID="preview-banner" /> : null}
      </View>
      <ChildSwitcher material="thick" />
      <View style={styles.titleBlock}>
        <AppText variant="display" tone="onPhoto" header testID="spark-title">
          {content.title}
        </AppText>
        <AppText tone="onPhotoMuted">
          {[child?.firstName, content.dateLabel, SPARK_COPY.minutes(duration)].filter(Boolean).join(' · ')}
        </AppText>
        {content.subtitle ? <AppText tone="onPhoto">{content.subtitle}</AppText> : null}
      </View>

      <View style={styles.timeline}>
        <SparkWaveform peaks={content.peaks} progress={progress} testID="spark-waveform" />
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={SPARK_COPY.progressLabel}
          accessibilityValue={{ min: 0, max: Math.round(duration / 1000), now: Math.round(state.positionMs / 1000), text: labels.position }}
          testID="spark-progress"
        >
          {content.peaks ? null : (
            <View style={[styles.track, { backgroundColor: rgba(colors.onPhoto, 0.22) }]}>
              <View style={[styles.trackFill, { width: `${Math.round(progress * 1000) / 10}%`, backgroundColor: colors.accent }]} />
            </View>
          )}
          <View style={styles.times}>
            <AppText variant="secondary" tone="onPhoto" style={styles.tabular} testID="spark-elapsed">
              {clock(state.positionMs)}
            </AppText>
            <AppText variant="secondary" tone="onPhotoMuted" style={styles.tabular}>
              {clock(duration)}
            </AppText>
          </View>
        </View>
      </View>

      <GlassSurface material="regular" borderRadius={52} style={styles.transport} contentStyle={styles.transportRow} testID="spark-transport">
        <GlassIconButton
          icon="play-back"
          renderIcon={(c, s) => <MaterialIcons name="replay-10" size={s + 4} color={c} />}
          accessibilityLabel={SPARK_COPY.back10}
          size={64}
          material="thin"
          disabled={!canPlay || state.durationMs === 0}
          onPress={() => actions.seekBy(-SEEK_STEP_MS)}
          testID="spark-back"
        />
        <GlassIconButton
          icon={primaryIcon}
          accessibilityLabel={labels.primary}
          accessibilityHint={labels.position}
          appearance="solid"
          size={80}
          iconSize={30}
          loading={!canPlay && state.status !== 'error'}
          onPress={actions.primary}
          testID="spark-primary"
        />
        <GlassIconButton
          icon="play-forward"
          renderIcon={(c, s) => <MaterialIcons name="forward-10" size={s + 4} color={c} />}
          accessibilityLabel={SPARK_COPY.forward10}
          size={64}
          material="thin"
          disabled={!canPlay || state.durationMs === 0}
          onPress={() => actions.seekBy(SEEK_STEP_MS)}
          testID="spark-forward"
        />
      </GlassSurface>

      {labels.hint ? <StatusNote tone={state.status === 'error' ? 'danger' : 'info'} message={labels.hint} testID="spark-hint" /> : null}

      {ack.kind === 'done' && child ? <StatusNote tone="success" message={SPARK_COPY.recorded(child.firstName, ack.at ? instantTime(ack.at) : '')} testID="spark-recorded" /> : null}
      {sending && child ? <StatusNote tone="info" message={SPARK_COPY.recording(child.firstName)} testID="spark-recording" /> : null}
      {ack.kind === 'failed' ? (
        <View style={styles.ackFail}>
          <StatusNote tone="danger" message={ack.message} testID="spark-record-failed" />
          {ack.retry ? <GlassButton variant="secondary" icon="refresh" label={SPARK_COPY.recordAgain} material="thick" onPress={retryAck} testID="spark-record-retry" /> : null}
        </View>
      ) : null}

      <GlassSurface material="regular" borderRadius={radius.card} elevated={false} contentStyle={styles.note} testID="spark-acknowledgement">
        {showStreak ? (
          <NoteRow icon="flame-outline" color={colors.accentText} text={SPARK_COPY.streak(data.streak?.current ?? 0)} testID="spark-streak" />
        ) : acknowledge ? (
          <NoteRow icon="information-circle-outline" color={colors.accentText} text={SPARK_COPY.streaksOff} />
        ) : (
          <NoteRow icon="information-circle-outline" color={colors.accentText} text={SPARK_COPY.notCounted} />
        )}
        {acknowledge && child && !simulated && ack.kind === 'idle' ? <NoteRow icon="ear-outline" color={colors.accentText} text={SPARK_COPY.howCounted(child.firstName)} /> : null}
        {simulated ? <NoteRow icon="flask-outline" color={colors.devBannerText} text={acknowledge ? SPARK_COPY.simulatedNotRecorded : SPARK_COPY.simulated} muted testID="spark-simulated" /> : null}
      </GlassSurface>
    </>
  );
}

/** The hoof cut-out on the flat Burgundy field, right-aligned, sized to the window. Decorative. */
function SparkArt() {
  const { height, width } = useWindowDimensions();
  const art = imageLibrary.sparkHoof;
  const h = Math.round(Math.min(height * 0.26, (width * 0.5) / art.aspect));
  return (
    <View style={[styles.art, { height: h }]}>
      <View style={{ width: Math.round(h * art.aspect), height: h }}>
        <PhotoBackdrop source={art.source} resizeMode="contain" />
      </View>
    </View>
  );
}

/** Non-player states sit below the artwork on a flat panel of the same tone. */
function SparkPanel({ children, before, bare = false }: { children: ReactNode; before?: ReactNode; bare?: boolean }) {
  return (
    <>
      <SparkArt />
      {before}
      {bare ? (
        children
      ) : (
        <GlassSurface material="thick" borderRadius={radius.card} contentStyle={styles.panel}>
          {children}
        </GlassSurface>
      )}
    </>
  );
}

function NoteRow({ icon, color, text, muted, testID }: { icon: 'flame-outline' | 'information-circle-outline' | 'ear-outline' | 'flask-outline'; color: string; text: string; muted?: boolean; testID?: string }) {
  return (
    <View style={styles.noteRow}>
      <Icon name={icon} size={18} color={color} />
      <AppText variant="secondary" tone={muted ? 'onPhotoMuted' : 'onPhoto'} style={styles.noteText} testID={testID}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { flexDirection: 'row', justifyContent: 'flex-end' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  titleBlock: { gap: space.sm },
  timeline: { gap: space.sm },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  tabular: { fontVariant: ['tabular-nums'] },
  transport: { alignSelf: 'center' },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  note: { padding: space.lg, gap: space.md },
  noteRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteText: { flex: 1 },
  ackFail: { gap: space.sm },
  panel: { paddingHorizontal: space.lg },
});
