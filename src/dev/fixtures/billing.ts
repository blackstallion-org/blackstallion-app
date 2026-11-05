/**
 * DEVELOPMENT-ONLY synthetic billing fixtures (BI-01..BI-06). Invented families, children "(sample)", references
 * "BO-SAMPLE…"; every billing screen shows the synthetic-data banner while these are in use.
 *
 * They mirror the G7 server rules so the screens exercise real behaviour: order state is DERIVED at read time with
 * `app_private.billing_state`'s precedence (an unpaid order expires); orders are payer-only (another payer's id is
 * "not found"); `createOrder` replays by operation id and refuses while checkout is switched off (PT423, G7-D15);
 * nothing here can make an order paid (no webhook exists in a fixture). Prices are the approved website prices
 * (D21: ₹8,500 / ₹12,500 a month + 18 % GST), from 1 Nov 2026 on. Guardian A's synthetic server runs in TEST MODE with the labelled local test checkout (no
 * provider, no money); other families keep the pilot default, checkout OFF (G7-D15). Autopay records are a DESIGN
 * PREVIEW only: no mandate contract exists (G7-D11).
 */
import { BillingError } from '@/features/billing/domain/billingErrors';
import type { Mandate } from '@/features/billing/domain/autopay';
import {
  addMonths,
  billingMonthOf,
  canonicalItems,
  coverageFor,
  inProgress,
  parseBillingOrder,
  type BillingOrder,
} from '@/features/billing/domain/orders';
import type { OrderState } from '@/features/billing/domain/paymentState';
import { createTestCheckout } from '@/features/billing/data/testCheckout';
import type {
  BillingOrderRepository,
  BillingRepositories,
  BillingScope,
  ChildMonth,
  OrderWithChild,
} from '@/features/billing/data/repositories';

type Fee = { code: 'core_monthly' | 'elite_monthly' | 'onboarding_kit'; label: string; paise: number; rateBp: number };
const FEES: Record<Fee['code'], Fee> = {
  core_monthly: { code: 'core_monthly', label: 'Core Cadets, monthly tuition', paise: 850000, rateBp: 1800 },
  elite_monthly: { code: 'elite_monthly', label: 'Sovereign Elite, monthly tuition', paise: 1250000, rateBp: 1800 },
  onboarding_kit: { code: 'onboarding_kit', label: 'Onboarding kit (one-time)', paise: 500000, rateBp: 1800 },
};
const gstOf = (f: Fee) => (f.paise * f.rateBp) / 10000;

type Ledger = 'none' | 'PENDING' | 'FAILED' | 'PAID' | 'REFUNDED';
type Rec = {
  id: string;
  reference: string;
  payerId: string;
  cadetId: string;
  lines: { fee: Fee; month: string | null }[];
  createdAt: number;
  expiresAt: number;
  cancelledAt?: number;
  clientReturnedAt?: number;
  ledger: Ledger;
  paidAt?: number;
  invoice?: { number: string; issuedAt: number };
  refunds: { amountPaise: number; at: number }[];
  underReview: boolean;
  opIds: string[];
  opKey: string;
};

type Child = { cadetId: string; name: string; plan: Fee['code'] | null; enrolled: boolean };
export type BillingFixtureFamily = {
  children: Child[];
  /**
   * The synthetic server's checkout switch. Guardian A's family runs in labelled TEST MODE (the local test checkout,
   * no money moves) so the whole flow can be exercised; the dual-role family keeps the pilot default, OFF (G7-D15).
   */
  checkout: boolean;
  failure?: 'overview-network';
};

const HOUR = 3_600_000;
const MIN = 60_000;
const ORDER_TTL = 2 * HOUR; // G7-D06 engineering default

/** G7 `app_private.billing_state` precedence, evaluated at `asOf` (never stored). */
function stateOf(r: Rec, asOf: number): OrderState {
  if (r.ledger === 'REFUNDED') return 'refunded';
  if (r.ledger === 'PAID' && r.refunds.length > 0) return 'partially_refunded';
  if (r.ledger === 'PAID') return 'paid';
  if (r.cancelledAt !== undefined) return 'cancelled';
  if (r.clientReturnedAt !== undefined) return 'awaiting_confirmation';
  if (asOf >= r.expiresAt) return 'expired';
  if (r.ledger === 'none') return 'created';
  if (r.ledger === 'FAILED') return 'failed';
  return 'awaiting_payment';
}

const isoOf = (t: number) => new Date(t).toISOString();

/** The JSON `billing_order_json` would send for this record. */
function jsonOf(r: Rec, asOf: number): Record<string, unknown> {
  const lines = r.lines.map((l, i) => {
    const gst = gstOf(l.fee);
    return {
      lineNo: i + 1,
      type: l.fee.code === 'onboarding_kit' ? 'kit' : 'tuition',
      feeCode: l.fee.code,
      label: l.fee.label,
      month: l.month,
      priceVersionId: `sample-price-${l.fee.code}-v1`,
      unitAmountPaise: l.fee.paise,
      gstRateBp: l.fee.rateBp,
      basePaise: l.fee.paise,
      gstPaise: gst,
      totalPaise: l.fee.paise + gst,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.basePaise, 0);
  const gst = lines.reduce((s, l) => s + l.gstPaise, 0);
  return {
    orderId: r.id,
    reference: r.reference,
    cadetId: r.cadetId,
    state: stateOf(r, asOf),
    underReview: r.underReview,
    currency: 'INR',
    subtotalPaise: subtotal,
    gstPaise: gst,
    totalPaise: subtotal + gst,
    createdAt: isoOf(r.createdAt),
    expiresAt: isoOf(r.expiresAt),
    cancelledAt: r.cancelledAt === undefined ? null : isoOf(r.cancelledAt),
    clientReturnedAt: r.clientReturnedAt === undefined ? null : isoOf(r.clientReturnedAt),
    gatewayOrderId: r.ledger === 'none' ? null : `order_SAMPLE${r.reference.slice(-4)}`,
    paidAt: r.paidAt === undefined ? null : isoOf(r.paidAt),
    refundedPaise: r.refunds.reduce((s, x) => s + x.amountPaise, 0),
    invoice: r.invoice ? { number: r.invoice.number, issuedAt: isoOf(r.invoice.issuedAt) } : null,
    lines,
    refunds: r.refunds.map((x) => ({ amountPaise: x.amountPaise, appliedAt: isoOf(x.at) })),
  };
}

/** Indian financial year of a timestamp (Asia/Kolkata), as `billing_financial_year`: Nov 2026 → "26-27". */
function financialYear(t: number): string {
  const [y, m] = billingMonthOf(new Date(t)).split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const uuid = (n: number) => `5a3b1e00-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const SAMPLE_ORDER_IDS = {
  meeraNextConfirming: uuid(1),
  aaravNextFailed: uuid(2),
  meeraThisPaid: uuid(3),
  aaravThisCancelled: uuid(4),
  meeraThisExpired: uuid(5),
  otherPayers: uuid(90),
} as const;

const FAMILIES: Record<string, BillingFixtureFamily> = {
  'syn-guardian-a': {
    checkout: true,
    children: [
      { cadetId: 'syn-cadet-a1', name: 'Aarav (sample)', plan: 'core_monthly', enrolled: true },
      { cadetId: 'syn-cadet-a2', name: 'Meera (sample)', plan: 'elite_monthly', enrolled: true },
    ],
  },
  'syn-guardian-b': { checkout: false, children: [] },
  'syn-dual': { checkout: false, children: [{ cadetId: 'syn-cadet-d1', name: 'Isha (sample)', plan: 'core_monthly', enrolled: true }] },
  'syn-guardian-err': { checkout: false, children: [{ cadetId: 'syn-cadet-e1', name: 'Dev (sample)', plan: 'core_monthly', enrolled: true }], failure: 'overview-network' },
};

function seedOrders(now: number): Rec[] {
  const month = billingMonthOf(new Date(now));
  const next = addMonths(month, 1);
  const rec = (n: number, payerId: string, cadetId: string, fee: Fee, m: string, createdAt: number, extra: Partial<Rec>): Rec => ({
    id: uuid(n),
    reference: `BO-SAMPLE${String(n).padStart(4, '0')}`,
    payerId,
    cadetId,
    lines: [{ fee, month: m }],
    createdAt,
    expiresAt: createdAt + ORDER_TTL,
    ledger: 'PENDING',
    refunds: [],
    underReview: false,
    opIds: [`5a3b1e00-0000-4000-9000-${String(n).padStart(12, '0')}`],
    opKey: JSON.stringify({ cadet: cadetId, items: canonicalItems([{ type: 'tuition', month: m }]) }),
    ...extra,
  });
  const paidAt = now - 2 * 24 * HOUR - 3 * HOUR;
  return [
    // Paid ahead for next month; the checkout said "success" 45 minutes ago and no verified capture has arrived, so the
    // academy's overdue check has opened a case: the family sees "under review", never "paid".
    rec(1, 'syn-guardian-a', 'syn-cadet-a2', FEES.elite_monthly, next, now - 50 * MIN, { clientReturnedAt: now - 45 * MIN, underReview: true }),
    // Next month, the provider reported payment.failed: payable again until the order expires.
    rec(2, 'syn-guardian-a', 'syn-cadet-a1', FEES.core_monthly, next, now - 40 * MIN, { ledger: 'FAILED' }),
    // This month, settled by a verified capture: invoice number from the server.
    rec(3, 'syn-guardian-a', 'syn-cadet-a2', FEES.elite_monthly, month, paidAt - 4 * MIN, {
      ledger: 'PAID',
      paidAt,
      clientReturnedAt: paidAt - MIN,
      invoice: { number: `${financialYear(paidAt)}/000017`, issuedAt: paidAt + 2000 },
    }),
    // This month, cancelled by the payer before paying (does not block a new order).
    rec(4, 'syn-guardian-a', 'syn-cadet-a1', FEES.core_monthly, month, now - 3 * 24 * HOUR, { ledger: 'none', cancelledAt: now - 3 * 24 * HOUR + 6 * MIN }),
    // This month, an earlier attempt that was never paid and expired.
    rec(5, 'syn-guardian-a', 'syn-cadet-a2', FEES.elite_monthly, month, now - 4 * 24 * HOUR, {}),
    // Another family's order: guardian A must get "not found" for it.
    rec(90, 'syn-guardian-other', 'syn-cadet-x1', FEES.core_monthly, month, now - 5 * HOUR, {}),
  ];
}

function seedMandates(now: number): Record<string, Mandate[]> {
  const month = billingMonthOf(new Date(now));
  const updated = isoOf(now - 26 * HOUR);
  return {
    'syn-guardian-a': [
      { cadetId: 'syn-cadet-a1', mandateId: 'sample-mandate-a1', state: 'pending_authorisation', method: 'enach', maxAmountPaise: 1500000, nextDebit: null, updatedAt: updated },
      {
        cadetId: 'syn-cadet-a2',
        mandateId: 'sample-mandate-a2',
        state: 'active',
        method: 'upi_autopay',
        maxAmountPaise: 1500000,
        nextDebit: { onDate: `${addMonths(month, 2)}-01`, amountPaise: FEES.elite_monthly.paise + gstOf(FEES.elite_monthly) },
        updatedAt: updated,
      },
    ],
    'syn-dual': [{ cadetId: 'syn-cadet-d1', mandateId: null, state: 'none', method: null, maxAmountPaise: null, nextDebit: null, updatedAt: updated }],
    'syn-guardian-b': [],
  };
}

const err = (kind: BillingError['kind'], message: string, hint?: string, reference?: string) => new BillingError(kind, message, hint, reference);
const NOT_FOUND = () => err('notFound', 'This payment or invoice can’t be found for your account.', 'not_found', 'PT404');

export type BillingFixtureOptions = {
  latencyMs?: number;
  /** Overrides every family's server switch (tests). By default each family uses its own (see FAMILIES). */
  checkoutEnabled?: boolean;
  /** Extra or replacement synthetic families (tests), keyed by subject id. */
  families?: Record<string, BillingFixtureFamily>;
  now?: () => number;
};

/** Synthetic, clearly labelled development fixtures for the billing screens. */
export function createBillingFixtures({ latencyMs = 350, checkoutEnabled, families = {}, now = Date.now }: BillingFixtureOptions = {}): BillingRepositories {
  const FAM: Record<string, BillingFixtureFamily> = { ...FAMILIES, ...families };
  const switchOn = (scope: BillingScope) => checkoutEnabled ?? FAM[scope.subjectId]?.checkout ?? false;
  const records = seedOrders(now());
  const mandates = seedMandates(now());
  const wait = () => (latencyMs > 0 ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());

  const familyOf = (scope: BillingScope): BillingFixtureFamily => {
    if (scope.experience !== 'family') throw err('forbidden', 'Billing is only available in the Family experience.', undefined, 'SCOPE');
    return FAM[scope.subjectId] ?? { checkout: false, children: [] };
  };
  const view = (scope: BillingScope, r: Rec): OrderWithChild => {
    const o: BillingOrder | null = parseBillingOrder(jsonOf(r, now()));
    if (!o) throw new Error(`fixture order ${r.reference} does not parse`); // fixtures are built to parse: a fixture bug
    return { ...o, childName: familyOf(scope).children.find((c) => c.cadetId === r.cadetId)?.name ?? null };
  };
  const own = (scope: BillingScope) =>
    records.filter((r) => r.payerId === scope.subjectId).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  const ownRecord = (scope: BillingScope, id: string) => {
    const r = records.find((x) => x.id === id && x.payerId === scope.subjectId); // payer only: anyone else's is "not found"
    if (!r) throw NOT_FOUND();
    return r;
  };

  const orders: BillingOrderRepository = {
    async getCheckoutStatus(scope) {
      await wait();
      familyOf(scope);
      return { enabled: switchOn(scope), kitInApp: false };
    },

    async getOverview(scope) {
      await wait();
      const fam = familyOf(scope);
      if (fam.failure === 'overview-network') throw err('network', 'We couldn’t reach the academy. Check your connection and try again — repeating it is safe and won’t pay twice.', undefined, 'HTTP-0');
      const month = billingMonthOf(new Date(now()));
      const history = own(scope).map((r) => view(scope, r));
      const children: ChildMonth[] = fam.children.map((c) => {
        const base = { cadetId: c.cadetId, name: c.name, month };
        const cover = coverageFor(history, c.cadetId, month);
        if (cover.kind !== 'none') return { ...base, kind: cover.kind, order: cover.order as OrderWithChild };
        if (!c.enrolled) return { ...base, kind: 'blocked', reason: 'notEnrolled' };
        if (!c.plan) return { ...base, kind: 'blocked', reason: 'noPlan' };
        const fee = FEES[c.plan];
        const gst = gstOf(fee);
        return {
          ...base,
          kind: 'due',
          quote: {
            currency: 'INR',
            lines: [{ lineNo: 1, type: 'tuition', label: fee.label, month, gstRateBp: fee.rateBp, basePaise: fee.paise, gstPaise: gst, totalPaise: fee.paise + gst }],
            subtotalPaise: fee.paise,
            gstPaise: gst,
            totalPaise: fee.paise + gst,
          },
        };
      });
      const shown = new Set(children.flatMap((c) => ('order' in c ? [c.order.orderId] : [])));
      return {
        source: 'synthetic-preview',
        checkout: { enabled: switchOn(scope), kitInApp: false }, // G7-D03: the kit is not sold in the app
        month,
        children,
        otherInProgress: inProgress(history).filter((o) => !shown.has(o.orderId)) as OrderWithChild[],
        recent: history.slice(0, 3),
        addOns: [],
        historyCount: history.length,
        historyHasMore: false,
      };
    },

    async listOrders(scope, before) {
      await wait();
      if (familyOf(scope).failure) throw err('unexpected', 'Something went wrong. Nothing is confirmed; try again.', undefined, 'HTTP-500');
      const cut = before ? Date.parse(before) : Number.POSITIVE_INFINITY;
      const page = own(scope).filter((r) => r.createdAt < cut).slice(0, 20);
      const last = page[page.length - 1];
      return { orders: page.map((r) => view(scope, r)), nextBefore: page.length === 20 && last ? isoOf(last.createdAt) : null };
    },

    async getOrder(scope, orderId) {
      await wait();
      if (familyOf(scope).failure) throw err('network', 'We couldn’t reach the academy. Check your connection and try again — repeating it is safe and won’t pay twice.', undefined, 'HTTP-0');
      return view(scope, ownRecord(scope, orderId));
    },

    async createOrder(scope, req) {
      await wait();
      const fam = familyOf(scope);
      const child = fam.children.find((c) => c.cadetId === req.cadetId);
      if (!child) throw NOT_FOUND();
      const items = canonicalItems(req.items);
      const key = JSON.stringify({ cadet: req.cadetId, items });
      // Replay of a committed operation returns its original order (even after checkout is switched off).
      const replay = records.find((r) => r.payerId === scope.subjectId && r.opIds.includes(req.operationId));
      if (replay) {
        if (replay.opKey !== key) throw err('conflict', 'This payment request clashed with an earlier one. Go back to Billing and start again.', 'operation_reused', 'PT409');
        return { order: view(scope, replay), replayed: true, reused: false };
      }
      if (!switchOn(scope)) throw err('checkoutOff', 'Online payment isn’t switched on yet. Nothing was charged.', 'checkout_disabled', 'PT423');
      if (!child.plan) throw err('invalid', 'The academy hasn’t set a plan for this month yet.', 'no_plan', 'PT422');
      if (items.some((i) => i.type === 'kit')) throw err('invalid', 'The kit isn’t sold in the app.', 'kit_not_sold_in_app', 'PT422');
      const months = items.flatMap((i) => (i.type === 'tuition' ? [i.month] : []));
      const t = now();
      const live = records.filter((r) => r.cadetId === req.cadetId && r.lines.some((l) => l.month !== null && months.includes(l.month)));
      if (live.some((r) => ['paid', 'partially_refunded', 'awaiting_confirmation'].includes(stateOf(r, t)))) {
        throw err('conflict', 'This is already paid, or a payment for it is being confirmed. Nothing was charged.', 'already_paid', 'PT409');
      }
      const open = live.filter((r) => ['created', 'awaiting_payment', 'failed'].includes(stateOf(r, t)));
      const same = open.find((r) => r.opKey === key && r.payerId === scope.subjectId);
      if (same && open.length === 1) {
        same.opIds.push(req.operationId); // an identical open order answers the new operation id too
        return { order: view(scope, same), replayed: false, reused: true };
      }
      if (open.length > 0) throw err('conflict', 'A payment for this is already open. Continue that one from Billing instead of starting another.', 'order_open', 'PT409');
      const n = records.length + 100;
      const fee = FEES[child.plan];
      const r: Rec = {
        id: uuid(n),
        reference: `BO-SAMPLE${String(n).padStart(4, '0')}`,
        payerId: scope.subjectId,
        cadetId: req.cadetId,
        lines: months.map((m) => ({ fee, month: m })),
        createdAt: t,
        expiresAt: t + ORDER_TTL,
        ledger: 'none',
        refunds: [],
        underReview: false,
        opIds: [req.operationId],
        opKey: key,
      };
      records.push(r);
      return { order: view(scope, r), replayed: false, reused: false };
    },

    async cancelOrder(scope, orderId) {
      await wait();
      const r = ownRecord(scope, orderId);
      const s = stateOf(r, now());
      if (s !== 'created' && s !== 'awaiting_payment' && s !== 'failed') {
        throw err('conflict', 'This order can’t be cancelled now: a payment may already be on its way.', 'cannot_cancel', 'PT409');
      }
      r.cancelledAt = now();
      return view(scope, r);
    },

    async noteClientReturn(scope, orderId, gatewayPaymentId) {
      await wait();
      const r = ownRecord(scope, orderId);
      if (!/^pay_[A-Za-z0-9]{6,40}$/.test(gatewayPaymentId)) {
        throw err('invalid', 'The payment provider’s answer wasn’t understood. Nothing is confirmed.', 'invalid_payment_id', 'PT422');
      }
      const s = stateOf(r, now());
      if (!['awaiting_payment', 'failed', 'awaiting_confirmation', 'paid', 'partially_refunded', 'refunded'].includes(s)) {
        throw err('conflict', 'This order isn’t waiting for a payment, so nothing was recorded.', 'not_in_checkout', 'PT409');
      }
      if (r.clientReturnedAt === undefined && (s === 'awaiting_payment' || s === 'failed')) r.clientReturnedAt = now(); // never PAID
      return view(scope, r);
    },
  };

  const cancelOps = new Map<string, string>();
  return {
    source: 'synthetic-preview',
    orders,
    // Stands in for E-1 + the provider sheet: the labelled LOCAL TEST CHECKOUT. No provider is called; no money moves.
    checkout: createTestCheckout(async (scope, orderId) => {
      await wait();
      const r = ownRecord(scope, orderId);
      if (!switchOn(scope)) throw err('checkoutOff', 'Online payment isn’t switched on yet. Nothing was charged.', 'checkout_disabled', 'PT423');
      const s = stateOf(r, now());
      if (!['created', 'awaiting_payment', 'failed'].includes(s)) throw err('conflict', 'This order isn’t waiting for a payment.', 'order_closed', 'PT409');
      if (r.ledger === 'none') r.ledger = 'PENDING'; // what the server-side attach step records (one test gateway order per order)
      const o = view(scope, r);
      return { keyId: 'test_local_only', gatewayOrderId: `order_TEST${r.reference.slice(-4)}`, amountPaise: o.totalPaise, currency: 'INR', reference: o.reference };
    }),
    autopay: {
      async list(scope) {
        await wait();
        const fam = familyOf(scope);
        if (fam.failure) throw err('network', 'We couldn’t reach the academy. Check your connection and try again.', undefined, 'HTTP-0');
        return (mandates[scope.subjectId] ?? []).map((m) => ({ ...m, childName: fam.children.find((c) => c.cadetId === m.cadetId)?.name ?? null }));
      },
      async requestCancellation(scope, cadetId, operationId) {
        await wait();
        const fam = familyOf(scope);
        const childName = fam.children.find((c) => c.cadetId === cadetId)?.name ?? null;
        const list = mandates[scope.subjectId] ?? [];
        const m = list.find((x) => x.cadetId === cadetId);
        if (!m || m.state === 'none') throw NOT_FOUND();
        if (cancelOps.get(operationId) === cadetId) return { ...m, childName }; // replay: the original answer
        if (!['pending_authorisation', 'active', 'paused'].includes(m.state)) {
          throw err('conflict', 'This autopay can’t be cancelled now. Reload to see its latest state.', 'cannot_cancel', 'PT409');
        }
        cancelOps.set(operationId, cadetId);
        // The provider decides; until it confirms, the mandate is "cancellation requested" and a scheduled debit may run.
        m.state = 'cancel_requested';
        m.updatedAt = isoOf(now());
        return { ...m, childName };
      },
      // startSetUp is absent: no mandate provider is connected (G7-D11, G7-D13).
    },
    // invoices is absent, exactly as in the server build: no tax-invoice PDF exists yet (G7-D07).
  };
}
