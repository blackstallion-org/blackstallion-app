import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';

import type { PlaybackEvent } from '../domain/playback';
import type { SparkAudioFactory, SparkAudioPort } from '../types';

const LOAD_TIMEOUT_MS = 15000;

/**
 * Device audio through expo-audio. Translates `playbackStatusUpdate` into the
 * domain's PlaybackEvent vocabulary:
 *  - first loaded status with a duration → LOADED
 *  - position ticks while playing → PROGRESS (the reducer counts only
 *    continuous steps as heard; seeks never earn listening)
 *  - didJustFinish → ENDED
 *  - playback stopping without a pause we asked for → INTERRUPT_BEGIN
 *    (call / other audio); starting again without our play → INTERRUPT_END
 *
 * NOT device-verified in this workstream (no simulator/device was run). Route
 * changes (headphones unplugged) are not distinguished by expo-audio's status;
 * they surface as an interruption and the reducer never auto-resumes those.
 */
export const createExpoSparkAudio: SparkAudioFactory = (content) => {
  const listeners = new Set<(e: PlaybackEvent) => void>();
  const emit = (e: PlaybackEvent) => listeners.forEach((l) => l(e));
  let player: AudioPlayer | null = null;
  let sub: { remove: () => void } | null = null;
  let loaded = false;
  let wantPlaying = false;
  let systemPaused = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const onStatus = (s: AudioStatus) => {
    if (!loaded && s.isLoaded && s.duration > 0) {
      loaded = true;
      if (timeout) clearTimeout(timeout);
      emit({ type: 'LOADED', durationMs: Math.round(s.duration * 1000) });
    }
    if (s.didJustFinish) {
      wantPlaying = false;
      emit({ type: 'ENDED' });
      return;
    }
    if (s.playing) {
      if (systemPaused) {
        systemPaused = false;
        emit({ type: 'INTERRUPT_END', systemSaysResume: true });
      }
      emit({ type: 'PROGRESS', positionMs: Math.round(s.currentTime * 1000) });
    } else if (wantPlaying && loaded && !s.isBuffering && !systemPaused) {
      systemPaused = true;
      emit({ type: 'INTERRUPT_BEGIN', reason: 'focus-loss' });
    }
  };

  const port: SparkAudioPort = {
    kind: 'device',
    load() {
      if (!content.audio) {
        emit({ type: 'ERROR', message: 'This Spark has no audio yet.' });
        return;
      }
      emit({ type: 'LOAD' });
      void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
      port.release();
      player = createAudioPlayer({ uri: content.audio.uri }, { updateInterval: 250 });
      sub = player.addListener('playbackStatusUpdate', onStatus);
      timeout = setTimeout(() => {
        if (!loaded) emit({ type: 'ERROR', message: 'The audio could not be loaded. Check your connection and try again.' });
      }, LOAD_TIMEOUT_MS);
    },
    play() {
      wantPlaying = true;
      systemPaused = false;
      player?.play();
    },
    pause() {
      wantPlaying = false;
      player?.pause();
    },
    seekTo(positionMs) {
      void player?.seekTo(positionMs / 1000).catch(() => undefined);
    },
    release() {
      if (timeout) clearTimeout(timeout);
      sub?.remove();
      sub = null;
      player?.remove();
      player = null;
      loaded = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return port;
};
