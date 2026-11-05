/**
 * Stall-camera player machine: ported from g6-prework/test/client.test.ts (vitest → jest, unchanged assertions).
 * The RSVP tests are rewritten in familyDomain.test.ts because the G9 server decides open/closed (rsvp_open).
 */
import { BACKOFF_MS, initialPlayer, liveBadge, needsGrant, playerReducer, statusMessage, UnsafeGrantError, type PlayerEvent, type PlayerState, type StreamGrant } from '../domain/stallcam';

describe('stall camera player', () => {
  const t0 = Date.parse('2026-11-12T06:00:00Z');
  const grant = (o: Partial<StreamGrant> = {}): StreamGrant => ({ kind: 'live', playbackUrl: 'https://gw.example/hls/h1/index.m3u8?t=abc',
    fallbackUrl: 'https://gw.example/hls-compat/h1/index.m3u8?t=abc', expiresAt: new Date(t0 + 120_000).toISOString(), ...o });
  const run = (evs: PlayerEvent[], s: PlayerState = initialPlayer) => evs.reduce(playerReducer, s);

  it('shows LIVE only while fresh frames arrive from a live grant', () => {
    const s = run([{ type: 'GRANT', grant: grant(), now: t0 }, { type: 'FRAME', now: t0 + 1000 }]);
    expect(liveBadge(s, t0 + 2000)).toEqual({ text: 'LIVE', isLive: true });
    expect(liveBadge(s, t0 + 20_000).isLive).toBe(false); // frozen picture is not live
  });

  it('never labels a recording as live', () => {
    const s = run([{ type: 'GRANT', grant: grant({ kind: 'recording', recordedAt: '2026-11-12T04:10:00Z' }), now: t0 }, { type: 'FRAME', now: t0 + 500 }]);
    expect(liveBadge(s, t0 + 600)).toEqual({ text: 'Recorded · 04:10', isLive: false });
  });

  it('refuses a grant that would put camera credentials or a non-https source on the phone', () => {
    expect(() => run([{ type: 'GRANT', grant: grant({ playbackUrl: 'rtsp://user:pw@10.0.0.5/stall' }), now: t0 }])).toThrow(UnsafeGrantError);
    expect(() => run([{ type: 'GRANT', grant: grant({ playbackUrl: 'https://user:pw@gw.example/x.m3u8' }), now: t0 }])).toThrow(UnsafeGrantError);
  });

  it('refreshes access before expiry instead of letting playback die', () => {
    const s = run([{ type: 'GRANT', grant: grant(), now: t0 }, { type: 'FRAME', now: t0 + 1000 }]);
    expect(needsGrant(s, t0 + 60_000)).toBe(false);
    expect(needsGrant(s, t0 + 95_000)).toBe(true);
    const expired = run([{ type: 'GRANT', grant: grant({ expiresAt: new Date(t0 - 1).toISOString() }), now: t0 }]);
    expect(expired.status).toBe('expired');
    expect(statusMessage(expired)).toMatch(/Access expired/);
  });

  it('treats a 403 from the gateway (access revoked) as a fresh server check, not a retry of the old URL', () => {
    const s = run([{ type: 'GRANT', grant: grant(), now: t0 }, { type: 'FRAME', now: t0 + 1000 }, { type: 'PLAYER_ERROR', now: t0 + 2000, httpStatus: 403 }]);
    expect(s).toMatchObject({ status: 'requesting', grant: null });
    expect(run([{ type: 'GRANT_DENIED' }], s)).toMatchObject({ status: 'denied' });
  });

  it('reconnects with bounded backoff, then switches to the HLS fallback, then reports the camera offline', () => {
    let s = run([{ type: 'GRANT', grant: grant(), now: t0 }]);
    let now = t0;
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      s = playerReducer(s, { type: 'PLAYER_ERROR', now });
      expect(s.status).toBe('reconnecting');
      now = s.nextRetryAt!;
      s = playerReducer(s, { type: 'TICK', now });
      expect(s.status).toBe('connecting');
    }
    s = playerReducer(s, { type: 'PLAYER_ERROR', now });
    expect(s).toMatchObject({ status: 'connecting', mode: 'fallback' });
    for (let i = 0; i <= BACKOFF_MS.length; i++) {
      s = playerReducer(s, { type: 'PLAYER_ERROR', now });
      if (s.status === 'reconnecting') s = playerReducer(s, { type: 'TICK', now: s.nextRetryAt! });
    }
    expect(s.status).toBe('unavailable');
    expect(statusMessage(s)).toMatch(/offline/);
    expect(liveBadge(s, now).isLive).toBe(false);
  });

  it('a stall that stops delivering frames goes to reconnecting and drops the LIVE badge', () => {
    let s = run([{ type: 'GRANT', grant: grant(), now: t0 }, { type: 'FRAME', now: t0 + 1000 }, { type: 'STALL', now: t0 + 2000 }]);
    expect(liveBadge(s, t0 + 2500).text).toBe('Reconnecting…');
    s = playerReducer(s, { type: 'TICK', now: t0 + 12_000 });
    expect(s.status).toBe('reconnecting');
  });

  it('server says the camera is offline: explicit unavailable state, no player', () => {
    const s = run([{ type: 'GRANT_UNAVAILABLE', reason: 'offline' }]);
    expect(s).toMatchObject({ status: 'unavailable', grant: null });
  });
});
