import { useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { controlLabels, coverage, initialPlayback, playbackReducer, type PlaybackState } from './domain/playback';
import type { SparkAudioFactory, SparkAudioPort, SparkContent } from './types';

export const SEEK_STEP_MS = 10000;

/**
 * Wires one audio port to the playback reducer. Every state change comes from
 * the reducer, so "heard" coverage only grows from real continuous progress
 * reported by the player — never from seeks, never from the UI.
 */
export function useSparkPlayback(content: SparkContent | null, createAudio: SparkAudioFactory | undefined) {
  const [state, dispatch] = useReducer(playbackReducer, initialPlayback);
  // Creating a port has no side effects; loading/releasing happens in the effect below.
  const port = useMemo<SparkAudioPort | null>(() => (content && createAudio ? createAudio(content) : null), [content, createAudio]);
  const stateRef = useRef<PlaybackState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!port) return;
    const off = port.subscribe(dispatch);
    port.load();
    return () => {
      off();
      port.release();
    };
  }, [port]);

  // Backgrounding pauses (and never resumes aloud on return).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && stateRef.current.status === 'playing') {
        port?.pause();
        dispatch({ type: 'INTERRUPT_BEGIN', reason: 'focus-loss' });
      } else if (next === 'active' && stateRef.current.status === 'interrupted') {
        dispatch({ type: 'INTERRUPT_END', systemSaysResume: false });
      }
    });
    return () => sub.remove();
  }, [port]);

  const labels = controlLabels(state);
  const actions = {
    primary: () => {
      if (!port) return;
      if (labels.primaryAction === 'pause') {
        port.pause();
        dispatch({ type: 'PAUSE' });
      } else if (labels.primaryAction === 'play') {
        if (state.status === 'ended') port.seekTo(0);
        port.play();
        dispatch({ type: 'PLAY' });
      } else if (labels.primaryAction === 'retry') {
        dispatch({ type: 'RETRY' });
        port.load();
      }
    },
    seekBy: (deltaMs: number) => {
      if (!port || state.durationMs <= 0) return;
      const to = Math.max(0, Math.min(state.durationMs, state.positionMs + deltaMs));
      port.seekTo(to);
      dispatch({ type: 'SEEK', positionMs: to });
    },
  };
  return { state, labels, coverage: coverage(state), simulated: port?.kind === 'simulated', ready: port !== null, actions };
}
