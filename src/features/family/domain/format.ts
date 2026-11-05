// Hub-local date labels for Family screens. Pure TypeScript. Every pilot hub is in India (Asia/Kolkata, UTC+05:30, no
// daylight saving); the server reports times as ISO instants and dates as YYYY-MM-DD in the hub zone (BACKEND_CONTRACT_V2
// §1). Mirrors core/format/hubTime.ts (fixed offset, no Intl time-zone data in Hermes).

const IST_OFFSET_MIN = 330;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

const parts = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = new Date(t + IST_OFFSET_MIN * 60_000);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), wd: s.getUTCDay(), hh: s.getUTCHours(), mm: s.getUTCMinutes() };
};

const dateParts = (isoDate: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return { y, m: mo, d, wd: new Date(Date.UTC(y, mo, d)).getUTCDay() };
};

/** '2026-11-07' → 'Sat 7 Nov 2026'. Unparseable input is returned unchanged. */
export function dayLabel(isoDate: string): string {
  const p = dateParts(isoDate);
  return p ? `${DAYS[p.wd]} ${p.d} ${MONTHS[p.m]} ${p.y}` : isoDate;
}

/** '2026-11-07' → '7 Nov' (compact, for chart ticks and dense rows). */
export function shortDay(isoDate: string): string {
  const p = dateParts(isoDate);
  return p ? `${p.d} ${MONTHS[p.m]}` : isoDate;
}

/** ISO instant → 'Sat 14 Nov 2026' in hub time. */
export function instantDay(iso: string): string {
  const p = parts(iso);
  return p ? `${DAYS[p.wd]} ${p.d} ${MONTHS[p.m]} ${p.y}` : '';
}

/** ISO instant → '16:00' in hub time. */
export function instantTime(iso: string): string {
  const p = parts(iso);
  return p ? `${pad(p.hh)}:${pad(p.mm)}` : '';
}

/** ISO instant → '5 Nov 2026, 07:12' in hub time. */
export function instantStamp(iso: string): string {
  const p = parts(iso);
  return p ? `${p.d} ${MONTHS[p.m]} ${p.y}, ${pad(p.hh)}:${pad(p.mm)}` : '';
}

/** Calendar tile for an event: { month: 'Nov', day: '14', weekday: 'Sat' } in hub time. */
export function dateTile(iso: string): { month: string; day: string; weekday: string } | null {
  const p = parts(iso);
  return p ? { month: MONTHS[p.m] ?? '', day: String(p.d), weekday: DAYS[p.wd] ?? '' } : null;
}

/** 'Sat 14 Nov 2026 · 16:00–18:30' (same day) or with an end date when the event spans days. */
export function eventWhen(startsAt: string, endsAt: string | null): string {
  const start = `${instantDay(startsAt)} · ${instantTime(startsAt)}`;
  if (!endsAt) return start;
  return instantDay(endsAt) === instantDay(startsAt) ? `${start}–${instantTime(endsAt)}` : `${start} – ${instantDay(endsAt)} · ${instantTime(endsAt)}`;
}

/** '10:00–13:00' (same-day end) or '10:00' in hub time. */
export function timeRange(startsAt: string, endsAt: string | null): string {
  return endsAt && instantDay(endsAt) === instantDay(startsAt) ? `${instantTime(startsAt)}–${instantTime(endsAt)}` : instantTime(startsAt);
}
