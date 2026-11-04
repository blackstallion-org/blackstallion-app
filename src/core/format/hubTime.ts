/**
 * Hub-local dates and times. Every pilot hub is in India (Asia/Kolkata, UTC+05:30, no daylight saving) and the
 * server derives session_date in that zone (MIG:356). A fixed offset avoids depending on Intl time-zone data in Hermes.
 * When a hub outside India exists, replace with the hub's IANA zone from the server.
 */
const IST_OFFSET_MIN = 330;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shifted = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of the hub-local day containing `d`. */
export function hubDate(d: Date): string {
  const s = shifted(d);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

/** HH:MM hub-local, from an ISO timestamp; '' when unparseable. */
export function hubTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = shifted(new Date(t));
  return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}

/** '2026-11-04' → '4 Nov 2026'; returns the input unchanged when it is not a date. */
export function dateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : isoDate;
}
