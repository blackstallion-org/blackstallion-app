import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/ui/components';
import { Chip, GlassButton, GlassIconButton, GlassInput, GlassScreen, PermissionDeniedState, StatusNote, UnavailableState } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';
import { PermissionPrimerSheet, usePermissionGate } from '@/features/permissions';

import { rememberAssessTarget, type AssessTarget } from './assessHandoff';
import { CameraStage, ScanFrame } from './components/CameraStage';
import { CheckInResultPanel } from './components/CheckInResultPanel';
import { newOperationId } from './domain/operation';
import { parsePassportInput } from './domain/passportCode';
import type { FieldWorkflowRepository } from './domain/workflow';
import { useFieldStrings, type FieldTranslator } from './i18n';
import { commandMessage, useCheckIn, type CheckInStatus, type CheckInSubmit } from './useCheckIn';
import { useFieldAccess } from './useFieldAccess';

const inputErrorText = (r: CheckInSubmit, s: FieldTranslator): string | null =>
  r.ok ? null : r.reason === 'empty' ? s.t('scan.codeEmpty') : r.reason === 'format' ? s.t('scan.codeFormat') : null;

/** Typed or pasted passport code (the code printed under the QR). Works when the camera can't. */
function ManualEntry({ status, onSubmit }: { status: CheckInStatus; onSubmit: (code: string) => Promise<CheckInSubmit> }) {
  const s = useFieldStrings();
  const [code, setCode] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const submit = async () => setInputError(inputErrorText(await onSubmit(code), s));
  return (
    <>
      <GlassInput
        label={s.t('scan.codeLabel')}
        hint={s.t('scan.codeHint')}
        placeholder="BSAH-26-…"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          if (inputError) setInputError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        error={inputError}
        testID="passport-input"
      />
      <GlassButton size="large" label={s.t('scan.checkInAction')} icon="log-in-outline" loading={status.kind === 'busy'} onPress={() => void submit()} testID="checkin-submit" />
    </>
  );
}

export type ScanCheckInViewProps = {
  repo?: FieldWorkflowRepository;
  onAssess: (t: AssessTarget) => void;
  now?: () => Date;
  makeId?: () => string;
};

/** FO-02 typed-code check-in (also the camera screen's manual mode). Retries resend the same operation. */
export function ScanCheckInView({ repo, onAssess, now = () => new Date(), makeId = newOperationId }: ScanCheckInViewProps) {
  const s = useFieldStrings();
  const { status, submit, reset } = useCheckIn(repo, { now, makeId });
  if (!repo) {
    return (
      <GlassScreen edges={['left', 'right', 'bottom']} testID="field-scan">
        <StatusNote tone="warning" message={s.t('scan.unconnected')} testID="scan-unconnected" />
      </GlassScreen>
    );
  }
  if (status.kind === 'done') {
    return (
      <GlassScreen edges={['left', 'right', 'bottom']} testID="field-scan">
        <CheckInResultPanel status={status} onAssess={onAssess} onNext={reset} onRetry={reset} />
      </GlassScreen>
    );
  }
  return (
    <GlassScreen edges={['left', 'right', 'bottom']} keyboard testID="field-scan">
      <ManualEntry status={status} onSubmit={submit} />
      {status.kind === 'error' ? (
        <StatusNote
          tone="danger"
          message={status.error.kind === 'notFound' ? s.t('scan.result.notOnList') : status.error.reference ? `${commandMessage(status.error, s)} (${s.t('common.reference', { ref: status.error.reference })})` : commandMessage(status.error, s)}
          testID="checkin-error"
        />
      ) : null}
    </GlassScreen>
  );
}

const haptic = (kind: 'scan' | 'success' | 'warning') => {
  const p =
    kind === 'scan'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  void p.catch(() => undefined);
};

/**
 * FO-02 Passport scan (full-screen): live back camera with a scan frame, QR only, torch. One scan at a time: the
 * scanner pauses while the server answers and while a result is shown. Outcomes come from the server only:
 * checked in, already checked in (first check-in's time), not on this hub's list (unknown, revoked and other-hub codes
 * are indistinguishable on purpose, MIG:354-355), another day, not confirmed (retry is replay-safe).
 * Camera permission goes through the SH-07 primer; denied/unavailable cameras fall back to typing the printed code.
 */
export function ScanScreen() {
  const s = useFieldStrings();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const access = useFieldAccess();
  const repo = access.workflow;
  const { status, submit, reset } = useCheckIn(repo);
  const gate = usePermissionGate('camera', { reason: s.t('scan.primerReason') });
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [torch, setTorch] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [primerPreview, setPrimerPreview] = useState(false);
  const lastBad = useRef<string | null>(null);
  const primed = useRef(false);

  // Entering the scanner is the person's request to scan: explain once, then the OS asks only after Continue.
  const { status: permission, ensure } = gate;
  useEffect(() => {
    if (primed.current || (permission !== 'undetermined' && permission !== 'denied')) return;
    primed.current = true;
    void ensure();
  }, [permission, ensure]);

  useEffect(() => {
    if (status.kind === 'done') haptic(status.result.duplicate ? 'warning' : 'success');
    else if (status.kind === 'error') haptic('warning');
  }, [status]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/field'));
  const next = () => {
    setNote(null);
    lastBad.current = null;
    reset();
  };
  const assess = (t: AssessTarget) => {
    rememberAssessTarget(t);
    router.replace({ pathname: '/field/cadets/[cadetId]/assess', params: { cadetId: t.cadetId, op: t.checkInOperationId } });
  };
  const openProfile = (cadetId: string) => router.replace({ pathname: '/field/cadets/[cadetId]', params: { cadetId } });

  const onScanned = (r: BarcodeScanningResult) => {
    if (status.kind !== 'idle') return;
    const parsed = parsePassportInput(r.data);
    if (!parsed.ok) {
      // The camera reports the same code many times a second: say it once per code.
      if (lastBad.current !== r.data) {
        lastBad.current = r.data;
        setNote(s.t('scan.notPassport'));
      }
      return;
    }
    setNote(null);
    haptic('scan');
    void submit(parsed.code);
  };

  if (!repo || !access.canRecord) {
    return (
      <GlassScreen edges={['top', 'left', 'right', 'bottom']} header={{ title: s.t('scan.title'), onBack: close, closeStyle: true, backLabel: s.t('common.close') }} testID="field-scan">
        {!repo ? (
          <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('scan.unconnected')} testID="scan-unconnected" />
        ) : (
          <PermissionDeniedState title={s.t('scan.notInstructorTitle')} message={s.t('today.notInstructor')} testID="scan-not-allowed" />
        )}
      </GlassScreen>
    );
  }

  const scanning = mode === 'camera' && gate.status === 'granted' && !cameraFailed;
  const frame = Math.min(width * 0.68, 300);
  const busy = status.kind === 'busy';
  const showResult = status.kind === 'done' || status.kind === 'error';
  const devCodes = __DEV__ ? (access.fieldApp?.previewPassportCodes?.(access.scope.subjectId) ?? []) : [];

  const panel = showResult ? (
    <CheckInResultPanel status={status} onAssess={assess} onNext={next} onRetry={() => status.kind === 'error' && void submit(status.code)} onOpenProfile={openProfile} />
  ) : busy ? (
    <View style={styles.busy} accessible accessibilityLiveRegion="polite" accessibilityLabel={s.t('scan.checking')} testID="scan-busy">
      <ActivityIndicator color={colors.accent} />
      <AppText variant="bodyStrong">{s.t('scan.checking')}</AppText>
    </View>
  ) : (
    <>
      {mode === 'manual' ? (
        <ManualEntry status={status} onSubmit={submit} />
      ) : gate.status === 'granted' && !cameraFailed ? (
        <AppText variant="bodyStrong" testID="scan-hint">
          {s.t('scan.frameHint')}
        </AppText>
      ) : gate.status === null ? (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.accent} />
          <AppText>{s.t('scan.starting')}</AppText>
        </View>
      ) : cameraFailed ? (
        <StatusNote tone="danger" title={s.t('scan.cameraFailedTitle')} message={s.t('scan.cameraFailed')} testID="scan-camera-failed" />
      ) : gate.status === 'blocked' ? (
        <PermissionDeniedState title={s.t('scan.cameraBlockedTitle')} message={s.t('scan.cameraBlocked')} onOpenSettings={() => void gate.openSettings()} settingsLabel={s.t('permissions.openSettings')} testID="scan-camera-blocked" />
      ) : gate.status === 'unavailable' ? (
        <UnavailableState title={s.t('scan.cameraUnavailableTitle')} message={s.t('scan.cameraUnavailable')} testID="scan-camera-unavailable" />
      ) : (
        <>
          <AppText>{s.t('scan.cameraNeeded')}</AppText>
          <GlassButton size="large" icon="camera-outline" label={s.t('scan.allowCamera')} onPress={() => void gate.ensure()} testID="scan-allow-camera" />
        </>
      )}
      {note ? <StatusNote tone="warning" message={note} testID="scan-note" /> : null}
      <GlassButton
        variant="secondary"
        icon={mode === 'manual' ? 'camera-outline' : 'keypad-outline'}
        label={mode === 'manual' ? s.t('scan.useCamera') : s.t('scan.typeCode')}
        onPress={() => setMode(mode === 'manual' ? 'camera' : 'manual')}
        testID="scan-toggle-manual"
      />
      {devCodes.length > 0 ? (
        <View style={styles.dev} testID="scan-dev-panel">
          <AppText variant="label">{s.t('scan.devTitle')}</AppText>
          <AppText variant="secondary" tone="muted">
            {s.t('scan.devHint')}
          </AppText>
          <GlassButton variant="ghost" icon="eye-outline" label={s.t('scan.devPrimer')} onPress={() => setPrimerPreview(true)} testID="scan-dev-primer" />
          <View style={styles.chips}>
            {devCodes.map((c) => (
              <Chip key={c.code} label={c.label} icon="flask-outline" onPress={() => onScanned({ data: c.code } as BarcodeScanningResult)} testID={`scan-dev-${c.code}`} />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <>
      <CameraStage
        testID="field-scan"
        title={s.t('scan.title')}
        onClose={close}
        closeLabel={s.t('common.close')}
        trailing={
          scanning ? (
            <GlassIconButton
              icon={torch ? 'flashlight' : 'flashlight-outline'}
              accessibilityLabel={torch ? s.t('scan.torchOff') : s.t('scan.torchOn')}
              selected={torch}
              onPress={() => setTorch((v) => !v)}
              material="thick"
              testID="scan-torch"
            />
          ) : undefined
        }
        camera={
          scanning ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={status.kind === 'idle' ? onScanned : undefined}
              onMountError={() => setCameraFailed(true)}
              accessibilityLabel={s.t('scan.cameraA11y')}
            />
          ) : null
        }
        overlay={scanning && !showResult ? <ScanFrame size={frame} /> : null}
        panel={panel}
      />
      <PermissionPrimerSheet {...gate.sheetProps} />
      {__DEV__ ? (
        // Development only: the web preview has no camera, so the camera explainer is shown here as a preview (no OS call).
        <PermissionPrimerSheet
          kind="camera"
          mode="ask"
          reason={s.t('scan.primerReason')}
          visible={primerPreview}
          onContinue={() => setPrimerPreview(false)}
          onOpenSettings={() => setPrimerPreview(false)}
          onDismiss={() => setPrimerPreview(false)}
          testID="permission-primer-preview"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  dev: { gap: space.sm, paddingTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
