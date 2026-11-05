// FO-11 Shift check-in: the current shift, punch in (queued with the observed time and location evidence; the server
// stamps its own time) and punch out (online only), the accuracy the phone reported and the policy-driven proof.
// Weak GPS goes to review; a punch-in is never shown as "verified presence".
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { AppText } from '@/ui/components/AppText';
import { GlassButton, GlassScreen, ListGroup, Row, StatusBadge, StatusNote, type StatusTone } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories, OutboxOwner } from '../data/repositories';
import { formatAccuracy, pendingPunchIn, PUNCH_RADIUS_M, punchOutcome, punchReasonKey, type PunchOutcome } from '../domain/evidence';
import type { FieldOpsScope, ShiftRecord } from '../domain/types';
import { backOr, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { expoLocationPort, type LocationPort } from '../permissions/location';
import { useLocationEvidence } from '../permissions/useLocationEvidence';
import { LocationAction, LocationRow } from './LocationPanel';
import { ErrorBody, NotConnected, Provenance, ResourceGate } from './parts';

const OUTCOME_TONE: Record<PunchOutcome, StatusTone> = {
  pending: 'info',
  recorded: 'success',
  needs_review: 'warning',
  review_accepted: 'success',
  review_rejected: 'danger',
};

export function ShiftRoute() {
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field');
  if (!ctx.repos) return <NotConnected t={t} header={{ onBack: back, title: t.t('fo.shift.title') }} testID="fo11-shift" />;
  // UX only (snapshot capability); the server refuses punches from anyone but INSTRUCTOR/GROOM with a hub
  const allowed = ctx.capabilities ? ctx.capabilities.punchIn === true : ctx.scope.role === 'INSTRUCTOR' || ctx.scope.role === 'GROOM' || ctx.scope.role === null;
  return <ShiftView repos={ctx.repos} scope={ctx.scope} owner={ctx.owner} contextKey={ctx.contextKey} allowed={allowed} t={t} onBack={back} onOpenSync={() => router.push('/field/sync')} />;
}

export function ShiftView({
  repos,
  scope,
  owner,
  contextKey,
  allowed,
  t,
  location = expoLocationPort,
  now = Date.now,
  onBack,
  onOpenSync,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  owner: OutboxOwner;
  contextKey: string;
  allowed: boolean;
  t: Translator;
  location?: LocationPort;
  now?: () => number;
  onBack: () => void;
  onOpenSync: () => void;
}) {
  const { items: queue, online } = useOutbox(repos.outbox, owner);
  const r = useFieldResource(allowed ? `${contextKey}:fo:shift` : null, () => repos.shift.status(scope));
  const loc = useLocationEvidence(location, t, 'fo.location.purposeShift');
  const [outError, setOutError] = useState<FieldCommandError | null>(null);
  const pending = pendingPunchIn(queue);
  const acked = queue.filter((q) => q.commandType === 'shift.punchIn' && q.state === 'acknowledged');
  // refresh the server view once a queued punch-in is acknowledged
  const lastAck = acked.length ? acked[acked.length - 1]!.operationId : null;
  const seen = useRef(lastAck);
  const { retry } = r;
  useEffect(() => {
    if (lastAck && lastAck !== seen.current) {
      seen.current = lastAck;
      retry();
    }
  }, [lastAck, retry]);

  const header = { onBack, title: t.t('fo.shift.title'), backLabel: t.t('fo.common.back') };
  if (!allowed) {
    return (
      <GlassScreen header={header} testID="fo11-shift">
        <ErrorBody error={new FieldCommandError('forbidden', '')} t={t} deniedMessage={t.t('fo.shift.denied')} testIDPrefix="fo11" />
      </GlassScreen>
    );
  }

  const punchIn = async () => {
    await repos.outbox.queuePunchIn(owner, { observedAt: now(), location: loc.reading });
  };
  const punchOut = async (rec: ShiftRecord) => {
    setOutError(null);
    try {
      await repos.shift.punchOut(scope, rec.attendanceId);
      r.retry();
    } catch (e) {
      setOutError(e instanceof FieldCommandError ? e : new FieldCommandError('unexpected', ''));
    }
  };

  return (
    <GlassScreen header={header} testID="fo11-shift">
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={r} t={t} loadingLabel={t.t('fo.shift.loading')} deniedMessage={t.t('fo.shift.denied')} testIDPrefix="fo11">
        {(s, meta) => {
          const open = s.open;
          const outcome: PunchOutcome | null = pending ? 'pending' : open ? punchOutcome(open, s.thresholdM) : null;
          return (
            <View style={{ gap: space.xl }}>
              <View style={styles.current} testID="fo11-current">
                  <AppText variant="secondary" tone="muted">
                    {t.t('fo.shift.current')}
                  </AppText>
                  <AppText variant="score" testID="fo11-current-time">
                    {pending ? t.t('fo.shift.pendingTitle') : open ? t.time(Date.parse(open.punchInAt), 'Asia/Kolkata') : t.t('fo.shift.notIn')}
                  </AppText>
                  {outcome ? <StatusBadge label={t.t(`fo.shift.badge.${outcome}`)} tone={OUTCOME_TONE[outcome]} testID="fo11-outcome" /> : null}
                  <AppText tone="muted">
                    {pending
                      ? repos.outbox.durability === 'durable'
                        ? t.t('fo.shift.pendingDurable', { time: t.time(pending.observedAt, 'Asia/Kolkata') })
                        : t.t('fo.shift.pendingMemory', { time: t.time(pending.observedAt, 'Asia/Kolkata') })
                      : open
                        ? t.t('fo.shift.openBody', { time: t.time(Date.parse(open.punchInAt), 'Asia/Kolkata'), observed: open.observedAt ? t.time(Date.parse(open.observedAt), 'Asia/Kolkata') : '—' })
                        : t.t('fo.shift.notInBody')}
                  </AppText>
              </View>
              {open && !pending ? <OpenShiftEvidence rec={open} thresholdM={s.thresholdM} t={t} /> : null}
              {pending && pending.state !== 'ready' && pending.state !== 'leased' && pending.state !== 'submitting' ? (
                <View style={{ gap: space.sm }}>
                  <StatusNote tone="warning" message={t.t('fo.shift.pendingStuck')} testID="fo11-pending-stuck" />
                  <GlassButton variant="secondary" icon="sync-outline" label={t.t('fo.task.openSync')} onPress={onOpenSync} />
                </View>
              ) : null}
              {!open && !pending ? (
                <>
                  {/* location status and accuracy → policy-driven proof: one group of flat rows */}
                  <ListGroup title={t.t('fo.shift.locationTitle')} testID="fo11-proof">
                    <LocationRow loc={loc} t={t} maxAccuracyM={s.thresholdM ?? PUNCH_RADIUS_M} testID="fo11-location-row" />
                    <Row icon="camera-outline" label={t.t('fo.shift.photoProof')} value={t.t(`fo.shift.photo.${s.photoProof}`)} />
                    <Row
                      icon="shield-outline"
                      label={t.t('fo.shift.reviewRule')}
                      value={s.thresholdM == null ? t.t('fo.shift.reviewAllBody') : t.t('fo.shift.reviewThresholdBody', { meters: s.thresholdM })}
                    />
                  </ListGroup>
                  <LocationAction loc={loc} t={t} testID="fo11-location" />
                  <GlassButton label={t.t('fo.shift.punchIn')} icon="log-in-outline" onPress={punchIn} testID="fo11-punch-in" />
                  <AppText variant="secondary" tone="muted" align="center">
                    {t.t('fo.shift.punchInHint')}
                  </AppText>
                </>
              ) : null}
              {open && !pending ? (
                <View style={{ gap: space.sm }}>
                  {outError ? <ErrorBody error={outError} t={t} testIDPrefix="fo11-out" /> : null}
                  <GlassButton label={t.t('fo.shift.punchOut')} icon="log-out-outline" onPress={() => punchOut(open)} disabled={!online || meta.stale} testID="fo11-punch-out" />
                  <AppText variant="secondary" tone="muted" align="center">
                    {online && !meta.stale ? t.t('fo.shift.punchOutHint') : t.t('fo.shift.punchOutOffline')}
                  </AppText>
                </View>
              ) : null}
              {s.recent.filter((x) => x.attendanceId !== open?.attendanceId).length > 0 ? (
                <ListGroup title={t.t('fo.shift.recentTitle')} material="thin" testID="fo11-recent">
                  {s.recent
                    .filter((x) => x.attendanceId !== open?.attendanceId)
                    .map((x) => {
                      const o = punchOutcome(x, s.thresholdM);
                      return (
                        <Row
                          key={x.attendanceId}
                          icon="calendar-outline"
                          label={`${t.date(Date.parse(x.punchInAt), 'Asia/Kolkata')} · ${t.time(Date.parse(x.punchInAt), 'Asia/Kolkata')}–${x.punchOutAt ? t.time(Date.parse(x.punchOutAt), 'Asia/Kolkata') : '—'}`}
                          value={formatAccuracy(x.accuracyM) ?? t.t('fo.location.none')}
                          trailing={<StatusBadge label={t.t(`fo.shift.badge.${o}`)} tone={OUTCOME_TONE[o]} />}
                        />
                      );
                    })}
                </ListGroup>
              ) : null}
            </View>
          );
        }}
      </ResourceGate>
      {loc.primer}
    </GlassScreen>
  );
}

function OpenShiftEvidence({ rec, thresholdM, t }: { rec: ShiftRecord; thresholdM: number | null; t: Translator }) {
  const o = punchOutcome(rec, thresholdM);
  return (
    <>
      <ListGroup title={t.t('fo.shift.evidenceTitle')} testID="fo11-evidence">
        <Row icon="locate-outline" label={t.t('fo.shift.accuracy')} value={formatAccuracy(rec.accuracyM) ?? t.t('fo.location.none')} />
        <Row icon="navigate-outline" label={t.t('fo.shift.distance')} value={rec.distanceM != null ? t.t('fo.shift.meters', { meters: Math.round(rec.distanceM) }) : t.t('fo.shift.distanceUnknown')} />
        <Row icon="server-outline" label={t.t('fo.shift.recordedBy')} value={t.time(Date.parse(rec.punchInAt), 'Asia/Kolkata')} />
      </ListGroup>
      {o === 'needs_review' ? <StatusNote tone="warning" title={t.t('fo.shift.badge.needs_review')} message={t.t(punchReasonKey(rec.verificationState, thresholdM), { meters: thresholdM ?? PUNCH_RADIUS_M })} testID="fo11-review-note" /> : null}
      {rec.review ? (
        <StatusNote
          tone={rec.review.decision === 'accepted' ? 'success' : 'danger'}
          title={t.t(`fo.shift.badge.review_${rec.review.decision}`)}
          message={t.t('fo.shift.reviewDecisionBody', { reason: rec.review.reason })}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  current: { gap: space.sm },
});
