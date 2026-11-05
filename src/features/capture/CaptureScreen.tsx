import { CameraView } from 'expo-camera';
import { useEventListener } from 'expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, View } from 'react-native';

import { CameraStage } from '@/features/field/components/CameraStage';
import { useFieldStrings } from '@/features/field/i18n';
import { PermissionPrimerSheet, usePermissionGate } from '@/features/permissions';
import { AppText } from '@/ui/components';
import { GlassButton, GlassIconButton, PermissionDeniedState, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

import { readCaptureRequest, settleCapture, type CaptureMode, type CaptureRequest, type CaptureResult } from './contract';

/** Session clips: silent, at most 10 s (D17; the server refuses > 10.5 s). */
export const CLIP_MAX_SECONDS = 10;

type Phase =
  | { kind: 'live' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'review'; result: CaptureResult }
  | { kind: 'failed'; reason: 'interrupted' | 'capture' | 'mount' };

const MODE_KEY: Record<CaptureMode, string> = { session_video: 'sessionVideo', care_photo: 'carePhoto', shift_selfie: 'shiftSelfie' };
const fmt = (ms?: number) => {
  const sec = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/** Plays the clip back muted and reads its real duration from the file once loaded. */
function ClipPreview({ uri, onDuration }: { uri: string; onDuration: (ms: number) => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.loop = true;
    p.play();
  });
  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (duration > 0) onDuration(Math.round(duration * 1000));
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

/**
 * FO-04 Camera capture: one full-screen modal for session clips (back camera, silent, ≤ 10 s, auto-stop), care proof
 * photos (back camera, live only — no gallery) and shift selfies (front camera). Retake / Use; "Use" hands a local
 * file reference to the caller through the capture contract and nothing is uploaded here. Leaving any other way
 * settles the request as cancelled. Session clips are refused unless the caller confirmed consent.
 */
export function CaptureScreen() {
  const s = useFieldStrings();
  const router = useRouter();
  const { colors } = useTheme();
  const { token } = useLocalSearchParams<{ token?: string }>();
  // Read once: the request disappears from the registry when it settles.
  const [request] = useState<CaptureRequest | null>(() => readCaptureRequest(token));
  const settled = useRef(false);
  const settle = (r: CaptureResult | null) => {
    if (settled.current || !token) return;
    settled.current = true;
    settleCapture(token, r);
  };
  // Leaving by the OS back gesture, a deep link or sign-out still answers the caller (as cancelled).
  useEffect(
    () => () => {
      if (!settled.current && token) {
        settled.current = true;
        settleCapture(token, null);
      }
    },
    [token],
  );

  const mode = request?.mode ?? 'care_photo';
  const mk = MODE_KEY[mode];
  const gate = usePermissionGate('camera', { reason: s.t(`capture.primer.${mk}`) });
  const camera = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'live' });
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const primed = useRef(false);

  const refused = !request || (mode === 'session_video' && request.consentConfirmed !== true);
  const { status: permission, ensure } = gate;
  useEffect(() => {
    if (refused || primed.current || (permission !== 'undetermined' && permission !== 'denied')) return;
    primed.current = true;
    void ensure();
  }, [refused, permission, ensure]);

  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const id = setInterval(() => setElapsed(Date.now() - phase.startedAt), 250);
    return () => clearInterval(id);
  }, [phase]);

  const close = () => {
    if (phase.kind === 'recording') camera.current?.stopRecording();
    settle(null);
    if (router.canGoBack()) router.back();
    else router.replace('/field');
  };
  const use = (result: CaptureResult) => {
    settle(result);
    if (router.canGoBack()) router.back();
    else router.replace('/field');
  };

  const takePhoto = async () => {
    try {
      const p = await camera.current?.takePictureAsync({ quality: 0.7, exif: false, shutterSound: false });
      if (!p?.uri) throw new Error('no picture');
      setPhase({ kind: 'review', result: { mode, uri: p.uri, mimeType: 'image/jpeg', width: p.width, height: p.height, capturedAt: new Date().toISOString() } });
    } catch {
      setPhase({ kind: 'failed', reason: 'capture' });
    }
  };
  const record = async () => {
    const startedAt = Date.now();
    setElapsed(0);
    setPhase({ kind: 'recording', startedAt });
    try {
      // Auto-stops at the limit. `mute` on the camera keeps the microphone off (D17: silent clips).
      const r = await camera.current?.recordAsync({ maxDuration: CLIP_MAX_SECONDS });
      const ms = Date.now() - startedAt;
      if (!r?.uri || ms < 1000) return setPhase({ kind: 'failed', reason: 'interrupted' });
      setPhase({
        kind: 'review',
        result: { mode, uri: r.uri, mimeType: Platform.OS === 'ios' ? 'video/quicktime' : 'video/mp4', durationMs: Math.min(ms, CLIP_MAX_SECONDS * 1000), capturedAt: new Date(startedAt).toISOString() },
      });
    } catch {
      setPhase({ kind: 'failed', reason: 'interrupted' });
    }
  };

  const title = s.t(`capture.mode.${mk}`);
  const devPlaceholder =
    __DEV__ && gate.status === 'unavailable' && request && !refused ? (
      <GlassButton
        variant="ghost"
        icon="flask-outline"
        label={s.t('capture.devPlaceholder')}
        onPress={() =>
          use({ mode, uri: `synthetic://${mode}`, mimeType: mode === 'session_video' ? 'video/mp4' : 'image/jpeg', durationMs: mode === 'session_video' ? CLIP_MAX_SECONDS * 1000 : undefined, capturedAt: new Date().toISOString() })
        }
        testID="capture-dev-placeholder"
      />
    ) : null;

  let panel;
  if (!request) panel = <UnavailableState title={s.t('capture.expiredTitle')} message={s.t('capture.expired')} testID="capture-expired" />;
  else if (refused) panel = <PermissionDeniedState title={s.t('capture.consentTitle')} message={s.t('capture.consent')} testID="capture-no-consent" />;
  else if (gate.status === null)
    panel = (
      <View style={styles.row}>
        <ActivityIndicator color={colors.accent} />
        <AppText>{s.t('capture.starting')}</AppText>
      </View>
    );
  else if (gate.status === 'unavailable')
    panel = (
      <>
        <UnavailableState title={s.t('capture.unavailableTitle')} message={s.t('capture.unavailable')} testID="capture-unavailable" />
        {devPlaceholder}
      </>
    );
  else if (gate.status === 'blocked')
    panel = <PermissionDeniedState title={s.t('capture.blockedTitle')} message={s.t('capture.blocked')} onOpenSettings={() => void gate.openSettings()} settingsLabel={s.t('permissions.openSettings')} testID="capture-blocked" />;
  else if (gate.status !== 'granted')
    panel = (
      <>
        <AppText>{s.t(`capture.primer.${mk}`)}</AppText>
        <GlassButton size="large" icon="camera-outline" label={s.t('scan.allowCamera')} onPress={() => void gate.ensure()} testID="capture-allow-camera" />
      </>
    );
  else if (phase.kind === 'review') {
    const r = phase.result;
    const isClip = mode === 'session_video';
    panel = (
      <>
        <StatusBadge label={isClip ? s.t('capture.reviewClip', { duration: fmt(r.durationMs) }) : s.t('capture.reviewPhoto')} tone="success" icon={isClip ? 'videocam' : 'image'} testID="capture-review" />
        <AppText variant="secondary" tone="muted">
          {s.t('capture.notUploaded')}
        </AppText>
        <GlassButton size="large" icon="checkmark" label={isClip ? s.t('capture.useClip') : s.t('capture.usePhoto')} onPress={() => use(r)} testID="capture-use" />
        <GlassButton variant="secondary" icon="refresh" label={s.t('capture.retake')} onPress={() => setPhase({ kind: 'live' })} testID="capture-retake" />
      </>
    );
  } else if (phase.kind === 'failed')
    panel = (
      <>
        <StatusNote tone="danger" message={s.t(`capture.failed.${phase.reason}`)} testID="capture-failed" />
        <GlassButton variant="secondary" icon="refresh" label={s.t('capture.retake')} onPress={() => setPhase({ kind: 'live' })} testID="capture-retake" />
      </>
    );
  else {
    const recording = phase.kind === 'recording';
    const left = Math.max(0, CLIP_MAX_SECONDS - Math.floor(elapsed / 1000));
    panel = (
      <>
        <AppText variant="bodyStrong" accessibilityLiveRegion="polite" testID="capture-hint">
          {recording ? s.t('capture.recording', { seconds: left }) : mode === 'session_video' ? s.t('capture.clipHint', { max: CLIP_MAX_SECONDS }) : s.t('capture.photoHint')}
        </AppText>
        {mode !== 'session_video' ? (
          <AppText variant="secondary" tone="muted">
            {s.t('capture.noGallery')}
          </AppText>
        ) : null}
        <View style={styles.shutterRow}>
          <GlassIconButton
            icon={mode === 'session_video' ? (recording ? 'stop' : 'radio-button-on') : 'camera'}
            appearance="solid"
            size={76}
            iconSize={34}
            disabled={!ready}
            accessibilityLabel={mode === 'session_video' ? (recording ? s.t('capture.stop') : s.t('capture.record')) : s.t('capture.shutter')}
            onPress={() => (mode === 'session_video' ? (recording ? camera.current?.stopRecording() : void record()) : takePhoto())}
            testID="capture-shutter"
          />
        </View>
      </>
    );
  }

  const live = request && !refused && gate.status === 'granted' && phase.kind !== 'failed';
  return (
    <>
      <CameraStage
        testID="field-capture"
        title={request?.purpose ?? title}
        onClose={close}
        closeLabel={s.t('common.close')}
        trailing={<StatusBadge label={title} tone="neutral" icon={mode === 'session_video' ? 'videocam-outline' : 'camera-outline'} />}
        camera={
          live ? (
            phase.kind === 'review' && mode === 'session_video' ? (
              <ClipPreview uri={phase.result.uri} onDuration={(ms) => setPhase((p) => (p.kind === 'review' ? { kind: 'review', result: { ...p.result, durationMs: Math.min(ms, CLIP_MAX_SECONDS * 1000) } } : p))} />
            ) : phase.kind === 'review' ? (
              <Image source={{ uri: phase.result.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
            ) : (
              <CameraView
                ref={camera}
                style={StyleSheet.absoluteFill}
                facing={mode === 'shift_selfie' ? 'front' : 'back'}
                mode={mode === 'session_video' ? 'video' : 'picture'}
                mute
                videoQuality="720p"
                onCameraReady={() => setReady(true)}
                onMountError={() => setPhase({ kind: 'failed', reason: 'mount' })}
              />
            )
          ) : null
        }
        panel={panel}
      />
      <PermissionPrimerSheet {...gate.sheetProps} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  shutterRow: { alignItems: 'center', paddingVertical: space.sm },
});
