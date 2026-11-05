// Ported from g6-prework/src/stallcam/playerMachine.ts (4 Nov 2026), unchanged in behaviour; pure TypeScript.
// The expo-video boundary (horse/StallPlayer.tsx) feeds FRAME/STALL/PLAYER_ERROR events here.

// Stall-camera player state machine, independent of the video library (expo-video after G1 E8).
// Rules: the phone only ever holds a short-lived gateway URL; "LIVE" is shown only for a live grant
// that is actually delivering fresh frames; a recording is never labelled live.

export type GrantKind = 'live' | 'recording';

export interface StreamGrant {
  kind: GrantKind;
  playbackUrl: string;
  fallbackUrl: string | null;
  expiresAt: string;
  recordedAt?: string; // for kind 'recording'
}

export type PlayerStatus =
  | 'requesting' | 'connecting' | 'playing' | 'stalled' | 'reconnecting'
  | 'unavailable' | 'denied' | 'expired' | 'error';

export interface PlayerState {
  status: PlayerStatus;
  grant: StreamGrant | null;
  mode: 'primary' | 'fallback';
  lastFrameAt: number | null;
  attempts: number;
  nextRetryAt: number | null;
  reason: string | null;
}

export type PlayerEvent =
  | { type: 'REQUEST' }
  | { type: 'GRANT'; grant: StreamGrant; now: number }
  | { type: 'GRANT_DENIED' }
  | { type: 'GRANT_UNAVAILABLE'; reason: string }
  | { type: 'FRAME'; now: number }
  | { type: 'STALL'; now: number }
  | { type: 'PLAYER_ERROR'; now: number; httpStatus?: number }
  | { type: 'TICK'; now: number };

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
export const FRESH_FRAME_MS = 10_000;
export const REFRESH_BEFORE_MS = 30_000;

export const initialPlayer: PlayerState = { status: 'requesting', grant: null, mode: 'primary', lastFrameAt: null, attempts: 0, nextRetryAt: null, reason: null };

export class UnsafeGrantError extends Error {}

/** Rejects anything that looks like a camera source or embedded credentials reaching the phone. */
export function assertSafeGrant(g: StreamGrant): void {
  for (const u of [g.playbackUrl, g.fallbackUrl]) {
    if (!u) continue;
    const url = new URL(u);
    if (url.protocol !== 'https:') throw new UnsafeGrantError(`non-https playback URL (${url.protocol})`);
    if (url.username || url.password) throw new UnsafeGrantError('credentials embedded in playback URL');
  }
}

function scheduleRetry(s: PlayerState, now: number, reason: string): PlayerState {
  if (s.attempts >= BACKOFF_MS.length) {
    if (s.mode === 'primary' && s.grant?.fallbackUrl) {
      return { ...s, mode: 'fallback', status: 'connecting', attempts: 0, nextRetryAt: null, reason: 'switched to compatibility stream' };
    }
    return { ...s, status: 'unavailable', nextRetryAt: null, reason: 'camera not reachable' };
  }
  return { ...s, status: 'reconnecting', nextRetryAt: now + BACKOFF_MS[s.attempts]!, attempts: s.attempts + 1, reason };
}

export function playerReducer(s: PlayerState, ev: PlayerEvent): PlayerState {
  switch (ev.type) {
    case 'REQUEST':
      return { ...s, status: 'requesting', reason: null };
    case 'GRANT':
      assertSafeGrant(ev.grant);
      if (new Date(ev.grant.expiresAt).getTime() <= ev.now) return { ...s, status: 'expired', grant: null, reason: 'access expired' };
      return { ...s, status: 'connecting', grant: ev.grant, attempts: s.status === 'requesting' && s.grant ? s.attempts : 0, nextRetryAt: null, reason: null };
    case 'GRANT_DENIED':
      return { ...initialPlayer, status: 'denied', reason: 'not available to your account' };
    case 'GRANT_UNAVAILABLE':
      return { ...initialPlayer, status: 'unavailable', reason: ev.reason };
    case 'FRAME':
      if (!s.grant) return s;
      return { ...s, status: 'playing', lastFrameAt: ev.now, attempts: 0, nextRetryAt: null, reason: null };
    case 'STALL':
      return s.status === 'playing' ? { ...s, status: 'stalled' } : s;
    case 'PLAYER_ERROR':
      // 401/403 from the gateway = token expired or access revoked: ask the server again, never retry the old URL
      if (ev.httpStatus === 401 || ev.httpStatus === 403) return { ...s, status: 'requesting', grant: null, reason: 'access re-check' };
      return scheduleRetry(s, ev.now, 'connection lost');
    case 'TICK': {
      if (s.grant && s.status !== 'requesting' && new Date(s.grant.expiresAt).getTime() - ev.now <= REFRESH_BEFORE_MS) {
        return { ...s, status: s.status === 'playing' ? 'playing' : 'requesting', reason: 'refreshing access' };
      }
      if (s.status === 'stalled' && s.lastFrameAt !== null && ev.now - s.lastFrameAt > FRESH_FRAME_MS) return scheduleRetry(s, ev.now, 'no new video');
      if (s.status === 'reconnecting' && s.nextRetryAt !== null && ev.now >= s.nextRetryAt) return { ...s, status: 'connecting', nextRetryAt: null };
      return s;
    }
    default:
      return s;
  }
}

/** True when the app should fetch a new grant now (proactive refresh before expiry). */
export function needsGrant(s: PlayerState, now: number): boolean {
  if (s.status === 'requesting') return true;
  return !!s.grant && new Date(s.grant.expiresAt).getTime() - now <= REFRESH_BEFORE_MS;
}

/** The only text badge on the video. Never "LIVE" for a recording or for video that stopped updating. */
export function liveBadge(s: PlayerState, now: number): { text: string; isLive: boolean } {
  if (!s.grant) return { text: '', isLive: false };
  if (s.grant.kind === 'recording') {
    const at = s.grant.recordedAt ? ` · ${s.grant.recordedAt.slice(11, 16)}` : '';
    return { text: `Recorded${at}`, isLive: false };
  }
  const fresh = s.lastFrameAt !== null && now - s.lastFrameAt <= FRESH_FRAME_MS;
  if (s.status === 'playing' && fresh) return { text: 'LIVE', isLive: true };
  if (s.status === 'stalled' || s.status === 'reconnecting' || s.status === 'connecting') return { text: 'Reconnecting…', isLive: false };
  return { text: '', isLive: false };
}

export function statusMessage(s: PlayerState): string | null {
  switch (s.status) {
    case 'requesting': return 'Checking access…';
    case 'connecting': return s.mode === 'fallback' ? 'Connecting (compatibility mode)…' : 'Connecting to the stable camera…';
    case 'reconnecting': return 'Connection lost. Reconnecting…';
    case 'unavailable': return 'The stable camera is offline right now. Try again later.';
    case 'denied': return 'The stall camera isn’t part of your plan for this horse.';
    case 'expired': return 'Access expired. Tap to reconnect.';
    case 'error': return 'Something went wrong. Tap to try again.';
    default: return null;
  }
}
