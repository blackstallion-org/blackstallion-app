/** Ported from g6-prework/test/spark.test.ts (vitest → jest globals); assertions unchanged. */
import { addDays, localDate, zonedTimeToUtc } from '../domain/localDay';
import { computeStreak, completionKey, mergeCompletion, type SparkCompletion } from '../domain/streak';
import { D18_PROPOSED, type SparkPolicy } from '../domain/policy';
import { controlLabels, coverage, initialPlayback, playbackReducer, type PlaybackEvent, type PlaybackState } from '../domain/playback';
import { presentDecorativePulse, presentWaveform, waveformFromSamples } from '../domain/waveform';
import { planSparkReminder, reminderStatusText } from '../domain/reminder';

// A test-only approved copy of the proposed policy. Production reads the policy from the server.
const APPROVED: SparkPolicy = { ...D18_PROPOSED, status: 'APPROVED', version: 'test-approved' };
const c = (sparkId: string, serverReceivedAt: string): SparkCompletion => ({ sparkId, serverReceivedAt });

describe('local day in the hub time zone', () => {
  it('uses IST, not UTC: 23:59 UTC is already the next day in Kolkata', () => {
    expect(localDate('2026-11-11T18:29:59Z', 'Asia/Kolkata')).toBe('2026-11-11'); // 23:59:59 IST
    expect(localDate('2026-11-11T18:30:00Z', 'Asia/Kolkata')).toBe('2026-11-12'); // 00:00 IST
  });
  it('converts 06:00 IST to 00:30 UTC', () => {
    expect(zonedTimeToUtc('2026-11-12', '06:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-12T00:30:00.000Z');
  });
  it('handles a DST zone correctly (policy is zone-driven, not hard-coded +5:30)', () => {
    expect(zonedTimeToUtc('2026-07-01', '06:00', 'Europe/London').toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(zonedTimeToUtc('2026-12-01', '06:00', 'Europe/London').toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('streaks', () => {
  const now = '2026-11-12T10:00:00Z'; // 15:30 IST on 12 Nov

  it('is disabled while the policy is only PROPOSED (D18 unsigned) but still reports today', () => {
    const r = computeStreak([c('s12', '2026-11-12T01:00:00Z')], D18_PROPOSED, now);
    expect(r).toEqual({ enabled: false, reason: 'policy-not-approved', completedToday: true });
  });

  it('counts consecutive hub-local days ending today', () => {
    const r = computeStreak([c('s10', '2026-11-10T01:00:00Z'), c('s11', '2026-11-11T01:00:00Z'), c('s12', '2026-11-12T01:00:00Z')], APPROVED, now);
    expect(r).toMatchObject({ enabled: true, current: 3, longest: 3, completedToday: true });
  });

  it('keeps yesterday’s streak alive until today ends', () => {
    const r = computeStreak([c('s10', '2026-11-10T01:00:00Z'), c('s11', '2026-11-11T01:00:00Z')], APPROVED, now);
    expect(r).toMatchObject({ current: 2, completedToday: false });
  });

  it('breaks after a missed day', () => {
    const r = computeStreak([c('s09', '2026-11-09T01:00:00Z'), c('s10', '2026-11-10T01:00:00Z')], APPROVED, now);
    expect(r).toMatchObject({ current: 0, longest: 2 });
  });

  it('a duplicate completion of the same Spark never adds to the streak', () => {
    let list: SparkCompletion[] = [];
    list = mergeCompletion(list, c('s12', '2026-11-12T01:00:00Z'));
    list = mergeCompletion(list, c('s12', '2026-11-12T01:00:05Z')); // retried request
    expect(list).toHaveLength(1);
    const raw = [c('s11', '2026-11-11T01:00:00Z'), c('s12', '2026-11-12T01:00:00Z'), c('s12', '2026-11-12T02:00:00Z')];
    expect(computeStreak(raw, APPROVED, now)).toMatchObject({ current: 2 });
  });

  it('two different Sparks on one day count as one day', () => {
    expect(computeStreak([c('a', '2026-11-12T01:00:00Z'), c('b', '2026-11-12T03:00:00Z')], APPROVED, now)).toMatchObject({ current: 1 });
  });

  it('uses the IST day boundary: 23:50 IST and 00:10 IST are two different days', () => {
    const r = computeStreak([c('a', '2026-11-11T18:20:00Z'), c('b', '2026-11-11T18:40:00Z')], APPROVED, '2026-11-11T19:00:00Z');
    expect(r).toMatchObject({ current: 2, completedToday: true });
  });

  it('ignores the device clock: only server receivedAt is used, future-dated rows are dropped', () => {
    // a phone set to tomorrow cannot pre-earn a day: the row is future-dated relative to server now
    expect(computeStreak([c('x', '2026-11-13T01:00:00Z')], APPROVED, now)).toMatchObject({ current: 0, completedToday: false });
  });

  it('completion key is stable per subject and Spark', () => {
    expect(completionKey('g1', 's12')).toBe(completionKey('g1', 's12'));
    expect(completionKey('g1', 's12')).not.toBe(completionKey('g2', 's12'));
  });
});

describe('Spark playback', () => {
  const run = (events: PlaybackEvent[], from: PlaybackState = initialPlayback) => events.reduce(playbackReducer, from);
  const ticks = (from: number, to: number, step = 250): PlaybackEvent[] => {
    const out: PlaybackEvent[] = [];
    for (let p = from + step; p <= to; p += step) out.push({ type: 'PROGRESS', positionMs: p });
    return out;
  };

  it('listening the whole clip gives full coverage', () => {
    const s = run([{ type: 'LOAD' }, { type: 'LOADED', durationMs: 30000 }, { type: 'PLAY' }, ...ticks(0, 29750), { type: 'ENDED' }]);
    expect(s.status).toBe('ended');
    expect(coverage(s)).toBe(1);
  });

  it('seeking to the end does not count as listening', () => {
    const s = run([{ type: 'LOAD' }, { type: 'LOADED', durationMs: 30000 }, { type: 'PLAY' }, ...ticks(0, 2000), { type: 'SEEK', positionMs: 29000 }, { type: 'PROGRESS', positionMs: 29250 }, { type: 'ENDED' }]);
    expect(coverage(s)).toBeLessThan(0.2);
  });

  it('a phone call interrupts and playback resumes where it stopped, without double-counting', () => {
    let s = run([{ type: 'LOAD' }, { type: 'LOADED', durationMs: 30000 }, { type: 'PLAY' }, ...ticks(0, 10000)]);
    s = run([{ type: 'INTERRUPT_BEGIN', reason: 'call' }], s);
    expect(s.status).toBe('interrupted');
    expect(controlLabels(s).hint).toMatch(/Paused by your phone/);
    s = run([{ type: 'INTERRUPT_END', systemSaysResume: true }], s);
    expect(s.status).toBe('playing');
    expect(s.positionMs).toBe(10000);
    s = run([...ticks(10000, 29750), { type: 'ENDED' }], s);
    expect(coverage(s)).toBe(1);
  });

  it('unplugging headphones pauses and never auto-resumes aloud', () => {
    let s = run([{ type: 'LOAD' }, { type: 'LOADED', durationMs: 30000 }, { type: 'PLAY' }, ...ticks(0, 5000), { type: 'INTERRUPT_BEGIN', reason: 'route-change' }]);
    s = run([{ type: 'INTERRUPT_END', systemSaysResume: true }], s);
    expect(s.status).toBe('paused');
  });

  it('a user pause before an interruption stays paused afterwards', () => {
    const s = run([{ type: 'LOAD' }, { type: 'LOADED', durationMs: 30000 }, { type: 'PLAY' }, { type: 'PAUSE' }, { type: 'INTERRUPT_BEGIN', reason: 'focus-loss' }, { type: 'INTERRUPT_END', systemSaysResume: true }]);
    expect(s.status).toBe('paused');
  });

  it('errors offer a retry with an accessible label', () => {
    const s = run([{ type: 'LOAD' }, { type: 'ERROR', message: 'Network unavailable' }]);
    expect(controlLabels(s)).toMatchObject({ primary: 'Try again', primaryAction: 'retry', hint: 'Network unavailable' });
    expect(run([{ type: 'RETRY' }], s).status).toBe('loading');
  });

  it('announces position as text for screen readers', () => {
    const s = run([{ type: 'LOAD' }, { type: 'LOADED', durationMs: 30000 }, { type: 'PLAY' }, ...ticks(0, 12000)]);
    expect(controlLabels(s)).toMatchObject({ primary: 'Pause', position: '0:12 of 0:30' });
  });
});

describe('waveform honesty', () => {
  it('builds 32 normalised bars from real samples', () => {
    const samples = Array.from({ length: 3200 }, (_, i) => Math.sin(i / 10) * (i < 1600 ? 0.2 : 0.8));
    const w = waveformFromSamples(samples, 32);
    expect(w.kind).toBe('measured');
    if (w.kind === 'measured') {
      expect(w.bars).toHaveLength(32);
      expect(Math.max(...w.bars)).toBe(1);
      expect(w.bars[0]!).toBeLessThan(w.bars[31]!); // louder second half shows as taller bars
    }
  });
  it('shows nothing when there is no audio data or only silence', () => {
    expect(waveformFromSamples(null).kind).toBe('unavailable');
    expect(waveformFromSamples(new Array(64).fill(0)).kind).toBe('unavailable');
    expect(presentWaveform({ kind: 'unavailable' }, false)).toMatchObject({ show: false });
  });
  it('respects reduced motion and labels decorative animation as decorative', () => {
    expect(presentWaveform({ kind: 'measured', bars: [1], source: 't' }, true)).toMatchObject({ show: true, animate: false });
    const pulse = presentDecorativePulse(true, false);
    expect(pulse).toMatchObject({ animate: true, accessibilityLabel: null });
    expect(pulse.caption).toMatch(/Decorative/);
    expect(presentDecorativePulse(true, true).animate).toBe(false);
  });
});

describe('morning reminder', () => {
  const at = (iso: string) => new Date(iso);
  it('schedules the next 06:00 hub-local time when allowed', () => {
    expect(planSparkReminder({ sparkReminder: true }, 'granted', APPROVED, at('2026-11-12T10:00:00Z')))
      .toMatchObject({ schedule: true, fireAtUtc: '2026-11-13T00:30:00.000Z', localDate: '2026-11-13', bestEffort: true });
    expect(planSparkReminder({ sparkReminder: true }, 'granted', APPROVED, at('2026-11-11T23:00:00Z')))
      .toMatchObject({ fireAtUtc: '2026-11-12T00:30:00.000Z' }); // 04:30 IST: today's 06:00 is still ahead
  });
  it('respects preference off and denied permission, and never schedules on a proposed policy', () => {
    expect(planSparkReminder({ sparkReminder: false }, 'granted', APPROVED, new Date())).toEqual({ schedule: false, reason: 'pref-off' });
    const denied = planSparkReminder({ sparkReminder: true }, 'denied', APPROVED, new Date());
    expect(denied).toEqual({ schedule: false, reason: 'permission-denied' });
    expect(reminderStatusText(denied)).toMatch(/phone settings/);
    expect(planSparkReminder({ sparkReminder: true }, 'undetermined', APPROVED, new Date())).toMatchObject({ reason: 'permission-not-asked' });
    expect(planSparkReminder({ sparkReminder: true }, 'granted', D18_PROPOSED, new Date())).toMatchObject({ reason: 'policy-not-approved' });
  });
});
