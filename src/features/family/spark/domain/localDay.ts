// Ported from g6-prework/src/spark (4 Nov 2026) unchanged in behaviour; pure TypeScript (lint-enforced).
// Calendar-day arithmetic in an IANA time zone using Intl only (works in Hermes/React Native and Node).

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

function parts(instant: Date, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of fmt(timeZone).formatToParts(instant)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** YYYY-MM-DD of the instant in the zone. */
export function localDate(instant: Date | string, timeZone: string): string {
  const p = parts(typeof instant === 'string' ? new Date(instant) : instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Offset (ms) of the zone from UTC at that instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of a local wall-clock time on a local date (DST-safe by two-pass correction). */
export function zonedTimeToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(new Date(guess), timeZone);
  t = guess - offsetMs(new Date(t), timeZone);
  return new Date(t);
}
