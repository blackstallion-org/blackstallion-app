/**
 * Billing records as the G7 server sends them (server/reference/g7-billing, `app_private.billing_order_json`,
 * `billing_price_items`, `billing_checkout_status`). Pure TypeScript: no React, Expo or transport imports.
 *
 * Every amount is integer paise chosen by the server from approved price versions. The phone never prices, taxes or
 * rounds anything: it only checks that what arrived is internally consistent (lines add up, GST is exact at the rate the
 * server states) and refuses anything else, so a malformed answer is an error state, never a payment.
 */
import { isUuid } from '@/features/field/domain/operation';

import { parseServerOrder, type OrderState, type ServerOrder, type ServerOrderLine } from './paymentState';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const paise = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const iso = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const optIso = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : iso(v) ? v : undefined);
const rateBp = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5000;
/** The table constraint `gst_paise * 10000 = base_paise * gst_rate_bp`: no line may carry a rounded tax amount. */
const exactGst = (base: number, gst: number, bp: number) => gst * 10000 === base * bp;
const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export interface BillingLine extends ServerOrderLine {
  /** Basis points: 1800 = 18 %. As stored on the line when the order was made (G7-D07 split still unsigned). */
  gstRateBp: number;
  unitAmountPaise: number;
}

export interface BillingRefund {
  amountPaise: number;
  appliedAt: string;
}

/** One billing order (and, once settled, its invoice), exactly as the payer may see it. */
export interface BillingOrder extends Omit<ServerOrder, 'lines'> {
  lines: BillingLine[];
  createdAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  clientReturnedAt: string | null;
  paidAt: string | null;
  refunds: BillingRefund[];
}

/**
 * Strict parse of `billing_order_json`. Builds on paymentState.parseServerOrder (state, totals, invoice ⇔ settled) and
 * adds the fields the screens need. Unknown or inconsistent input returns null.
 */
export function parseBillingOrder(json: unknown): BillingOrder | null {
  const base = parseServerOrder(json);
  if (!base || !isObj(json)) return null;
  if (!iso(json.createdAt)) return null;
  const expiresAt = optIso(json.expiresAt);
  const cancelledAt = optIso(json.cancelledAt);
  const clientReturnedAt = optIso(json.clientReturnedAt);
  const paidAt = optIso(json.paidAt);
  if (expiresAt === undefined || cancelledAt === undefined || clientReturnedAt === undefined || paidAt === undefined) return null;
  if (base.state === 'cancelled' && cancelledAt === null) return null;

  const rawLines = json.lines as unknown[]; // parseServerOrder has checked it is a non-empty array of objects
  const lines: BillingLine[] = [];
  for (const [i, l] of base.lines.entries()) {
    const raw = rawLines[i] as Obj;
    const unit = raw.unitAmountPaise ?? l.basePaise;
    if (!rateBp(raw.gstRateBp) || !paise(unit) || unit !== l.basePaise || !exactGst(l.basePaise, l.gstPaise, raw.gstRateBp)) return null;
    lines.push({ ...l, gstRateBp: raw.gstRateBp, unitAmountPaise: unit });
  }
  if (lines.reduce((s, l) => s + l.basePaise, 0) !== base.subtotalPaise) return null;

  const refunds: BillingRefund[] = [];
  if (json.refunds !== undefined && json.refunds !== null) {
    if (!Array.isArray(json.refunds)) return null;
    for (const r of json.refunds) {
      if (!isObj(r) || !paise(r.amountPaise) || r.amountPaise === 0 || !iso(r.appliedAt)) return null;
      refunds.push({ amountPaise: r.amountPaise, appliedAt: r.appliedAt });
    }
  }
  return { ...base, lines, createdAt: json.createdAt, expiresAt, cancelledAt, clientReturnedAt, paidAt, refunds };
}

/** Server-side price for a request (`billing_quote`). Nothing is written and nothing is owed until an order exists. */
export interface BillingQuote {
  currency: 'INR';
  lines: { lineNo: number; type: 'tuition' | 'kit'; label: string; month: string | null; gstRateBp: number; basePaise: number; gstPaise: number; totalPaise: number }[];
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
}

export function parseQuote(json: unknown): BillingQuote | null {
  if (!isObj(json) || json.currency !== 'INR' || !Array.isArray(json.lines) || json.lines.length === 0) return null;
  const { subtotalPaise, gstPaise, totalPaise } = json;
  if (!paise(subtotalPaise) || !paise(gstPaise) || !paise(totalPaise) || subtotalPaise + gstPaise !== totalPaise) return null;
  const lines: BillingQuote['lines'] = [];
  for (const l of json.lines) {
    if (!isObj(l) || typeof l.lineNo !== 'number' || (l.type !== 'tuition' && l.type !== 'kit') || !str(l.label)) return null;
    if (!paise(l.basePaise) || !paise(l.gstPaise) || !paise(l.totalPaise) || l.basePaise + l.gstPaise !== l.totalPaise) return null;
    if (!rateBp(l.gstRateBp) || !exactGst(l.basePaise, l.gstPaise, l.gstRateBp)) return null;
    const month = typeof l.month === 'string' ? l.month : null;
    if (l.type === 'tuition' ? month === null || !MONTH.test(month) : month !== null) return null;
    lines.push({ lineNo: l.lineNo, type: l.type, label: l.label, month, gstRateBp: l.gstRateBp, basePaise: l.basePaise, gstPaise: l.gstPaise, totalPaise: l.totalPaise });
  }
  if (lines.reduce((s, l) => s + l.totalPaise, 0) !== totalPaise || lines.reduce((s, l) => s + l.basePaise, 0) !== subtotalPaise) return null;
  return { currency: 'INR', lines, subtotalPaise, gstPaise, totalPaise };
}

/** `billing_checkout_status()`: the server-side switch (G7-D15: off for the pilot) and the kit channel (G7-D03). */
export interface CheckoutStatus {
  enabled: boolean;
  kitInApp: boolean;
}

export function parseCheckoutStatus(json: unknown): CheckoutStatus | null {
  if (!isObj(json) || typeof json.enabled !== 'boolean' || typeof json.kitInApp !== 'boolean') return null;
  return { enabled: json.enabled, kitInApp: json.kitInApp };
}

/** Order and invoice route ids are billing order UUIDs (invoice numbers like 26-27/000041 contain a slash). */
export const isBillingOrderId = (v: unknown): v is string => isUuid(v);

// ------------------------------------------------------------------ billing months (Asia/Kolkata, as the server)

const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The billing month (YYYY-MM) containing `at`, in the hub zone the server uses (`p_as_of at time zone 'Asia/Kolkata'`). */
export function billingMonthOf(at: Date): string {
  const s = new Date(at.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}`;
}

export function addMonths(month: string, n: number): string {
  if (!MONTH.test(month) || !Number.isInteger(n)) throw new Error('month must be YYYY-MM');
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}`;
}

// ------------------------------------------------------------------ what a month of tuition looks like to the payer

export type MonthCoverage =
  | { kind: 'settled' | 'confirming' | 'open'; order: BillingOrder }
  | { kind: 'none' };

const SETTLED: readonly OrderState[] = ['paid', 'partially_refunded'];
const OPEN: readonly OrderState[] = ['created', 'awaiting_payment', 'failed'];

/**
 * Which order (if any) already covers one cadet's tuition month, with the precedence the server's
 * `billing_create_order` uses: settled or confirming beats open; cancelled, expired and fully refunded orders cover
 * nothing. A display hint only: the server refuses a second order itself (PT409 already_paid / order_open).
 */
export function coverageFor(orders: readonly BillingOrder[], cadetId: string, month: string): MonthCoverage {
  const covering = orders.filter((o) => o.cadetId === cadetId && o.lines.some((l) => l.type === 'tuition' && l.month === month));
  const pick = (states: readonly OrderState[]) => covering.find((o) => states.includes(o.state));
  const settled = pick(SETTLED);
  if (settled) return { kind: 'settled', order: settled };
  const confirming = pick(['awaiting_confirmation']);
  if (confirming) return { kind: 'confirming', order: confirming };
  const open = pick(OPEN);
  if (open) return { kind: 'open', order: open };
  return { kind: 'none' };
}

/** Orders the payer still has to act on or wait for (any month), newest first as listed. */
export const inProgress = (orders: readonly BillingOrder[]): BillingOrder[] =>
  orders.filter((o) => OPEN.includes(o.state) || o.state === 'awaiting_confirmation');

// ------------------------------------------------------------------ the pay action gate

export type PayBlock = 'checkoutOff' | 'providerMissing';

/**
 * Whether the Pay action may run. Two independent gates, both must be open:
 *  - the server switch `billing_checkout_status().enabled` (G7-D15: off for the pilot);
 *  - a connected provider checkout in this build (Edge Function E-1 + checkout SDK; G7-D13: no sandbox, not written).
 * Even when both are open the result of checkout is only ever a hint (paymentState.nextAfterCheckout).
 */
export function payGate(input: { checkoutEnabled: boolean; providerConnected: boolean }): { allowed: true } | { allowed: false; reason: PayBlock } {
  if (!input.checkoutEnabled) return { allowed: false, reason: 'checkoutOff' };
  if (!input.providerConnected) return { allowed: false, reason: 'providerMissing' };
  return { allowed: true };
}

// ------------------------------------------------------------------ pay requests

export type PayItem = { type: 'tuition'; month: string } | { type: 'kit' };

/**
 * Items in one canonical order (kit first, then months ascending), as plain objects. The server hashes `p_items` as
 * sent to recognise a replay, so a retried request must send exactly the same list.
 */
export function canonicalItems(items: readonly PayItem[]): PayItem[] {
  const kit: PayItem[] = items.some((i) => i.type === 'kit') ? [{ type: 'kit' }] : [];
  const months = [...new Set(items.flatMap((i) => (i.type === 'tuition' ? [i.month] : [])))].sort();
  return [...kit, ...months.map((month): PayItem => ({ type: 'tuition', month }))];
}

/** Canonical key of a pay request: the same cadet and items give the same key, so one operation id is reused. */
export function payKey(cadetId: string, items: readonly PayItem[]): string {
  return [cadetId, ...canonicalItems(items).map((i) => (i.type === 'kit' ? 'kit' : i.month))].join('|');
}
