import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { TodayWork } from '@/features/fieldOps';
import { ExperienceSwitchButton } from '@/features/identity/ExperienceSwitch';
import { AppText } from '@/ui/components';
import {
  EmptyState,
  GlassButton,
  GlassScreen,
  GlassSurface,
  ListGroup,
  LoadingState,
  Row,
  StatusBadge,
  StatusNote,
  SyntheticDataBanner,
} from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { rememberAssessTarget } from './assessHandoff';
import { LoadFailure } from './components/LoadStates';
import { Trailing } from './components/Trailing';
import type { TodayCheckIn } from './data/repositories';
import { useFieldStrings, type FieldTranslator } from './i18n';
import type { FieldTodayData } from './types';
import { useFieldAccess } from './useFieldAccess';

export function useFieldToday() {
  const { state, contextKey } = useAuthorizedAccess();
  const { fieldToday } = useRepositories();
  const { scope } = useFieldAccess();
  return useScopedResource(`${contextKey}:today`, () =>
    fieldToday.getToday({
      subjectId: state.session.subjectId,
      experience: 'field',
      hubId: scope.hubId,
      role: scope.role,
      displayName: state.session.displayName,
    }),
  );
}

/**
 * FO-01 Today: sunlight-readable operational layout. The day's numbers first (checked in / published / to assess),
 * then the cadets who still need an assessment at the top of one flat glass list, then care. Scan sits in the thumb
 * zone as the floating primary action. Status is always icon + word.
 */
export function FieldTodayScreen() {
  const s = useFieldStrings();
  const router = useRouter();
  const access = useFieldAccess();
  const { scope, contextKey, canRecord, canViewCadets, fieldApp, workflow } = access;
  const today = useFieldToday();
  const { state } = useAuthorizedAccess();
  // UX only (capability punchIn); hub admins have no shift to punch by default and the server refuses others.
  const caps = state.session.scope?.capabilities;
  const canPunch = caps ? caps.punchIn === true : scope.role === 'INSTRUCTOR' || scope.role === 'GROOM';

  // Server Today carries check-ins; fixture Today may not, so they come from the Field repositories then.
  const needCheckIns = today.status === 'ready' && today.data.checkIns === undefined && canViewCadets && !!fieldApp;
  const checkIns = useScopedResource(`${contextKey}:today-checkins:${needCheckIns ? 'load' : 'skip'}`, () =>
    needCheckIns && fieldApp ? fieldApp.checkIns.listToday(scope) : Promise.resolve(null),
  );
  const flags = useScopedResource(`${contextKey}:flags`, () => (fieldApp && canViewCadets ? fieldApp.policy.flags(scope) : Promise.resolve({ sessionRoster: false })));

  const firstFocus = useRef(true);
  const retryToday = today.retry;
  const retryCheckIns = checkIns.retry;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      retryToday();
      retryCheckIns();
    }, [retryToday, retryCheckIns]),
  );

  const scanHint = !canRecord ? (canViewCadets ? s.t('today.notInstructor') : null) : !workflow ? s.t('today.noBackend') : null;
  const list: TodayCheckIn[] | null =
    today.status !== 'ready' || !canViewCadets ? null : (today.data.checkIns ?? (checkIns.status === 'ready' ? checkIns.data : null));

  return (
    <GlassScreen
      edges={['top', 'left', 'right']}
      testID="field-today"
      footer={
        canRecord && workflow ? (
          <GlassButton size="large" icon="qr-code-outline" label={s.t('today.scanAction')} accessibilityHint={s.t('today.scanHint')} onPress={() => router.push('/field/scan')} testID="open-scan" />
        ) : undefined
      }
    >
      <View style={styles.header}>
        <AppText variant="secondary" tone="accent" style={styles.eyebrow}>
          {s.t('today.eyebrow')}
        </AppText>
        <AppText variant="title" header>
          {s.t('today.title')}
        </AppText>
        <AppText tone="muted">{today.status === 'ready' ? `${today.data.hubName} · ${today.data.dateLabel}` : access.scope.displayName}</AppText>
      </View>
      <ExperienceSwitchButton />
      {scanHint ? <StatusNote tone="info" message={scanHint} testID="scan-hint" /> : null}
      {today.status === 'loading' ? <LoadingState label={s.t('today.loading')} testID="field-today-loading" /> : null}
      {today.status === 'error' ? <LoadFailure state={today} onRetry={today.retry} testID="field-today" /> : null}
      {today.status === 'ready' ? (
        <TodayBody
          data={today.data}
          s={s}
          canRecord={canRecord && !!workflow}
          canViewCadets={canViewCadets}
          checkIns={list}
          checkInsState={today.data.checkIns !== undefined ? 'ready' : checkIns.status}
          onRetryCheckIns={checkIns.retry}
          rosterOn={flags.status === 'ready' && flags.data.sessionRoster}
          onOpenCadet={(c) => router.push({ pathname: '/field/cadets/[cadetId]', params: { cadetId: c.cadetId } })}
          onAssess={(c) => {
            rememberAssessTarget({ checkInOperationId: c.checkInOperationId, cadetId: c.cadetId, cadetName: c.cadetName });
            router.push({ pathname: '/field/cadets/[cadetId]/assess', params: { cadetId: c.cadetId, op: c.checkInOperationId } });
          }}
          onOpenRoster={() => router.push({ pathname: '/field/sessions/[sessionId]', params: { sessionId: 'today' } })}
        />
      ) : null}
      {today.status !== 'loading' ? (
        <TodayWork
          canPunch={canPunch}
          onOpenShift={() => router.push('/field/shift')}
          onOpenReview={() => router.push('/field/review')}
          onOpenSync={() => router.navigate('/field/sync')}
          onOpenTask={(taskId) => router.push({ pathname: '/field/horses/care/[taskId]', params: { taskId } })}
          onOpenHorses={() => router.navigate('/field/horses')}
        />
      ) : null}
    </GlassScreen>
  );
}

/** The day's three numbers in one glass panel, large tabular numerals (sunlight-readable). */
function DayNumbers({ list, s }: { list: TodayCheckIn[]; s: FieldTranslator }) {
  const { colors } = useTheme();
  const published = list.filter((c) => c.published === true).length;
  const known = list.every((c) => c.published !== null);
  const toAssess = known ? list.length - published : null;
  const items = [
    { key: 'in', label: s.t('today.stats.checkedIn'), value: list.length },
    { key: 'pub', label: s.t('today.stats.published'), value: known ? published : null },
    { key: 'todo', label: s.t('today.stats.toAssess'), value: toAssess },
  ];
  return (
    <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.numbers} accessible accessibilityLabel={items.map((i) => `${i.label} ${i.value ?? '–'}`).join(', ')} testID="today-numbers">
      {items.map((i) => (
        <View key={i.key} style={styles.number}>
          <AppText variant="score" style={i.key === 'todo' && (i.value ?? 0) > 0 ? { color: colors.accentText } : undefined}>
            {i.value === null ? '–' : s.number(i.value)}
          </AppText>
          <AppText variant="secondary" tone="muted" numberOfLines={2}>
            {i.label}
          </AppText>
        </View>
      ))}
    </GlassSurface>
  );
}

function TodayBody({
  data,
  s,
  canRecord,
  canViewCadets,
  checkIns,
  checkInsState,
  onRetryCheckIns,
  rosterOn,
  onOpenCadet,
  onAssess,
  onOpenRoster,
}: {
  data: FieldTodayData;
  s: FieldTranslator;
  canRecord: boolean;
  canViewCadets: boolean;
  checkIns: TodayCheckIn[] | null;
  checkInsState: 'loading' | 'error' | 'ready';
  onRetryCheckIns: () => void;
  rosterOn: boolean;
  onOpenCadet: (c: TodayCheckIn) => void;
  onAssess: (c: TodayCheckIn) => void;
  onOpenRoster: () => void;
}) {
  // Priority: still to assess first (oldest check-in first), then published.
  const ordered = checkIns ? [...checkIns].sort((a, b) => Number(a.published === true) - Number(b.published === true) || a.time.localeCompare(b.time)) : null;
  return (
    <>
      {data.source === 'synthetic-preview' ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      <View style={styles.badges}>
        <StatusBadge label={data.roleLabel} tone="neutral" icon="person-circle-outline" />
      </View>

      {canViewCadets ? (
        checkInsState === 'loading' ? (
          <LoadingState label={s.t('today.loadingCheckIns')} rows={1} />
        ) : checkInsState === 'error' || !ordered ? (
          <View style={styles.section}>
            <StatusNote tone="warning" message={s.t('today.checkInsUnavailable')} testID="today-checkins-error" />
            <GlassButton variant="secondary" icon="refresh" label={s.t('common.retry')} onPress={onRetryCheckIns} />
          </View>
        ) : (
          <>
            <DayNumbers list={ordered} s={s} />
            {ordered.length === 0 ? (
              <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.emptyCard}>
                <EmptyState icon="qr-code-outline" title={s.t('today.noCheckInsTitle')} message={s.t('today.noCheckIns')} testID="today-no-checkins" />
              </GlassSurface>
            ) : (
              <ListGroup title={s.t('today.checkedIn')} testID="today-checkins">
                {ordered.map((c) => (
                  <Row
                    key={c.checkInId}
                    testID={`checkin-${c.checkInId}`}
                    emphasis
                    label={c.cadetName}
                    value={s.t('today.checkedInAt', { time: c.time })}
                    icon="person-outline"
                    onPress={() => onOpenCadet(c)}
                    accessibilityHint={s.t('today.openCadetHint')}
                    trailing={
                      c.published === true ? (
                        <Trailing>
                          <StatusBadge label={s.t('today.published')} tone="success" />
                        </Trailing>
                      ) : c.published === null || !canRecord ? undefined : (
                        <GlassButton variant="secondary" fullWidth={false} label={s.t('today.assess')} accessibilityLabel={s.t('today.assessA11y', { name: c.cadetName })} onPress={() => onAssess(c)} testID={`assess-${c.checkInId}`} />
                      )
                    }
                  />
                ))}
              </ListGroup>
            )}
          </>
        )
      ) : null}

      {rosterOn ? (
        <ListGroup title={s.t('today.rosterTitle')}>
          <Row label={s.t('today.roster')} value={s.t('today.rosterHint')} icon="list-outline" onPress={onOpenRoster} testID="open-roster" />
        </ListGroup>
      ) : null}


    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  eyebrow: { fontWeight: '600' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  numbers: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.md },
  number: { flex: 1, gap: space.xs },
  emptyCard: { paddingHorizontal: space.lg },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs },
});
