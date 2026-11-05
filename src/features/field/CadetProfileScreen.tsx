import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { dateLabel } from '@/core/format/hubTime';
import { AppText } from '@/ui/components';
import { EmptyState, GlassButton, GlassCard, GlassScreen, GlassSurface, ListGroup, LoadingState, Pill, Row, StatusBadge, StatusNote, SyntheticDataBanner, UnavailableState } from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { rememberAssessTarget } from './assessHandoff';
import { LoadFailure } from './components/LoadStates';
import { ReasonSheet } from './components/ReasonSheet';
import { Trailing } from './components/Trailing';
import type { CadetProfile, ConsentValue, FieldCommandRepository } from './data/repositories';
import { toCommandError, type FieldCommandError } from './domain/commandErrors';
import { isUuid, latchOperation, newOperationId, type OperationLatch } from './domain/operation';
import { useFieldStrings, type FieldTranslator } from './i18n';
import { commandMessage } from './useCheckIn';
import { useFieldAccess } from './useFieldAccess';

const consentTone = { allowed: 'success', off: 'warning', unknown: 'neutral' } as const;
const consentIcon = { allowed: 'checkmark-circle', off: 'close-circle', unknown: 'help-circle-outline' } as const;

function ConsentRow({ label, value, s }: { label: string; value: ConsentValue; s: FieldTranslator }) {
  const word = s.t(`profile.consent.${value}`);
  return <Row label={label} accessibilityLabel={`${label}, ${word}`} trailing={<Trailing><StatusBadge label={word} tone={consentTone[value]} icon={consentIcon[value]} /></Trailing>} />;
}

/**
 * FO-06 Cadet profile (staff side): identity with a masked passport, today's state and the one action that fits it,
 * media consent (unknown counts as off), assessment history (rows open the record for reading/correcting) and
 * attendance. Another hub's cadet looks exactly like an unknown id.
 */
export type VoidState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; name: string } | { kind: 'error'; error: FieldCommandError; retryable: boolean };

export function CadetProfileView({
  data,
  canRecord,
  onAssess,
  onScan,
  onOpenRecord,
  canVoid = false,
  voidState = { kind: 'idle' },
  onVoid,
  onRetryVoid,
  onProposeRank,
}: {
  data: CadetProfile;
  canRecord: boolean;
  onAssess: () => void;
  onScan: () => void;
  onOpenRecord: (sessionId: string) => void;
  /** UX only: instructors and hub admins of the hub, when the server offers the void function (SD-05 draft). */
  canVoid?: boolean;
  voidState?: VoidState;
  onVoid?: () => void;
  /** Resends the same void (same operation id and reason) after a lost reply. */
  onRetryVoid?: () => void;
  /** FO-19 entry, only when the rank_proposals policy is on for this role (G6/G9; the server re-checks). */
  onProposeRank?: () => void;
}) {
  const s = useFieldStrings();
  const c = data.cadet;
  const t = data.today;
  // Only today's unassessed check-in can be voided; a published one is corrected in FO-03 instead.
  const voidable = canVoid && !!t && !t.publishedSessionId && !!onVoid;
  return (
    <>
      {voidState.kind === 'done' ? <StatusNote tone="success" message={s.t('profile.voided', { name: voidState.name })} testID="profile-voided" /> : null}
      {data.source === 'synthetic-preview' ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      <GlassCard material="thick" testID="profile-identity">
        <View style={styles.identity}>
          <AppText variant="title" header>
            {c.name}
          </AppText>
          <View style={styles.badges}>
            <Pill icon="shield-outline" label={c.rank ? s.t(`ranks.${c.rank}`) : s.t('ranks.none')} />
            {c.horseName ? <Pill icon="leaf-outline" label={c.horseName} /> : null}
          </View>
          {c.passportHint ? (
            <AppText variant="secondary" tone="muted" accessibilityLabel={s.t('profile.passportA11y')}>
              {s.t('profile.passport', { hint: c.passportHint })}
            </AppText>
          ) : null}
        </View>
      </GlassCard>

      <View style={styles.group}>
        <AppText variant="secondary" tone="muted" header style={styles.groupTitle}>
          {s.t('profile.today')}
        </AppText>
        <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.todayCard} testID="profile-today">
          {t ? (
            <>
              <View style={styles.badges}>
                <StatusBadge label={s.t('profile.todayIn', { time: t.time })} tone="info" icon="log-in-outline" />
                {data.sessions === null ? null : t.publishedSessionId ? (
                  <StatusBadge label={s.t('profile.todayPublished')} tone="success" />
                ) : (
                  <StatusBadge label={s.t('profile.todayNotAssessed')} tone="warning" />
                )}
              </View>
              {t.publishedSessionId ? (
                <GlassButton variant="secondary" icon="document-text-outline" label={s.t('profile.viewToday')} onPress={() => onOpenRecord(t.publishedSessionId as string)} testID="profile-view-today" />
              ) : canRecord ? (
                <GlassButton size="large" icon="clipboard-outline" label={s.t('profile.assessNow')} onPress={onAssess} testID="profile-assess" />
              ) : null}
            </>
          ) : (
            <>
              <AppText tone="muted">{s.t('profile.todayNone')}</AppText>
              {canRecord ? <GlassButton variant="secondary" icon="qr-code-outline" label={s.t('profile.scan')} onPress={onScan} testID="profile-scan" /> : null}
            </>
          )}
        </GlassSurface>
      </View>

      <ListGroup title={s.t('profile.consentTitle')} testID="profile-consent" footer={<AppText variant="secondary" tone="muted">{s.t('profile.consentNote')}</AppText>}>
        <ConsentRow label={s.t('profile.consentSessionVideo')} value={data.consent.sessionVideo} s={s} />
        <ConsentRow label={s.t('profile.consentCarePhoto')} value={data.consent.carePhoto} s={s} />
        <ConsentRow label={s.t('profile.consentPosture')} value={data.consent.postureAnalysis} s={s} />
      </ListGroup>

      <ListGroup title={s.t('profile.attendance')} testID="profile-attendance">
        {data.attendance.length === 0 ? (
          <Row label={s.t('profile.attendanceNone')} />
        ) : (
          data.attendance.slice(0, 10).map((a) => (
            <Row
              key={`${a.date}-${a.time}`}
              icon="checkmark-circle-outline"
              label={s.t('profile.attendanceRow', { date: dateLabel(a.date), time: a.time })}
              trailing={a.published === null ? undefined : <Trailing>{a.published ? <StatusBadge label={s.t('cadets.published')} tone="success" /> : <StatusBadge label={s.t('profile.notAssessed')} tone="neutral" />}</Trailing>}
            />
          ))
        )}
      </ListGroup>

      {data.sessions === null ? (
        <StatusNote tone="info" message={s.t('profile.historyHidden')} testID="profile-history-hidden" />
      ) : data.sessions.length === 0 ? (
        <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.pad}>
          <EmptyState icon="clipboard-outline" title={s.t('profile.historyNone')} message={s.t('profile.historyNoneBody')} testID="profile-history-empty" />
        </GlassSurface>
      ) : (
        <ListGroup title={s.t('profile.history')} testID="profile-history">
          {data.sessions.map((x) => (
            <Row
              key={x.id}
              testID={`session-${x.id}`}
              icon={x.published ? 'ribbon-outline' : 'document-outline'}
              label={dateLabel(x.sessionDate)}
              value={x.scores ? s.t('profile.scoresLine', x.scores) : s.t('profile.noScores')}
              onPress={() => onOpenRecord(x.id)}
              trailing={x.version > 1 ? <Trailing><StatusBadge label={s.t('assess.record.corrected')} tone="info" icon="create-outline" /></Trailing> : undefined}
            />
          ))}
        </ListGroup>
      )}

      {onProposeRank ? (
        <ListGroup testID="profile-rank">
          <Row icon="ribbon-outline" label={s.t('profile.rankPropose')} value={s.t('profile.rankProposeHint')} onPress={onProposeRank} testID="profile-propose-rank" />
        </ListGroup>
      ) : null}

      {voidable ? (
        <View style={styles.group} testID="profile-actions">
          {voidState.kind === 'error' ? <StatusNote tone="danger" message={commandMessage(voidState.error, s)} testID="profile-void-error" /> : null}
          {voidState.kind === 'error' && voidState.retryable && onRetryVoid ? (
            <GlassButton variant="secondary" icon="refresh" label={s.t('common.retry')} onPress={onRetryVoid} testID="profile-void-retry" />
          ) : null}
          <GlassButton
            variant="ghost"
            icon="close-circle-outline"
            label={voidState.kind === 'busy' ? s.t('profile.voiding') : s.t('profile.void')}
            accessibilityHint={s.t('profile.voidHint')}
            disabled={voidState.kind === 'busy'}
            loading={voidState.kind === 'busy'}
            onPress={onVoid}
            testID="profile-void"
          />
          <AppText variant="secondary" tone="muted" style={styles.groupTitle}>
            {s.t('profile.voidHint')}
          </AppText>
        </View>
      ) : null}
    </>
  );
}

export function CadetProfileScreen() {
  const s = useFieldStrings();
  const router = useRouter();
  const { cadetId: raw } = useLocalSearchParams<{ cadetId?: string }>();
  const cadetId = isUuid(raw) ? raw : null;
  const { scope, contextKey, fieldApp, canViewCadets, canRecord, commands } = useFieldAccess();
  const profile = useScopedResource(`${contextKey}:cadet:${cadetId ?? 'invalid'}`, () =>
    fieldApp && cadetId && canViewCadets ? fieldApp.cadets.profile(scope, cadetId) : Promise.resolve(null),
  );
  const first = useRef(true);
  const { retry } = profile;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      retry();
    }, [retry]),
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace('/field/cadets'));
  const name = profile.status === 'ready' && profile.data ? profile.data.cadet.name : s.t('profile.title');
  const voidCmd = useVoidCheckIn(commands);
  const { fieldOps } = useRepositories();
  const rankFlags = useScopedResource(`${contextKey}:rank-policy`, async () =>
    fieldOps && canViewCadets ? (await fieldOps.policy.flags({ subjectId: scope.subjectId, experience: 'field', hubId: scope.hubId ?? null, role: scope.role ?? null })).rankProposals : null,
  );
  const canProposeRank = rankFlags.status === 'ready' && !!rankFlags.data?.enabled && !!scope.role && rankFlags.data.proposerRoles.includes(scope.role);
  const canVoid = !!commands?.voidCheckIn && (scope.role === 'INSTRUCTOR' || scope.role === 'SCHOOL_ADMIN');
  const today = profile.status === 'ready' ? (profile.data?.today ?? null) : null;

  return (
    <GlassScreen header={{ title: name, onBack: back, backLabel: s.t('common.back') }} testID="field-cadet">
      {!canViewCadets ? (
        <UnavailableState title={s.t('cadets.deniedTitle')} message={s.t('cadets.denied')} testID="cadet-denied" />
      ) : !fieldApp ? (
        <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('cadets.unavailable')} />
      ) : !cadetId ? (
        <UnavailableState title={s.t('profile.notFoundTitle')} message={s.t('profile.notFound')} testID="cadet-not-found" />
      ) : profile.status === 'loading' ? (
        <LoadingState label={s.t('profile.loading')} testID="cadet-loading" />
      ) : profile.status === 'error' ? (
        <LoadFailure state={profile} onRetry={profile.retry} notFoundTitle={s.t('profile.notFoundTitle')} notFoundMessage={s.t('profile.notFound')} testID="cadet" />
      ) : profile.data ? (
        <CadetProfileView
          data={profile.data}
          canRecord={canRecord}
          onScan={() => router.push('/field/scan')}
          onOpenRecord={(sessionId) => router.push({ pathname: '/field/cadets/[cadetId]/assess', params: { cadetId: profile.data!.cadet.id, record: sessionId } })}
          canVoid={canVoid}
          onProposeRank={canProposeRank ? () => router.push({ pathname: '/field/rank/[cadetId]', params: { cadetId: profile.data!.cadet.id } }) : undefined}
          voidState={voidCmd.state}
          onVoid={voidCmd.open}
          onRetryVoid={() => {
            const who = profile.status === 'ready' && profile.data ? profile.data.cadet.firstName : '';
            void voidCmd.retryLast().then((ok) => (ok ? (voidCmd.finish(who), retry()) : retry()));
          }}
          onAssess={() => {
            const d = profile.data!;
            if (!d.today) return;
            rememberAssessTarget({ checkInOperationId: d.today.checkInOperationId, cadetId: d.cadet.id, cadetName: d.cadet.name });
            router.push({ pathname: '/field/cadets/[cadetId]/assess', params: { cadetId: d.cadet.id, op: d.today.checkInOperationId } });
          }}
        />
      ) : null}
      <ReasonSheet
        visible={voidCmd.sheetOpen && !!today}
        title={s.t('profile.voidTitle')}
        description={s.t('profile.voidBody')}
        submitLabel={s.t('profile.voidSubmit')}
        onCancel={voidCmd.close}
        onSubmit={(reason) => {
          if (!today || profile.status !== 'ready' || !profile.data) return;
          const who = profile.data.cadet.firstName;
          void voidCmd.submit(today.checkInId, reason).then((ok) => {
            if (ok) voidCmd.finish(who);
            // success or a definite refusal: reload so the buttons match the server (a lost reply keeps the screen)
            if (ok || voidCmd.lastWasDefinite()) retry();
          });
        }}
        testID="void-reason"
      />
    </GlassScreen>
  );
}

/**
 * FO-06 → FO-16 → field_void_check_in. One operation id per (check-in, reason): a retry after a lost reply resends the
 * same id, so the server answers with the first result instead of voiding twice.
 */
export function useVoidCheckIn(commands: FieldCommandRepository | undefined, makeId: () => string = newOperationId) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [state, setState] = useState<VoidState>({ kind: 'idle' });
  const latch = useRef<OperationLatch | null>(null);
  // the request a "Retry" resends after a lost reply (same check-in, same reason → same operation id)
  const last = useRef<{ checkInId: string; reason: string } | null>(null);
  const definite = useRef(false);
  const submit = async (checkInId: string, reason: string): Promise<boolean> => {
    if (!commands?.voidCheckIn) return false;
    setSheetOpen(false);
    setState({ kind: 'busy' });
    last.current = { checkInId, reason };
    definite.current = false;
    latch.current = latchOperation(latch.current, `${checkInId}|${reason}`, makeId);
    try {
      await commands.voidCheckIn({ checkInId, reason, operationId: latch.current.operationId });
      latch.current = null;
      last.current = null;
      definite.current = true;
      return true;
    } catch (e) {
      const error = toCommandError(e, 'void');
      // a definite answer ends this attempt; only a network failure keeps the id (and the reason) for a safe retry
      if (!error.retryable) {
        latch.current = null;
        last.current = null;
        definite.current = true;
      }
      setState({ kind: 'error', error, retryable: error.retryable });
      return false;
    }
  };
  return {
    sheetOpen,
    state,
    open: () => setSheetOpen(true),
    close: () => setSheetOpen(false),
    submit,
    retryLast: async () => (last.current ? submit(last.current.checkInId, last.current.reason) : false),
    lastWasDefinite: () => definite.current,
    finish: (name: string) => setState({ kind: 'done', name }),
  };
}

const styles = StyleSheet.create({
  identity: { gap: space.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  group: { gap: space.sm },
  groupTitle: { paddingHorizontal: space.xs },
  todayCard: { padding: space.lg, gap: space.md },
  pad: { paddingHorizontal: space.lg },
});
