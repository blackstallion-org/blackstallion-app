import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScopedLoadError } from '@/core/data/useScopedResource';
import { AppText, Icon } from '@/ui/components';
import { GlassButton, GlassIconButton, Skeleton, StatusNote } from '@/ui/glass';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, space } from '@/ui/tokens';

import { loadFailureOf } from '../data/familyNet';
import type { ClipRef, SignedMedia } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { dayLabel } from '../domain/format';
import { clipAccess, signedUrlUsable } from '../domain/progress';
import { CLIP_COPY } from '../strings';
import { ClipVideo } from './ClipVideo';

export type ConsentGate = { allowed: boolean | null; status: 'loading' | 'ready' | 'error'; retry: () => void };

type Phase =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'playing'; media: SignedMedia; refetched: boolean }
  | { kind: 'failed'; message: string; consentBlocked?: boolean };

/**
 * Consent-gated private clip (FA-03, FA-13). Order of checks, failing closed:
 *   no clip → note · consent unknown/withdrawn → hidden with the reason and a way to review consent ·
 *   no media boundary → explained · otherwise a Play control that asks the academy for a SHORT-LIVED signed URL only
 *   when pressed. An expired URL is refetched once; it is never cached past expiry or stored on the device.
 */
export function PrivateClip({ clip, childName, consent, heading, autoPlay = true, testID = 'private-clip' }: { clip: ClipRef | null; childName: string; consent: ConsentGate; heading?: string; autoPlay?: boolean; testID?: string }) {
  const { repos, scope } = useFamily();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // A different clip (child switch, navigation) starts from scratch: no URL carries over.
  const clipKey = clip ? `${clip.childId}:${clip.sessionId}` : 'none';
  const [seenKey, setSeenKey] = useState(clipKey);
  if (seenKey !== clipKey) {
    setSeenKey(clipKey);
    setPhase({ kind: 'idle' });
  }

  const access = clipAccess(Boolean(clip), consent.status === 'ready' ? consent.allowed : null, Boolean(repos?.media.available));

  const fetchUrl = async (refetched: boolean) => {
    if (!clip || !repos) return;
    setPhase({ kind: 'fetching' });
    try {
      const media = await repos.media.clipUrl(scope, clip);
      if (live.current) setPhase({ kind: 'playing', media, refetched });
    } catch (e) {
      if (!live.current) return;
      const ref = e instanceof ScopedLoadError ? e.reference : undefined;
      if (ref?.startsWith('CONSENT')) setPhase({ kind: 'failed', message: CLIP_COPY.consent(childName), consentBlocked: true });
      else if (ref === 'OFF-MEDIA') setPhase({ kind: 'failed', message: e instanceof Error ? e.message : CLIP_COPY.mediaOff });
      else setPhase({ kind: 'failed', message: loadFailureOf(ref) === 'offline' ? CLIP_COPY.offline : CLIP_COPY.failed });
    }
  };

  const onPlayerError = () => {
    if (phase.kind !== 'playing') return;
    // Expired link: ask for a new one once; otherwise report the failure.
    if (!phase.refetched && !signedUrlUsable(phase.media.expiresAt, Date.now())) void fetchUrl(true);
    else setPhase({ kind: 'failed', message: CLIP_COPY.failed });
  };

  if (access.kind === 'no-clip') {
    return (
      <View testID={`${testID}-none`} style={styles.noneRow}>
        <Icon name="videocam-off-outline" size={18} />
        <AppText tone="muted">{CLIP_COPY.noClip}</AppText>
      </View>
    );
  }

  if (consent.status === 'loading') {
    return (
      <Frame testID={`${testID}-checking`}>
        <Skeleton height={14} width="50%" />
      </Frame>
    );
  }

  if (access.kind === 'consent-unknown') {
    return (
      <Frame testID={`${testID}-consent-unknown`}>
        <Icon name="lock-closed-outline" size={28} />
        <AppText align="center">{CLIP_COPY.consentUnknown}</AppText>
        <GlassButton variant="secondary" icon="refresh" label={CLIP_COPY.checkAgain} fullWidth={false} onPress={consent.retry} material="thick" />
      </Frame>
    );
  }

  if (access.kind === 'consent-missing' || (phase.kind === 'failed' && phase.consentBlocked)) {
    return (
      <Frame testID={`${testID}-consent-missing`}>
        <Icon name="lock-closed-outline" size={28} />
        <AppText variant="bodyStrong" align="center">
          {CLIP_COPY.consentTitle}
        </AppText>
        <AppText tone="muted" align="center">
          {CLIP_COPY.consent(childName)}
        </AppText>
        <GlassButton variant="secondary" icon="shield-checkmark-outline" label={CLIP_COPY.manageConsent} fullWidth={false} material="thick" onPress={() => router.push('/family/consents')} testID={`${testID}-review-consent`} />
      </Frame>
    );
  }

  if (access.kind === 'media-unavailable') {
    return (
      <Frame testID={`${testID}-media-off`}>
        <Icon name="film-outline" size={28} />
        <AppText variant="bodyStrong" align="center">
          {CLIP_COPY.mediaOffTitle}
        </AppText>
        <AppText tone="muted" align="center">
          {CLIP_COPY.mediaOff}
        </AppText>
      </Frame>
    );
  }

  if (phase.kind === 'playing') {
    return (
      <View style={styles.playing} testID={`${testID}-player`}>
        <View style={styles.videoBox}>
          <ClipVideo uri={phase.media.uri} label={`${heading ?? CLIP_COPY.play}, ${dayLabel(clip?.date ?? '')}`} onError={onPlayerError} autoPlay={autoPlay} />
        </View>
        {phase.refetched ? <StatusNote tone="info" message={CLIP_COPY.expiredRetry} /> : null}
      </View>
    );
  }

  return (
    <Frame testID={`${testID}-poster`} poster>
      {phase.kind === 'fetching' ? (
        <>
          <ActivityIndicator accessibilityLabel={CLIP_COPY.loading} />
          <AppText tone="muted">{CLIP_COPY.loading}</AppText>
        </>
      ) : (
        <>
          <GlassIconButton icon="play" appearance="solid" size={72} iconSize={28} accessibilityLabel={`${CLIP_COPY.play}, ${dayLabel(clip?.date ?? '')}`} accessibilityHint={CLIP_COPY.playHint} onPress={() => fetchUrl(false)} testID={`${testID}-play`} />
          <AppText variant="secondary" tone="muted" align="center">
            {CLIP_COPY.privateLabel}
          </AppText>
          {phase.kind === 'failed' ? <StatusNote tone="danger" message={phase.message} testID={`${testID}-failed`} /> : null}
        </>
      )}
    </Frame>
  );
}

/** Dark 16:9 media frame (dark scope in both themes, like any video surface). */
function Frame({ children, testID, poster = false }: { children: ReactNode; testID?: string; poster?: boolean }) {
  return (
    <ThemeScope scheme="dark">
      <FrameBody testID={testID} poster={poster}>
        {children}
      </FrameBody>
    </ThemeScope>
  );
}

function FrameBody({ children, testID, poster }: { children: ReactNode; testID?: string; poster: boolean }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[styles.frame, poster ? styles.poster : null, { backgroundColor: colors.canvas, borderColor: rgba(colors.ink, 0.12) }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  noneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  frame: { minHeight: 180, borderRadius: radius.card, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  poster: { aspectRatio: 16 / 9 },
  playing: { gap: space.sm },
  videoBox: { aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
});
