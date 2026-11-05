import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useScopedResource } from '@/core/data/useScopedResource';
import { dateLabel, hubDate } from '@/core/format/hubTime';
import { AppText } from '@/ui/components';
import { EmptyState, FeatureGatedState, GlassButton, GlassScreen, GlassSurface, ListGroup, LoadingState, Row, StatusBadge, SyntheticDataBanner, UnavailableState } from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { LoadFailure } from './components/LoadStates';
import { Trailing } from './components/Trailing';
import type { RosterRow } from './data/repositories';
import { FEATURE_OFF_REFERENCE } from './data/server';
import { useFieldStrings, type FieldTranslator } from './i18n';
import { useFieldAccess } from './useFieldAccess';

function rowState(r: RosterRow, s: FieldTranslator) {
  if (r.published) return <StatusBadge label={s.t('roster.rowPublished')} tone="success" />;
  if (r.checkInId) return <StatusBadge label={s.t('roster.rowIn', { time: r.checkedInAt ?? '' })} tone="info" icon="log-in-outline" />;
  return <StatusBadge label={s.t('roster.rowNot')} tone="neutral" />;
}

/**
 * FO-07 Session roster (conditional, flag `session_roster`, default OFF pending Q7/D31). Under the D31 default there is
 * no batch model, so the roster is every cadet of the hub for one hub-local date with attendance, publication and
 * recording consent. While the flag is off the route says so and nothing links here.
 */
export function SessionRosterScreen() {
  const s = useFieldStrings();
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { scope, contextKey, fieldApp, canViewCadets, canRecord, isPreview } = useFieldAccess();
  const date = sessionId === 'today' || !sessionId ? hubDate(new Date()) : /^\d{4}-\d{2}-\d{2}$/.test(sessionId) ? sessionId : null;
  const data = useScopedResource(`${contextKey}:roster:${date ?? 'bad'}`, async () => {
    if (!fieldApp || !date || !canViewCadets) return null;
    const flags = await fieldApp.policy.flags(scope);
    if (!flags.sessionRoster) return { off: true as const };
    return { off: false as const, rows: await fieldApp.roster.forDate(scope, date) };
  });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/field'));
  const header = { title: s.t('roster.title'), onBack: back, backLabel: s.t('common.back') };
  const on = data.status === 'ready' && data.data && !data.data.off;

  return (
    <GlassScreen
      header={header}
      testID="field-roster"
      footer={on && canRecord ? <GlassButton size="large" icon="qr-code-outline" label={s.t('roster.scan')} onPress={() => router.push('/field/scan')} testID="roster-scan" /> : undefined}
    >
      {!canViewCadets ? (
        <UnavailableState title={s.t('cadets.deniedTitle')} message={s.t('cadets.denied')} />
      ) : !fieldApp ? (
        <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('common.notConnected')} />
      ) : !date ? (
        <UnavailableState title={s.t('common.notFoundTitle')} message={s.t('common.notFound')} />
      ) : data.status === 'loading' ? (
        <LoadingState label={s.t('roster.loading')} testID="roster-loading" />
      ) : data.status === 'error' ? (
        data.reference === FEATURE_OFF_REFERENCE ? (
          <FeatureGatedState title={s.t('roster.offTitle')} message={s.t('roster.off')} testID="roster-off" />
        ) : (
          <LoadFailure state={data} onRetry={data.retry} testID="roster" />
        )
      ) : !data.data || data.data.off ? (
        <FeatureGatedState title={s.t('roster.offTitle')} message={s.t('roster.off')} testID="roster-off" />
      ) : (
        <>
          {isPreview ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
          <View style={styles.head}>
            <AppText variant="title" header>
              {dateLabel(date)}
            </AppText>
            <AppText tone="muted">{s.tn('roster.subtitle', data.data.rows.length)}</AppText>
          </View>
          {data.data.rows.length === 0 ? (
            <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.pad}>
              <EmptyState icon="people-outline" title={s.t('roster.emptyTitle')} message={s.t('roster.empty')} />
            </GlassSurface>
          ) : (
            <ListGroup testID="roster-list">
              {data.data.rows.map((r) => (
                <Row
                  key={r.cadetId}
                  testID={`roster-${r.cadetId}`}
                  emphasis
                  icon={r.sessionVideoAllowed ? 'person-outline' : 'videocam-off-outline'}
                  label={r.name}
                  value={[r.horseName ? s.t('roster.horse', { name: r.horseName }) : null, r.sessionVideoAllowed ? null : s.t('roster.recordingOff')].filter(Boolean).join(' · ') || undefined}
                  onPress={() => router.push({ pathname: '/field/cadets/[cadetId]', params: { cadetId: r.cadetId } })}
                  trailing={<Trailing>{rowState(r, s)}</Trailing>}
                />
              ))}
            </ListGroup>
          )}
        </>
      )}
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
  pad: { paddingHorizontal: space.lg },
});
