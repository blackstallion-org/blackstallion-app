/** Display formatting for billing. Amounts are formatted from integer paise only (paymentState.formatPaise). */
import { dateLabel, hubDate, hubTime } from '@/core/format/hubTime';

import { formatPaise } from './domain/paymentState';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const money = (paise: number): string => formatPaise(paise);

/** '2026-11' → 'November 2026'. */
export function monthName(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : month;
}

/** '2026-11' → 'Nov 2026'. */
export const monthShort = (month: string): string => {
  const full = monthName(month);
  return full === month ? month : `${full.slice(0, 3)} ${full.slice(-4)}`;
};

/** ISO timestamp → '5 Nov 2026' in the hub zone; '' when unparseable. */
export function dayOf(iso: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return dateLabel(hubDate(new Date(iso)));
}

/** ISO timestamp → '5 Nov 2026, 09:12' in the hub zone. */
export function dayTimeOf(iso: string | null): string {
  const d = dayOf(iso);
  return d && iso ? `${d}, ${hubTime(iso)}` : '';
}

/** The month (YYYY-MM) of an ISO timestamp in the hub zone. */
export const monthOfIso = (iso: string): string => hubDate(new Date(iso)).slice(0, 7);

/** Basis points → '18%' / '12.5%'. */
export function rateLabel(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}

type Lines = readonly { type: 'tuition' | 'kit'; month: string | null }[];

/** Short title for an order or quote: 'Tuition · November 2026', 'Onboarding kit + tuition · Nov 2026', 'Tuition · 3 months'. */
export function itemsTitle(lines: Lines): string {
  const months = lines.flatMap((l) => (l.type === 'tuition' && l.month ? [l.month] : [])).sort();
  const kit = lines.some((l) => l.type === 'kit');
  if (months.length === 0) return kit ? 'Onboarding kit' : 'Order';
  const first = months[0] as string;
  const span = months.length === 1 ? monthName(first) : months.length === 2 ? `${monthShort(first)} and ${monthShort(months[1] as string)}` : `${months.length} months`;
  return kit ? `Onboarding kit + tuition · ${span}` : `Tuition · ${span}`;
}

