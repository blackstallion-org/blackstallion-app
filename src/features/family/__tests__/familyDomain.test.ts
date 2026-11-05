/** Pure Family logic: RSVP presentation (G9), replay latches, trends, clip gate, consent view, stream capability, dates. */
import { CommandLatches, consentKey, rsvpKey } from '../domain/commandLatch';
import { consentView, type ConsentState } from '../domain/consent';
import { dateTile, dayLabel, eventWhen, instantStamp, timeRange } from '../domain/format';
import { clipAccess, pairClips, routeId, scoreTrends, scoreY, signedUrlUsable, trendSentence } from '../domain/progress';
import { rsvpAction, rsvpFailure, type RsvpEventState } from '../domain/rsvp';
import { parseStreamCapability } from '../domain/stream';

describe('RSVP action per child (server decides open/closed; no waitlist)', () => {
  const ev = (o: Partial<RsvpEventState> = {}): RsvpEventState => ({ status: 'published', seatsLeft: 3, rsvpOpen: true, cancellationOpen: true, ...o });

  it('offers reserve, cancel, full, closed, started and cancelled states — and nothing while a request is in flight', () => {
    expect(rsvpAction(ev(), 'not_going', false).kind).toBe('rsvp');
    expect(rsvpAction(ev(), 'confirmed', false)).toEqual({ kind: 'cancel', label: 'Cancel place' });
    expect(rsvpAction(ev({ seatsLeft: 0 }), 'not_going', false)).toEqual({ kind: 'full', label: 'Full · no waitlist' });
    expect(rsvpAction(ev({ seatsLeft: 0 }), 'confirmed', false).kind).toBe('cancel'); // own seat still cancellable
    expect(rsvpAction(ev({ rsvpOpen: false }), 'not_going', false)).toEqual({ kind: 'closed', label: 'Replies closed' });
    expect(rsvpAction(ev({ rsvpOpen: false, cancellationOpen: false }), 'not_going', false)).toEqual({ kind: 'closed', label: 'Event has started' });
    expect(rsvpAction(ev({ rsvpOpen: false, cancellationOpen: false }), 'confirmed', false).kind).toBe('closed');
    expect(rsvpAction(ev({ status: 'cancelled' }), 'confirmed', false).kind).toBe('event-cancelled');
    expect(rsvpAction(ev(), 'not_going', true).kind).toBe('pending');
  });

  it('a list row (cancellation unknown) never offers a cancel the server has not opened', () => {
    expect(rsvpAction(ev({ cancellationOpen: null }), 'confirmed', false).kind).toBe('closed');
  });

  it('maps G9 PT409 prefixes, and a network failure never claims a seat', () => {
    expect(rsvpFailure('conflict', 'event_full: no seats left (no waitlist)')).toMatchObject({ refresh: true, retry: false, text: expect.stringMatching(/last place/) });
    expect(rsvpFailure('conflict', 'rsvp_closed: replies closed at 2026-11-19')).toMatchObject({ text: expect.stringMatching(/closed/) });
    expect(rsvpFailure('conflict', 'event_started: the event has started').text).toMatch(/started/);
    expect(rsvpFailure('conflict', 'event_cancelled: the event was cancelled').text).toMatch(/cancelled/);
    expect(rsvpFailure('conflict', 'operation id already used for a different request')).toMatchObject({ refresh: true, retry: false });
    expect(rsvpFailure('network', '')).toMatchObject({ retry: true, refresh: false, text: expect.stringMatching(/nothing changed yet.*won’t book twice/) });
    expect(rsvpFailure('notFound', 'event not found for this child').refresh).toBe(true);
  });
});

describe('replay latches (one operation id per payload until the server answers)', () => {
  it('reuses the id after a network failure and spends it after any server answer', () => {
    let n = 0;
    const l = new CommandLatches(() => `op-${++n}`);
    const k = rsvpKey('e1', 'c1', 'rsvp');
    const first = l.idFor(k);
    l.settle(k, 'network');
    expect(l.idFor(k)).toBe(first); // identical retry
    l.settle(k, 'acknowledged');
    expect(l.idFor(k)).not.toBe(first); // a later action is a new operation
    l.settle(k, 'refused');
    expect(l.pending()).toEqual([]);
  });

  it('a different payload (other child, other choice) never shares an id', () => {
    const l = new CommandLatches();
    expect(l.idFor(rsvpKey('e1', 'c1', 'rsvp'))).not.toBe(l.idFor(rsvpKey('e1', 'c2', 'rsvp')));
    expect(l.idFor(consentKey('c1', 'session_video', true, 'draft-1'))).not.toBe(l.idFor(consentKey('c1', 'session_video', false, 'draft-1')));
  });
});

describe('score trends (small multiples on one fixed 1–10 scale)', () => {
  const s = (id: string, date: string, r: number) => ({ id, date, scores: { riding: r, ground: 5, stable: 6 } });
  it('orders oldest → newest, keeps the last 10, never smooths', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => s(`s${i}`, `2026-10-${String(10 + i).padStart(2, '0')}`, (i % 10) + 1)).reverse();
    const [riding] = scoreTrends(sessions);
    expect(riding?.points).toHaveLength(10);
    expect(riding?.points[0]?.date).toBe('2026-10-12');
    expect(riding?.latest).toBe(2);
    expect(trendSentence('Riding', riding!)).toMatch(/^Riding: 3, 4, .* out of 10 over the last 10 sessions; latest 2$/);
  });
  it('maps 10 to the top and 1 to the bottom of the plot', () => {
    expect(scoreY(10, 44, 4)).toBe(4);
    expect(scoreY(1, 44, 4)).toBe(40);
    expect(scoreY(15, 44, 4)).toBe(4);
  });
});

describe('private clip gate (fails closed)', () => {
  it('needs a clip, CURRENT session_video consent and a media boundary', () => {
    expect(clipAccess(false, true, true).kind).toBe('no-clip');
    expect(clipAccess(true, null, true).kind).toBe('consent-unknown');
    expect(clipAccess(true, false, true).kind).toBe('consent-missing');
    expect(clipAccess(true, true, false).kind).toBe('media-unavailable');
    expect(clipAccess(true, true, true).kind).toBe('allowed');
  });
  it('pairs the earliest clip with the requested (or newest) one; unavailable with fewer than two', () => {
    const c = [{ id: 'b', date: '2026-10-03' }, { id: 'a', date: '2026-09-05' }, { id: 'c', date: '2026-11-07' }];
    expect(pairClips(c)).toEqual({ earlier: c[1], recent: c[2] });
    expect(pairClips(c, 'b')).toEqual({ earlier: c[1], recent: c[0] });
    expect(pairClips(c, 'a')).toEqual({ earlier: c[1], recent: c[2] }); // never pairs a clip with itself
    expect(pairClips(c.slice(0, 1))).toBeNull();
  });
  it('treats a signed URL as unusable near expiry', () => {
    expect(signedUrlUsable(100_000, 50_000)).toBe(true);
    expect(signedUrlUsable(100_000, 95_000)).toBe(false);
  });
});

describe('route ids are untrusted', () => {
  it('accepts one short opaque id only', () => {
    expect(routeId('3f2a9c4e-0000-4000-8000-000000000001')).toBe('3f2a9c4e-0000-4000-8000-000000000001');
    expect(routeId(['syn-ts-a1-01', 'x'])).toBe('syn-ts-a1-01');
    for (const bad of [undefined, '', '../x', 'a b', 'x'.repeat(65), 'id;drop', 'aarav@example.com']) expect(routeId(bad)).toBeNull();
  });
});

describe('consent view (server data; withdrawal never blocked by wording)', () => {
  const st = (o: Partial<ConsentState>): ConsentState => ({ purpose: 'session_video', state: 'not_set', granted: false, allowed: false, policyVersion: null, currentPolicyVersion: 'draft-1', recordedAt: null, ...o });
  it('labels each state with one action', () => {
    expect(consentView(st({}))).toMatchObject({ label: 'Not set', action: { kind: 'grant' } });
    expect(consentView(st({ state: 'granted', granted: true, allowed: true, policyVersion: 'draft-1' }))).toMatchObject({ label: 'Allowed', tone: 'success', action: { kind: 'withdraw' } });
    expect(consentView(st({ state: 'withdrawn' }))).toMatchObject({ label: 'Withdrawn', action: { kind: 'grant' } });
  });
  it('a grant under older wording is not "allowed" and asks for review', () => {
    const v = consentView(st({ state: 'granted', granted: true, allowed: false, policyVersion: 'draft-0', currentPolicyVersion: 'draft-1' }));
    expect(v).toMatchObject({ label: 'Needs review', tone: 'warning', action: { kind: 'grant' } });
    expect(v.note).toMatch(/version draft-1/);
  });
});

describe('stall-camera capability (never available on a guess)', () => {
  it('maps every G9 reason and treats anything malformed as unavailable', () => {
    expect(parseStreamCapability({ capability: 'stall_stream', status: 'unavailable', reason: 'feature_disabled', horse_assigned: true })).toEqual({ status: 'unavailable', reason: 'feature_disabled', horseAssigned: true });
    expect(parseStreamCapability({ capability: 'stall_stream', status: 'unavailable', reason: 'provider_not_integrated', horse_assigned: true }).status).toBe('unavailable');
    expect(parseStreamCapability({ capability: 'stall_stream', status: 'available', horse_assigned: false }).status).toBe('unavailable');
    expect(parseStreamCapability({ status: 'available', horse_assigned: true }).status).toBe('unavailable'); // wrong capability
    expect(parseStreamCapability(null)).toEqual({ status: 'unavailable', reason: 'no_horse', horseAssigned: false });
    expect(parseStreamCapability({ capability: 'stall_stream', status: 'available', horse_assigned: true }).status).toBe('available');
  });
});

describe('hub-local dates (Asia/Kolkata)', () => {
  it('formats session days and event instants in hub time', () => {
    expect(dayLabel('2026-11-07')).toBe('Sat 7 Nov 2026');
    expect(dayLabel('not a date')).toBe('not a date');
    expect(eventWhen('2026-11-14T04:30:00Z', '2026-11-14T07:30:00Z')).toBe('Sat 14 Nov 2026 · 10:00–13:00');
    expect(eventWhen('2026-11-14T18:00:00Z', null)).toBe('Sat 14 Nov 2026 · 23:30');
    expect(timeRange('2026-11-14T18:00:00Z', '2026-11-14T19:00:00Z')).toBe('23:30'); // ends next day locally
    expect(dateTile('2026-11-14T19:00:00Z')).toEqual({ month: 'Nov', day: '15', weekday: 'Sun' });
    expect(instantStamp('2026-09-01T02:00:00Z')).toBe('1 Sep 2026, 07:30');
  });
});
