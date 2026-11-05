import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useReducer, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/ui/components';
import { GlassButton, StatusBadge } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { FamilyCommandError } from '../data/repositories';
import { initialPlayer, liveBadge, needsGrant, playerReducer, statusMessage, UnsafeGrantError, type PlayerEvent, type PlayerState, type StreamGrant } from '../domain/stallcam';
import { STALL_COPY } from '../strings';

/** The ported reducer throws on an unsafe grant (camera source or credentials on the phone): refuse it, show error. */
export function safePlayerReducer(s: PlayerState, e: PlayerEvent): PlayerState {
  try {
    return playerReducer(s, e);
  } catch (err) {
    if (err instanceof UnsafeGrantError || err instanceof TypeError) return { ...initialPlayer, status: 'error', reason: 'unsafe grant refused' };
    throw err;
  }
}

/**
 * FA-08 player boundary. Only mounted when the server says the capability is available AND a grant source exists
 * (neither is true in this build). The phone holds only a short-lived gateway URL; "LIVE" appears only while a live
 * grant delivers fresh frames (ported g6 machine); a recording is labelled "Recorded"; a frozen picture is not live.
 */
export function StallPlayer({ requestGrant, testID = 'stall-player' }: { requestGrant: () => Promise<StreamGrant>; testID?: string }) {
  const [state, dispatch] = useReducer(safePlayerReducer, initialPlayer);
  const [now, setNow] = useState(() => Date.now());
  const asking = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      dispatch({ type: 'TICK', now: n });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const wantsGrant = needsGrant(state, now);
  useEffect(() => {
    if (!wantsGrant || asking.current) return;
    asking.current = true;
    let live = true;
    requestGrant()
      .then((grant) => live && dispatch({ type: 'GRANT', grant, now: Date.now() }))
      .catch((e: unknown) => {
        if (!live) return;
        const denied = e instanceof FamilyCommandError && (e.kind === 'forbidden' || e.kind === 'notFound');
        dispatch(denied ? { type: 'GRANT_DENIED' } : { type: 'GRANT_UNAVAILABLE', reason: 'offline' });
      })
      .finally(() => {
        asking.current = false;
      });
    return () => {
      live = false;
    };
  }, [wantsGrant, requestGrant]);

  const badge = liveBadge(state, now);
  const message = statusMessage(state);
  const url = state.grant ? (state.mode === 'fallback' ? (state.grant.fallbackUrl ?? state.grant.playbackUrl) : state.grant.playbackUrl) : null;
  const ended = state.status === 'unavailable' || state.status === 'denied' || state.status === 'expired' || state.status === 'error';
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={styles.video}>
        {url && !ended ? <StallVideo key={`${url}-${state.mode}`} uri={url} dispatch={dispatch} /> : <Icon name="videocam-off-outline" size={36} color="#E2CDBA" />}
        <View style={styles.badge} pointerEvents="none">
          {badge.isLive ? <StatusBadge label="LIVE" tone="danger" icon="radio-button-on" testID="stall-live" /> : badge.text ? <StatusBadge label={badge.text} tone="neutral" testID="stall-badge" /> : null}
        </View>
      </View>
      {message ? (
        <AppText tone="muted" testID="stall-status">
          {message}
        </AppText>
      ) : null}
      {ended ? <GlassButton variant="secondary" icon="refresh" label={STALL_COPY.retry} onPress={() => dispatch({ type: 'REQUEST' })} /> : null}
    </View>
  );
}

function StallVideo({ uri, dispatch }: { uri: string; dispatch: (e: PlayerEvent) => void }) {
  const { colors } = useTheme();
  const last = useRef(-1);
  const player = useVideoPlayer({ uri, useCaching: false, contentType: 'hls' }, (p) => {
    p.timeUpdateEventInterval = 1;
    p.muted = true;
    p.play();
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    // Only advancing playback counts as a fresh frame; a frozen stream never earns "LIVE".
    if (currentTime > last.current) dispatch({ type: 'FRAME', now: Date.now() });
    last.current = currentTime;
  });
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') dispatch({ type: 'PLAYER_ERROR', now: Date.now() });
    if (status === 'loading') dispatch({ type: 'STALL', now: Date.now() });
  });
  return <VideoView player={player} nativeControls={false} contentFit="cover" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />;
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  video: { aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: space.md, left: space.md },
});
