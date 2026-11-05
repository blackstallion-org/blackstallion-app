// Ported from g6-prework/src/spark (4 Nov 2026) unchanged in behaviour; pure TypeScript (lint-enforced).
// Audio playback state machine for Daily Spark, independent of the audio library.
// The expo-audio adapter (after G1/G2) forwards player and interruption events here.
// Listening coverage counts only audio actually played: seeking forward never earns completion.

export type Interruption = 'call' | 'focus-loss' | 'route-change';

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'interrupted' | 'ended' | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  durationMs: number;
  positionMs: number;
  /** Merged [start, end) intervals actually heard. */
  heard: [number, number][];
  /** Whether playback should resume when an interruption ends. */
  resumeAfterInterruption: boolean;
  interruption: Interruption | null;
  error: string | null;
}

export type PlaybackEvent =
  | { type: 'LOAD' }
  | { type: 'LOADED'; durationMs: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'PROGRESS'; positionMs: number }
  | { type: 'SEEK'; positionMs: number }
  | { type: 'INTERRUPT_BEGIN'; reason: Interruption }
  | { type: 'INTERRUPT_END'; systemSaysResume: boolean }
  | { type: 'ENDED' }
  | { type: 'ERROR'; message: string }
  | { type: 'RETRY' };

export const initialPlayback: PlaybackState = {
  status: 'idle', durationMs: 0, positionMs: 0, heard: [], resumeAfterInterruption: false, interruption: null, error: null,
};

/** Largest progress step still treated as continuous listening (player ticks are ~250–500 ms). */
const MAX_CONTINUOUS_STEP_MS = 1500;

function addInterval(list: [number, number][], a: number, b: number): [number, number][] {
  if (b <= a) return list;
  const all = [...list, [a, b] as [number, number]].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function coverage(state: PlaybackState): number {
  if (state.durationMs <= 0) return 0;
  const heard = state.heard.reduce((n, [s, e]) => n + (Math.min(e, state.durationMs) - Math.max(0, s)), 0);
  return Math.min(1, Math.max(0, heard / state.durationMs));
}

export function playbackReducer(state: PlaybackState, ev: PlaybackEvent): PlaybackState {
  switch (ev.type) {
    case 'LOAD':
      return { ...state, status: 'loading', error: null };
    case 'LOADED':
      return { ...state, status: 'ready', durationMs: ev.durationMs };
    case 'PLAY':
      if (state.status === 'ready' || state.status === 'paused' || state.status === 'interrupted' || state.status === 'ended') {
        const restart = state.status === 'ended';
        return { ...state, status: 'playing', positionMs: restart ? 0 : state.positionMs, interruption: null, resumeAfterInterruption: false };
      }
      return state;
    case 'PAUSE':
      return state.status === 'playing' ? { ...state, status: 'paused', resumeAfterInterruption: false } : state;
    case 'PROGRESS': {
      if (state.status !== 'playing') return { ...state, positionMs: ev.positionMs };
      const step = ev.positionMs - state.positionMs;
      const heard = step > 0 && step <= MAX_CONTINUOUS_STEP_MS ? addInterval(state.heard, state.positionMs, ev.positionMs) : state.heard;
      return { ...state, positionMs: ev.positionMs, heard };
    }
    case 'SEEK':
      return { ...state, positionMs: Math.max(0, Math.min(ev.positionMs, state.durationMs)) };
    case 'INTERRUPT_BEGIN':
      if (state.status !== 'playing' && state.status !== 'paused') return state;
      return {
        ...state,
        status: 'interrupted',
        interruption: ev.reason,
        // headphones unplugged: never resume automatically (would play aloud unexpectedly)
        resumeAfterInterruption: state.status === 'playing' && ev.reason !== 'route-change',
      };
    case 'INTERRUPT_END':
      if (state.status !== 'interrupted') return state;
      if (state.resumeAfterInterruption && ev.systemSaysResume) return { ...state, status: 'playing', interruption: null, resumeAfterInterruption: false };
      return { ...state, status: 'paused', interruption: null, resumeAfterInterruption: false };
    case 'ENDED': {
      const heard = state.status === 'playing' && state.durationMs - state.positionMs <= MAX_CONTINUOUS_STEP_MS
        ? addInterval(state.heard, state.positionMs, state.durationMs) : state.heard;
      return { ...state, status: 'ended', positionMs: state.durationMs, heard };
    }
    case 'ERROR':
      return { ...state, status: 'error', error: ev.message };
    case 'RETRY':
      return state.status === 'error' ? { ...state, status: 'loading', error: null } : state;
    default:
      return state;
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Labels for the single primary control plus the position text screen readers announce. */
export function controlLabels(state: PlaybackState): { primary: string; primaryAction: 'play' | 'pause' | 'retry' | 'none'; position: string; hint: string | null } {
  const position = `${clock(state.positionMs)} of ${clock(state.durationMs)}`;
  switch (state.status) {
    case 'playing': return { primary: 'Pause', primaryAction: 'pause', position, hint: null };
    case 'interrupted': return { primary: 'Resume', primaryAction: 'play', position, hint: 'Paused by your phone (call or other audio).' };
    case 'paused': return { primary: 'Resume', primaryAction: 'play', position, hint: null };
    case 'ended': return { primary: 'Play again', primaryAction: 'play', position, hint: null };
    case 'error': return { primary: 'Try again', primaryAction: 'retry', position, hint: state.error };
    case 'loading':
    case 'idle': return { primary: 'Loading', primaryAction: 'none', position, hint: null };
    default: return { primary: 'Play', primaryAction: 'play', position, hint: null };
  }
}
