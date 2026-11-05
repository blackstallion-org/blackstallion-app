import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useScopedResource, type ResourceState } from '@/core/data/useScopedResource';
import { registerCapture, type CaptureResult } from '@/features/capture/contract';
import { AppText } from '@/ui/components';
import {
  Chip,
  EmptyState,
  GlassButton,
  GlassInput,
  GlassScreen,
  GlassSurface,
  LoadingState,
  StatusBadge,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
} from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { recallAssessTarget, rememberAssessTarget, type AssessTarget } from './assessHandoff';
import { clearDraft, readDraft, writeDraft } from './assessDrafts';
import { LoadFailure } from './components/LoadStates';
import { PublicationSeal } from './components/PublicationSeal';
import { ScoreStepper } from './components/ScoreStepper';
import type { ConsentValue, FieldCommandRepository, Skill } from './data/repositories';
import {
  assessmentPayloadKey,
  codePointLength,
  emptyDraft,
  NOTES_MAX,
  SCORE_KEYS,
  SKILLS_MAX,
  validateAssessment,
  type AssessmentDraft,
  type AssessmentErrors,
} from './domain/assessment';
import { toCommandError, type FieldCommandError } from './domain/commandErrors';
import { isUuid, latchOperation, newOperationId, type OperationLatch } from './domain/operation';
import type { FieldWorkflowRepository, PublishResult } from './domain/workflow';
import { useFieldStrings, type FieldTranslator } from './i18n';
import { SessionRecordScreen } from './SessionRecordView';
import { commandMessage } from './useCheckIn';
import { useFieldAccess } from './useFieldAccess';

type Clip = { clipId: string; capture: CaptureResult };
type Status =
  | { kind: 'editing' }
  | { kind: 'uploading' }
  | { kind: 'busy' }
  | { kind: 'done'; result: PublishResult }
  | { kind: 'error'; error: FieldCommandError };

export type SkillsState = ResourceState<Skill[]>;

export type AssessSessionViewProps = {
  repo?: FieldWorkflowRepository | FieldCommandRepository;
  target: AssessTarget | null;
  onDone: () => void;
  /** "Next cadet" after the seal (back to the scanner). */
  onNext?: () => void;
  onBack?: () => void;
  makeId?: () => string;
  skills?: SkillsState;
  /** Session-video consent for this cadet (`allowed` only when granted under the current wording). */
  consent?: ResourceState<ConsentValue>;
  onRetryConsent?: () => void;
  /** Asked again right before a clip is uploaded; a withdrawn consent drops the clip. */
  recheckConsent?: () => Promise<ConsentValue>;
  /** Role may record clips (capability uploadSessionVideo). */
  canRecordVideo?: boolean;
  /** Opens FO-04 in session-video mode; resolves with the clip or null when cancelled. */
  onRecordClip?: (consentConfirmed: boolean) => Promise<CaptureResult | null>;
  hubId?: string | null;
  /** In-memory draft key; drafts are kept while the app is open. */
  draftKey?: string;
  isPreview?: boolean;
};

const fmtDuration = (ms?: number) => {
  if (!ms || ms <= 0) return '';
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

function scoreErrors(errors: AssessmentErrors, s: FieldTranslator): AssessmentErrors {
  const out: AssessmentErrors = {};
  for (const k of SCORE_KEYS) if (errors[k]) out[k] = s.t('assess.scoreMissing', { label: s.t(`scores.${k}`).toLowerCase() });
  if (errors.notes) out.notes = s.t('assess.notesLong', { max: NOTES_MAX });
  if (errors.skills) out.skills = s.t('assess.skillsMax', { max: SKILLS_MAX });
  return out;
}

/** Skill chips grouped by category; empty catalogue → honest "not set up yet" (D16 unsigned). */
function SkillPicker({ state, selected, disabled, onToggle, error }: { state?: SkillsState; selected: readonly string[]; disabled: boolean; onToggle: (id: string) => void; error?: string }) {
  const s = useFieldStrings();
  const title = (
    <AppText variant="secondary" tone="muted" header style={styles.groupTitle}>
      {s.t('assess.skills')}
    </AppText>
  );
  if (!state || state.status === 'loading') {
    return state ? <LoadingState label={s.t('assess.skillsLoading')} rows={1} /> : null;
  }
  if (state.status === 'error') return <StatusNote tone="info" message={s.t('assess.skillsFailed')} testID="skills-failed" />;
  if (state.data.length === 0) {
    return (
      <View style={styles.group}>
        {title}
        <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.cardPad}>
          <EmptyState icon="list-outline" title={s.t('assess.skillsNone')} message={s.t('assess.skillsNoneBody')} testID="skills-empty" />
        </GlassSurface>
      </View>
    );
  }
  const ORDER = ['RIDING', 'GROUND', 'STABLE'];
  const rank = (c: string) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);
  const cats = Array.from(new Set(state.data.map((k) => k.category))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return (
    <View style={styles.group} testID="skills">
      {title}
      <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.cardPad, styles.skillsCard]}>
        {cats.map((c) => (
          <View key={c} style={styles.skillCat}>
            <AppText variant="secondary" tone="muted">
              {s.has(`assess.category.${c}`) ? s.t(`assess.category.${c}`) : c}
            </AppText>
            <View style={styles.chips}>
              {state.data
                .filter((k) => k.category === c)
                .map((k) => (
                  <Chip key={k.id} label={k.name} selected={selected.includes(k.id)} icon={selected.includes(k.id) ? 'checkmark' : undefined} onPress={() => !disabled && onToggle(k.id)} testID={`skill-${k.id}`} />
                ))}
            </View>
          </View>
        ))}
        {error ? (
          <AppText tone="danger" variant="secondary">
            {error}
          </AppText>
        ) : null}
      </GlassSurface>
    </View>
  );
}

/** Consent-aware clip card: Record only when consent is allowed, the role may record and upload is connected. */
function ClipCard({
  consent,
  canRecordVideo,
  uploadConnected,
  clip,
  locked,
  onRecord,
  onRemove,
  onRetryConsent,
}: {
  consent?: ResourceState<ConsentValue>;
  canRecordVideo: boolean;
  uploadConnected: boolean;
  clip: Clip | null;
  locked: boolean;
  onRecord: () => void;
  onRemove: () => void;
  onRetryConsent?: () => void;
}) {
  const s = useFieldStrings();
  const value = consent?.status === 'ready' ? consent.data : consent?.status === 'error' ? 'unknown' : null;
  let body;
  if (!canRecordVideo) body = <StatusNote tone="info" message={s.t('assess.noVideoRole')} />;
  else if (!uploadConnected) body = <StatusNote tone="info" message={s.t('assess.clipNoUpload')} testID="clip-no-upload" />;
  else if (value === null) body = <AppText tone="muted">{s.t('assess.consentChecking')}</AppText>;
  else if (value === 'off')
    body = <StatusNote tone="warning" title={s.t('assess.recordingOff')} message={s.t('assess.recordingOffBody')} testID="recording-off" />;
  else if (value === 'unknown')
    body = (
      <>
        <StatusNote tone="warning" title={s.t('assess.recordingOff')} message={s.t('assess.consentUnknown')} testID="recording-unknown" />
        {onRetryConsent ? <GlassButton variant="secondary" icon="refresh" label={s.t('common.retry')} onPress={onRetryConsent} /> : null}
      </>
    );
  else if (clip)
    body = (
      <>
        <StatusBadge label={s.t('assess.clipSaved', { duration: fmtDuration(clip.capture.durationMs) || '0:10' })} tone="success" icon="videocam" testID="clip-attached" />
        <AppText variant="secondary" tone="muted">
          {s.t('assess.clipNotSent')}
        </AppText>
        <View style={styles.rowButtons}>
          <GlassButton variant="secondary" fullWidth={false} icon="refresh" label={s.t('assess.clipRetake')} disabled={locked} onPress={onRecord} testID="clip-retake" />
          <GlassButton variant="ghost" fullWidth={false} icon="trash-outline" label={s.t('assess.clipRemove')} disabled={locked} onPress={onRemove} testID="clip-remove" />
        </View>
      </>
    );
  else
    body = (
      <>
        <AppText tone="muted">{s.t('assess.clipBody')}</AppText>
        <GlassButton variant="secondary" icon="videocam-outline" label={s.t('assess.recordClip')} disabled={locked} onPress={onRecord} testID="record-clip" />
      </>
    );
  return (
    <View style={styles.group}>
      <AppText variant="secondary" tone="muted" header style={styles.groupTitle}>
        {s.t('assess.clip')}
      </AppText>
      <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.cardPad, styles.clipCard]}>
        {body}
      </GlassSurface>
    </View>
  );
}

/**
 * FO-03 Assessment (today): three scores, skills from the configured catalogue, notes, consent-aware clip, then
 * Publish. Draft → (uploading clip) → publishing → seal. The seal and "Published" appear only after the server's
 * receipt; a lost reply freezes the values and retries the SAME operation, so it can never publish twice.
 */
export function AssessSessionView({
  repo,
  target,
  onDone,
  onNext,
  onBack,
  makeId = newOperationId,
  skills,
  consent,
  onRetryConsent,
  recheckConsent,
  canRecordVideo = false,
  onRecordClip,
  hubId,
  draftKey,
  isPreview = false,
}: AssessSessionViewProps) {
  const s = useFieldStrings();
  const [draft, setDraftState] = useState<AssessmentDraft>(() => readDraft(draftKey)?.draft ?? emptyDraft());
  const [clip, setClipState] = useState<Clip | null>(() => readDraft(draftKey)?.clip ?? null);
  const [errors, setErrors] = useState<AssessmentErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  const [notice, setNotice] = useState<string | null>(null);
  // One operation id per exact payload: a retry after a lost reply is a replay, an edited payload is a new request.
  const latch = useRef<OperationLatch | null>(null);
  const objectPath = useRef<{ clipId: string; path: string } | null>(null);
  const draftRef = useRef({ draft, clip });
  useEffect(() => {
    draftRef.current = { draft, clip };
  }, [draft, clip]);

  const header = onBack ? { title: target?.cadetName ?? s.t('assess.title'), onBack, backLabel: s.t('common.back') } : undefined;

  if (!repo || !target) {
    return (
      <GlassScreen edges={['top', 'left', 'right', 'bottom']} header={header} testID="field-assess">
        <EmptyState
          icon="person-outline"
          title={repo ? s.t('assess.openFromToday') : s.t('common.notConnectedTitle')}
          message={repo ? s.t('assess.openFromTodayBody') : s.t('assess.notConnected')}
        />
        <GlassButton variant="secondary" label={s.t('assess.backToToday')} onPress={onDone} />
      </GlassScreen>
    );
  }

  const persist = (d: AssessmentDraft, c: Clip | null) => writeDraft(draftKey, { draft: d, clip: c });
  // After an unknown outcome (lost reply) the values are frozen: the only safe action is to resend the SAME payload.
  const locked = status.kind === 'busy' || status.kind === 'uploading' || (status.kind === 'error' && status.error.retryable);
  const set = <K extends keyof AssessmentDraft>(k: K, v: AssessmentDraft[K]) => {
    if (locked) return;
    setDraftState((d) => {
      const next = { ...d, [k]: v };
      persist(next, draftRef.current.clip);
      return next;
    });
    if (status.kind === 'error') setStatus({ kind: 'editing' });
  };
  const setClip = (c: Clip | null) => {
    if (locked) return;
    setClipState(c);
    persist(draftRef.current.draft, c);
  };
  const uploadClip = 'uploadClip' in repo ? repo.uploadClip : undefined;
  const consentValue = consent?.status === 'ready' ? consent.data : 'unknown';

  const record = async () => {
    if (!onRecordClip || locked) return;
    const r = await onRecordClip(consentValue === 'allowed');
    if (r) setClip({ clipId: makeId(), capture: r });
  };

  const publish = async () => {
    if (status.kind === 'busy' || status.kind === 'uploading') return;
    const v = validateAssessment(draft);
    if (!v.ok) {
      setErrors(scoreErrors(v.errors, s));
      return;
    }
    setErrors({});
    setNotice(null);
    let videoObject: string | null = null;
    let attachedClip = clip;
    if (attachedClip && uploadClip && hubId) {
      // Consent is checked again just before anything leaves the phone (the publish function doesn't check it yet, MIG9 R1).
      if (recheckConsent && (await recheckConsent().catch(() => 'unknown' as const)) !== 'allowed') {
        setClipState(null);
        persist(draft, null);
        attachedClip = null;
        setNotice(s.t('assess.consentWithdrawn'));
      }
    }
    if (attachedClip && uploadClip && hubId) {
      if (objectPath.current?.clipId === attachedClip.clipId) videoObject = objectPath.current.path;
      else {
        setStatus({ kind: 'uploading' });
        try {
          const r = await uploadClip({ hubId, cadetId: target.cadetId, clipId: attachedClip.clipId, uri: attachedClip.capture.uri, mimeType: attachedClip.capture.mimeType });
          objectPath.current = { clipId: attachedClip.clipId, path: r.objectPath };
          videoObject = r.objectPath;
        } catch (e) {
          setStatus({ kind: 'error', error: toCommandError(e, 'publish') });
          return;
        }
      }
    }
    latch.current = latchOperation(latch.current, assessmentPayloadKey(target.checkInOperationId, v.value, videoObject), makeId);
    const operationId = latch.current.operationId;
    setStatus({ kind: 'busy' });
    try {
      const result = await repo.publish({
        checkInOperationId: target.checkInOperationId,
        assessment: v.value,
        operationId,
        ...(videoObject ? { videoObject } : {}),
      });
      clearDraft(draftKey);
      setStatus({ kind: 'done', result });
    } catch (e) {
      const ce = toCommandError(e, 'publish');
      if (!ce.retryable) latch.current = null;
      setStatus({ kind: 'error', error: ce });
    }
  };

  if (status.kind === 'done') {
    return (
      <GlassScreen edges={['top', 'left', 'right', 'bottom']} header={header ? { ...header, onBack: onDone } : undefined} testID="field-assess">
        <View testID="publish-done" style={styles.done}>
          <PublicationSeal title={s.t('assess.seal.title')} caption={s.t('assess.seal.body', { name: target.cadetName })} testID="publication-seal" />
          <AppText variant="secondary" tone="muted" align="center">
            {s.t('assess.seal.receipt', { version: status.result.version })}
          </AppText>
        </View>
        {onNext ? <GlassButton size="large" icon="scan-outline" label={s.t('assess.seal.next')} onPress={onNext} testID="publish-next" /> : null}
        <GlassButton variant={onNext ? 'secondary' : 'primary'} label={s.t('assess.seal.done')} onPress={onDone} testID="publish-back" />
      </GlassScreen>
    );
  }

  const notesLength = codePointLength(draft.notes.trim());
  const footerLabel =
    status.kind === 'uploading' ? s.t('assess.uploading') : status.kind === 'error' && status.error.retryable ? s.t('assess.retryPublish') : s.t('assess.publish');
  return (
    <GlassScreen
      edges={['top', 'left', 'right', 'bottom']}
      header={header}
      keyboard
      testID="field-assess"
      footer={<GlassButton size="large" label={footerLabel} icon="send-outline" loading={status.kind === 'busy' || status.kind === 'uploading'} onPress={() => void publish()} testID="publish-submit" />}
    >
      {isPreview ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      <View style={styles.titleBlock}>
        <AppText variant="title" header>
          {target.cadetName}
        </AppText>
        <View style={styles.badges}>
          <StatusBadge label={s.t('assess.draftBadge')} tone="neutral" icon="create-outline" testID="draft-badge" />
        </View>
        <AppText variant="secondary" tone="muted">
          {s.t('assess.draftKept')}
        </AppText>
      </View>
      <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.cardPad, styles.scores]}>
        {SCORE_KEYS.map((k) => (
          <ScoreStepper key={k} k={k} value={draft[k]} error={errors[k]} disabled={locked} onChange={(v) => set(k, v)} />
        ))}
      </GlassSurface>
      <SkillPicker
        state={skills}
        selected={draft.skillIds}
        disabled={locked}
        error={errors.skills}
        onToggle={(id) => set('skillIds', draft.skillIds.includes(id) ? draft.skillIds.filter((x) => x !== id) : [...draft.skillIds, id])}
      />
      <GlassInput
        label={s.t('assess.notesLabel')}
        hint={s.t('assess.notesCount', { count: notesLength, max: NOTES_MAX })}
        value={draft.notes}
        onChangeText={(t) => set('notes', t)}
        multiline
        editable={!locked}
        maxLength={NOTES_MAX * 2}
        error={errors.notes ?? null}
        testID="assess-notes"
      />
      {onRecordClip || consent ? (
        <ClipCard
          consent={consent}
          canRecordVideo={canRecordVideo}
          uploadConnected={!!uploadClip && !!hubId}
          clip={clip}
          locked={locked}
          onRecord={() => void record()}
          onRemove={() => setClip(null)}
          onRetryConsent={onRetryConsent}
        />
      ) : null}
      {notice ? <StatusNote tone="warning" message={notice} testID="publish-notice" /> : null}
      {status.kind === 'error' ? (
        <StatusNote
          tone="danger"
          message={status.error.reference ? `${commandMessage(status.error, s)} (${s.t('common.reference', { ref: status.error.reference })})` : commandMessage(status.error, s)}
          testID="publish-error"
        />
      ) : null}
    </GlassScreen>
  );
}

/** Route `/field/cadets/[cadetId]/assess?op=<check-in operation id>` (today) or `?record=<session id>` (published). */
export function AssessScreen() {
  const router = useRouter();
  const s = useFieldStrings();
  const access = useFieldAccess();
  const { scope, contextKey, fieldApp, workflow, commands } = access;
  const params = useLocalSearchParams<{ cadetId?: string; op?: string; record?: string }>();
  const record = isUuid(params.record) ? params.record : null;
  const remembered = isUuid(params.op) ? recallAssessTarget(params.op) : null;
  const routeCadet = isUuid(params.cadetId) ? params.cadetId : null;
  // The target must match the cadet in the URL; a deep link without a hand-off is resolved from the server below.
  const known = remembered && (!routeCadet || remembered.cadetId === routeCadet) ? remembered : null;
  const cadetId = known?.cadetId ?? routeCadet;
  // FO-06 and deep links open `/field/cadets/<id>/assess` without `op`: today's check-in comes from the server then.
  const routeOp = isUuid(params.op) ? params.op : null;
  const needsResolve = !record && !known && !!routeCadet && !!fieldApp;

  const resolved = useScopedResource(`${contextKey}:assess-target:${needsResolve ? `${routeCadet}:${routeOp ?? 'today'}` : 'none'}`, async () => {
    if (!needsResolve || !fieldApp || !routeCadet) return null;
    const p = await fieldApp.cadets.profile(scope, routeCadet);
    if (!p.today || p.today.publishedSessionId) return null;
    if (routeOp && p.today.checkInOperationId !== routeOp) return null;
    const t = { checkInOperationId: p.today.checkInOperationId, cadetId: routeCadet, cadetName: p.cadet.name };
    rememberAssessTarget(t);
    return t;
  });
  const skills = useScopedResource(`${contextKey}:skills`, () => (fieldApp ? fieldApp.sessions.skills(scope) : Promise.resolve([])));
  const consent = useScopedResource(`${contextKey}:consent:${cadetId ?? 'none'}`, async () =>
    fieldApp && cadetId ? (await fieldApp.consent.forCadet(scope, cadetId)).sessionVideo : ('unknown' as const),
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace('/field'));

  if (record) return <SessionRecordScreen sessionId={record} onBack={back} />;
  if (needsResolve && resolved.status === 'loading') {
    return (
      <GlassScreen header={{ title: s.t('assess.title'), onBack: back, backLabel: s.t('common.back') }} testID="field-assess">
        <LoadingState label={s.t('assess.loading')} />
      </GlassScreen>
    );
  }
  if (needsResolve && resolved.status === 'error') {
    return (
      <GlassScreen header={{ title: s.t('assess.title'), onBack: back, backLabel: s.t('common.back') }} testID="field-assess">
        <LoadFailure state={resolved} onRetry={resolved.retry} notFoundTitle={s.t('profile.notFoundTitle')} notFoundMessage={s.t('profile.notFound')} testID="assess" />
      </GlassScreen>
    );
  }
  if (!access.canRecord) {
    return (
      <GlassScreen header={{ title: s.t('assess.title'), onBack: back, backLabel: s.t('common.back') }} testID="field-assess">
        <UnavailableState title={s.t('scan.notInstructorTitle')} message={s.t('today.notInstructor')} />
      </GlassScreen>
    );
  }
  const target = known ?? (resolved.status === 'ready' ? resolved.data : null);
  return (
    <AssessSessionView
      repo={commands ?? workflow}
      target={target}
      onBack={back}
      onDone={() => router.navigate('/field')}
      onNext={() => router.replace('/field/scan')}
      skills={fieldApp ? skills : undefined}
      consent={fieldApp ? consent : undefined}
      onRetryConsent={consent.retry}
      recheckConsent={fieldApp && cadetId ? async () => (await fieldApp.consent.forCadet(scope, cadetId)).sessionVideo : undefined}
      canRecordVideo={access.canUploadVideo}
      onRecordClip={async (consentConfirmed) => {
        if (!target) return null;
        const { token, result } = registerCapture({ mode: 'session_video', purpose: s.t('capture.purpose.sessionVideo', { name: target.cadetName }), consentConfirmed });
        router.push({ pathname: '/field/capture', params: { token } });
        return result;
      }}
      hubId={scope.hubId}
      draftKey={target ? `${contextKey}|${target.checkInOperationId}` : undefined}
      isPreview={access.isPreview}
    />
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cardPad: { padding: space.lg },
  scores: { gap: space.sm },
  group: { gap: space.sm },
  groupTitle: { paddingHorizontal: space.xs },
  skillsCard: { gap: space.lg },
  skillCat: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  clipCard: { gap: space.md },
  rowButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  done: { gap: space.sm },
});
