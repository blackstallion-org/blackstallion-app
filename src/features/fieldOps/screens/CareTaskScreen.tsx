// FO-10 Care task: instructions → live proof photo (FO-04 capture contract) → location with accuracy → send through the
// G5 outbox. The result is what the server said: received, or received and routed to a supervisor. Nothing reads
// "Done" until a supervisor accepted it (occurrence completed).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { registerCapture, type CaptureResult } from '@/features/capture/contract';
import { AppText } from '@/ui/components/AppText';
import { GlassButton, GlassDialog, GlassScreen, ListGroup, Row, StatusBadge, StatusNote, UnavailableState, type StatusTone } from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import type { CarePhoto, FieldOpsRepositories, OutboxOwner } from '../data/repositories';
import { CARE_ACCURACY_HINT_M, careReasonKey, careTaskView, formatAccuracy, type CarePhase } from '../domain/evidence';
import { addDays, findOccurrence, localDateIn } from '../domain/horses';
import { safeId } from '../domain/review';
import type { FieldOpsScope } from '../domain/types';
import { backOr, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { expoLocationPort, type LocationPort } from '../permissions/location';
import { useLocationEvidence } from '../permissions/useLocationEvidence';
import { LocationAction, LocationRow } from './LocationPanel';
import { NotConnected, Provenance, ResourceGate, TASK_ICON } from './parts';

const TZ = 'Asia/Kolkata';

const PHASE: Record<CarePhase, { key: string; tone: StatusTone } | null> = {
  ready: null,
  cancelled: { key: 'fo.task.phase.cancelled', tone: 'neutral' },
  completed: { key: 'fo.task.phase.completed', tone: 'success' },
  saved: { key: 'fo.task.phase.saved', tone: 'info' },
  sending: { key: 'fo.task.phase.sending', tone: 'info' },
  received: { key: 'fo.task.phase.received', tone: 'info' },
  review_required: { key: 'fo.task.phase.review', tone: 'warning' },
  rejected: { key: 'fo.task.phase.rejected', tone: 'danger' },
  needs_action: { key: 'fo.task.phase.needsAction', tone: 'danger' },
};

export function CareTaskRoute() {
  const params = useLocalSearchParams<{ taskId?: string }>();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field/horses');
  const header = { onBack: back, title: t.t('fo.task.screenTitle'), backLabel: t.t('fo.common.back') };
  if (!ctx.repos) return <NotConnected t={t} header={header} testID="fo10-task" />;
  const taskId = safeId(params.taskId);
  if (!taskId) {
    return (
      <GlassScreen header={header} testID="fo10-task">
        <UnavailableState title={t.t('fo.common.notFoundTitle')} message={t.t('fo.task.notFound')} testID="fo10-notfound" />
      </GlassScreen>
    );
  }
  return (
    <CareTaskView
      repos={ctx.repos}
      scope={ctx.scope}
      owner={ctx.owner}
      contextKey={ctx.contextKey}
      taskId={taskId}
      t={t}
      onBack={back}
      onOpenSync={() => router.push('/field/sync')}
      takePhoto={async (purpose) => {
        const { token, result } = registerCapture({ mode: 'care_photo', purpose });
        router.push({ pathname: '/field/capture', params: { token } });
        return result;
      }}
    />
  );
}

export function CareTaskView({
  repos,
  scope,
  owner,
  contextKey,
  taskId,
  t,
  now = Date.now,
  location = expoLocationPort,
  takePhoto,
  onBack,
  onOpenSync,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  owner: OutboxOwner;
  contextKey: string;
  taskId: string;
  t: Translator;
  now?: () => number;
  location?: LocationPort;
  takePhoto: (purpose: string) => Promise<CaptureResult | null>;
  onBack: () => void;
  onOpenSync: () => void;
}) {
  const today = localDateIn(now(), TZ);
  const { items: queue } = useOutbox(repos.outbox, owner);
  const r = useFieldResource(`${contextKey}:fo:task:${taskId}:${today}`, async () => {
    const timeline = await repos.care.timeline(scope, addDays(today, -1), addDays(today, 1));
    return { timeline, occurrence: findOccurrence(timeline, taskId) };
  });
  const loc = useLocationEvidence(location, t, 'fo.location.purposeCare');
  const [photo, setPhoto] = useState<(CarePhoto & { at: number }) | null>(null);
  const [confirmResend, setConfirmResend] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const footerReady = r.status === 'ready' && r.data.occurrence !== null;
  // leaving with a photo that was not sent loses it: ask first (the only unsaved loss on this screen)
  const back = () => (photo ? setConfirmLeave(true) : onBack());

  return (
    <GlassScreen header={{ onBack: back, title: t.t('fo.task.screenTitle'), backLabel: t.t('fo.common.back') }} testID="fo10-task">
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={r} t={t} loadingLabel={t.t('fo.task.loading')} notFoundMessage={t.t('fo.task.notFound')} testIDPrefix="fo10">
        {({ timeline, occurrence: occ }) => {
          if (timeline.kind !== 'ok') return <UnavailableState title={t.t('fo.task.notAssignedTitle')} message={t.t('fo.task.notAssigned')} testID="fo10-not-assigned" />;
          if (!occ) return <UnavailableState title={t.t('fo.common.notFoundTitle')} message={t.t('fo.task.notFound')} testID="fo10-notfound" />;
          const view = careTaskView(occ, queue);
          const phase = PHASE[view.phase];
          const task = t.t(`care.taskType.${occ.taskType}`);
          const capture = async () => {
            setSendError(null);
            const res = await takePhoto(t.t('fo.task.capturePurpose', { horse: occ.horseName, task }));
            if (res) setPhoto({ uri: res.uri, mimeType: res.mimeType, at: Date.parse(res.capturedAt) || now() });
          };
          const startCapture = () => (view.warnAlreadySent && !photo ? setConfirmResend(true) : capture());
          const send = async () => {
            if (!photo) return;
            setSendError(null);
            const res = await repos.outbox.captureCare(owner, {
              occurrenceId: occ.occurrenceId,
              horseId: occ.horseId,
              photo,
              observedAt: photo.at,
              location: loc.reading,
            });
            if (res.ok) setPhoto(null);
            else setSendError(t.t(`fo.task.sendError.${res.error}`));
          };
          const reasons = view.reviewReasons.map((x) =>
            t.t(careReasonKey(x), { accuracy: formatAccuracy((view.item?.payload.location as { accuracyM?: number | null } | null)?.accuracyM) ?? '' }),
          );
          return (
            <View style={styles.stack}>
              {/* Back/horse/task → instructions/due time: flat, no card */}
              <View style={styles.summary} testID="fo10-summary">
                <AppText variant="secondary" tone="accent">
                  {occ.horseName}
                </AppText>
                <AppText variant="title" header>
                  {task}
                </AppText>
                <AppText tone="muted">{t.t('care.timeline.dueAt', { time: t.time(occ.dueAt, occ.timezone) })}</AppText>
                {phase ? <StatusBadge label={t.t(phase.key)} tone={phase.tone} testID="fo10-phase" /> : null}
              </View>
              {occ.taskType === 'medication' ? <StatusNote tone="warning" message={t.t('care.medication.notice')} /> : null}
              <View style={styles.section}>
                <AppText variant="secondary" tone="muted" header>
                  {t.t('fo.task.instructionsTitle')}
                </AppText>
                <AppText testID="fo10-instructions">{occ.instructions || t.t('fo.task.noInstructions')}</AppText>
              </View>
              <ResultPanel phase={view.phase} t={t} durability={repos.outbox.durability} receivedAt={view.receivedAt} reasons={reasons} onOpenSync={onOpenSync} />
              {view.canCapture ? (
                <>
                  {/* evidence slot + location and accuracy: one glass group of flat rows */}
                  <ListGroup title={t.t('fo.task.evidenceTitle')} testID="fo10-evidence">
                    {photo ? (
                      <View style={styles.photoRow} testID="fo10-photo">
                        <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel={t.t('fo.task.photoTaken')} />
                        <View style={styles.photoText}>
                          <AppText variant="bodyStrong">{t.t('fo.task.photoTaken')}</AppText>
                          <AppText variant="secondary" tone="muted">
                            {t.t('fo.task.photoAt', { time: t.time(photo.at, TZ) })}
                          </AppText>
                        </View>
                      </View>
                    ) : (
                      <Row icon={TASK_ICON[occ.taskType]} label={t.t('fo.task.photoNeeded')} value={t.t('fo.task.photoLive')} testID="fo10-photo" />
                    )}
                    <LocationRow loc={loc} t={t} maxAccuracyM={CARE_ACCURACY_HINT_M} testID="fo10-location-row" />
                  </ListGroup>
                  <View style={styles.quiet}>
                    <LocationAction loc={loc} t={t} testID="fo10-location" />
                    {photo ? <GlassButton variant="ghost" icon="camera-outline" label={t.t('fo.task.retake')} onPress={startCapture} testID="fo10-retake" /> : null}
                  </View>
                  <AppText variant="secondary" tone="muted" testID="fo10-notes">
                    {t.t('fo.task.notesUnavailable')}
                  </AppText>
                  {sendError ? <StatusNote tone="danger" message={sendError} testID="fo10-send-error" /> : null}
                  {/* one dominant action: take the photo, then send it */}
                  {photo ? (
                    <GlassButton label={t.t('fo.task.send')} icon="cloud-upload-outline" disabled={!footerReady} onPress={send} accessibilityHint={t.t('fo.task.sendHint')} testID="fo10-send" />
                  ) : (
                    <>
                      <GlassButton label={t.t('fo.task.takePhoto')} icon="camera-outline" onPress={startCapture} testID="fo10-take-photo" />
                      <AppText variant="secondary" tone="muted" align="center">
                        {t.t('fo.task.sendNeedsPhoto')}
                      </AppText>
                    </>
                  )}
                </>
              ) : null}
              <GlassDialog
                visible={confirmResend}
                onClose={() => setConfirmResend(false)}
                title={t.t('fo.task.resendTitle')}
                message={t.t('fo.task.resendBody')}
                testID="fo10-resend-dialog"
                actions={
                  <>
                    <GlassButton variant="secondary" label={t.t('common.action.cancel')} onPress={() => setConfirmResend(false)} testID="fo10-resend-cancel" />
                    <GlassButton
                      label={t.t('fo.task.resendConfirm')}
                      icon="camera-outline"
                      onPress={() => {
                        setConfirmResend(false);
                        void capture();
                      }}
                      testID="fo10-resend-confirm"
                    />
                  </>
                }
              />
            </View>
          );
        }}
      </ResourceGate>
      {loc.primer}
      <GlassDialog
        visible={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={t.t('fo.task.leaveTitle')}
        message={t.t('fo.task.leaveBody')}
        testID="fo10-leave-dialog"
        actions={
          <>
            <GlassButton variant="secondary" label={t.t('fo.task.leaveStay')} onPress={() => setConfirmLeave(false)} testID="fo10-leave-stay" />
            <GlassButton
              variant="destructive"
              icon="trash-outline"
              label={t.t('fo.task.leaveConfirm')}
              onPress={() => {
                setConfirmLeave(false);
                setPhoto(null);
                onBack();
              }}
              testID="fo10-leave-confirm"
            />
          </>
        }
      />
    </GlassScreen>
  );
}

function ResultPanel({
  phase,
  t,
  durability,
  receivedAt,
  reasons,
  onOpenSync,
}: {
  phase: CarePhase;
  t: Translator;
  durability: 'durable' | 'memory';
  receivedAt: string | null;
  reasons: string[];
  onOpenSync: () => void;
}) {
  const at = receivedAt ? t.time(Date.parse(receivedAt), TZ) : null;
  switch (phase) {
    case 'saved':
      return <StatusNote tone="info" title={t.t('fo.task.phase.saved')} message={durability === 'durable' ? t.t('fo.task.savedDurable') : t.t('fo.task.savedMemory')} testID="fo10-result" />;
    case 'sending':
      return <StatusNote tone="info" title={t.t('fo.task.phase.sending')} message={t.t('fo.task.sendingBody')} testID="fo10-result" />;
    case 'received':
      return <StatusNote tone="info" title={t.t('fo.task.phase.received')} message={at ? t.t('fo.task.receivedAt', { time: at }) : t.t('fo.task.receivedBody')} testID="fo10-result" />;
    case 'review_required':
      return (
        <StatusNote
          tone="warning"
          title={t.t('fo.task.phase.review')}
          message={[at ? t.t('fo.task.receivedAt', { time: at }) : null, ...reasons].filter(Boolean).join(' ')}
          testID="fo10-result"
        />
      );
    case 'completed':
      return <StatusNote tone="success" title={t.t('fo.task.phase.completed')} message={t.t('fo.task.completedBody')} testID="fo10-result" />;
    case 'rejected':
      return <StatusNote tone="danger" title={t.t('fo.task.phase.rejected')} message={t.t('fo.task.rejectedBody')} testID="fo10-result" />;
    case 'cancelled':
      return <StatusNote tone="info" title={t.t('fo.task.phase.cancelled')} message={t.t('fo.task.cancelledBody')} testID="fo10-result" />;
    case 'needs_action':
      return (
        <View style={{ gap: space.sm }}>
          <StatusNote tone="danger" title={t.t('fo.task.phase.needsAction')} message={t.t('fo.task.needsActionBody')} testID="fo10-result" />
          <GlassButton variant="secondary" icon="sync-outline" label={t.t('fo.task.openSync')} onPress={onOpenSync} testID="fo10-open-sync" />
        </View>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  summary: { gap: space.xs },
  section: { gap: space.xs },
  quiet: { gap: space.xs },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  thumb: { width: 72, height: 72, borderRadius: radius.control },
  photoText: { flex: 1, gap: 2 },
});
