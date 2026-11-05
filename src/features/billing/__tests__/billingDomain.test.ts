/**
 * Billing domain rules (pure TS): strict parsing of the G7 order/quote JSON, month coverage, the pay gate, request
 * canonicalisation, error mapping and the autopay model. Includes the "provider failure never becomes success" rules.
 */
import { afterCancelRequest, mandateView, MANDATE_STATES, parseMandate } from '../domain/autopay';
import { BillingError, toBillingError } from '../domain/billingErrors';
import {
  addMonths,
  billingMonthOf,
  canonicalItems,
  coverageFor,
  inProgress,
  isBillingOrderId,
  parseBillingOrder,
  parseCheckoutStatus,
  parseQuote,
  payGate,
  payKey,
  type BillingOrder,
} from '../domain/orders';
import { nextAfterCheckout, ORDER_STATES, viewOf, type CheckoutResult, type OrderState } from '../domain/paymentState';
import { itemsTitle, monthName, rateLabel } from '../format';

/** Exactly the keys `app_private.billing_order_json` builds (G7 migration). */
function orderJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: '5a3b1e00-0000-4000-8000-000000000003',
    reference: 'BO-1A2B3C4D5E6F',
    cadetId: 'c1',
    state: 'paid',
    underReview: false,
    currency: 'INR',
    subtotalPaise: 850000,
    gstPaise: 153000,
    totalPaise: 1003000,
    createdAt: '2026-11-02T10:00:00.000Z',
    expiresAt: '2026-11-02T12:00:00.000Z',
    cancelledAt: null,
    clientReturnedAt: '2026-11-02T10:03:00.000Z',
    gatewayOrderId: 'order_ABC123',
    paidAt: '2026-11-02T10:03:30.000Z',
    refundedPaise: 0,
    invoice: { number: '26-27/000017', issuedAt: '2026-11-02T10:03:31.000Z' },
    lines: [
      { lineNo: 1, type: 'tuition', feeCode: 'core_monthly', label: 'Core Cadets, monthly tuition', month: '2026-11', priceVersionId: 'pv', unitAmountPaise: 850000, gstRateBp: 1800, basePaise: 850000, gstPaise: 153000, totalPaise: 1003000 },
    ],
    refunds: [],
    ...over,
  };
}
const order = (over: Record<string, unknown> = {}) => parseBillingOrder(orderJson(over)) as BillingOrder;

describe('parseBillingOrder (billing_order_json)', () => {
  test('a well-formed paid order parses with its invoice, dates and line rates', () => {
    const o = order();
    expect(o).not.toBeNull();
    expect(o.state).toBe('paid');
    expect(o.invoice?.number).toBe('26-27/000017');
    expect(o.lines[0]?.gstRateBp).toBe(1800);
    expect(o.paidAt).toBe('2026-11-02T10:03:30.000Z');
  });

  test('a "paid" answer without an invoice is refused (never shown as paid)', () => {
    expect(parseBillingOrder(orderJson({ invoice: null }))).toBeNull();
  });

  test('an invoice on an order that is not settled is refused', () => {
    expect(parseBillingOrder(orderJson({ state: 'awaiting_confirmation' }))).toBeNull();
  });

  test('inexact GST, totals that do not add up and a wrong unit amount are refused', () => {
    const line = (orderJson().lines as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(parseBillingOrder(orderJson({ lines: [{ ...line, gstRateBp: 1801 }] }))).toBeNull();
    expect(parseBillingOrder(orderJson({ totalPaise: 1003001 }))).toBeNull();
    expect(parseBillingOrder(orderJson({ lines: [{ ...line, unitAmountPaise: 1 }] }))).toBeNull();
    expect(parseBillingOrder(orderJson({ subtotalPaise: 850001, gstPaise: 152999 }))).toBeNull();
  });

  test('missing createdAt, a cancelled order without cancelledAt, a non-INR currency and float paise are refused', () => {
    expect(parseBillingOrder(orderJson({ createdAt: undefined }))).toBeNull();
    expect(parseBillingOrder(orderJson({ state: 'cancelled', invoice: null, cancelledAt: null }))).toBeNull();
    expect(parseBillingOrder(orderJson({ currency: 'USD' }))).toBeNull();
    expect(parseBillingOrder(orderJson({ totalPaise: 1003000.5 }))).toBeNull();
  });

  test('refunds parse; a zero refund is refused', () => {
    const o = order({ state: 'partially_refunded', refundedPaise: 200000, refunds: [{ amountPaise: 200000, appliedAt: '2026-11-04T10:00:00.000Z' }] });
    expect(o.refunds).toEqual([{ amountPaise: 200000, appliedAt: '2026-11-04T10:00:00.000Z' }]);
    expect(parseBillingOrder(orderJson({ refunds: [{ amountPaise: 0, appliedAt: '2026-11-04T10:00:00.000Z' }] }))).toBeNull();
  });
});

describe('quote and checkout status', () => {
  const quote = {
    cadetId: 'c1',
    currency: 'INR',
    lines: [{ lineNo: 1, type: 'tuition', feeCode: 'core_monthly', label: 'Core', month: '2026-11', gstRateBp: 1800, basePaise: 850000, gstPaise: 153000, totalPaise: 1003000, priceVersion: 1 }],
    subtotalPaise: 850000,
    gstPaise: 153000,
    totalPaise: 1003000,
  };
  test('a G7 quote parses (Core month = ₹10,030.00 with exact 18 % GST)', () => {
    expect(parseQuote(quote)?.totalPaise).toBe(1003000);
  });
  test('a quote whose lines do not add up, or a tuition line without a month, is refused', () => {
    expect(parseQuote({ ...quote, totalPaise: 1003001 })).toBeNull();
    expect(parseQuote({ ...quote, lines: [{ ...quote.lines[0], month: null }] })).toBeNull();
  });
  test('checkout status needs both booleans', () => {
    expect(parseCheckoutStatus({ enabled: false, kitInApp: false })).toEqual({ enabled: false, kitInApp: false });
    expect(parseCheckoutStatus(null)).toBeNull();
    expect(parseCheckoutStatus({ enabled: 'yes', kitInApp: false })).toBeNull();
  });
});

describe('months, coverage and in-progress orders', () => {
  test('the billing month is Asia/Kolkata (UTC+05:30), like the server', () => {
    expect(billingMonthOf(new Date('2026-11-30T18:29:59Z'))).toBe('2026-11');
    expect(billingMonthOf(new Date('2026-11-30T18:30:00Z'))).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  test('settled beats confirming beats open; cancelled, expired and refunded cover nothing (server precedence)', () => {
    const mk = (state: OrderState, id: string) =>
      order({ orderId: id, state, invoice: ['paid', 'partially_refunded', 'refunded'].includes(state) ? orderJson().invoice : null, cancelledAt: state === 'cancelled' ? '2026-11-02T10:05:00.000Z' : null });
    const ids = (n: number) => `5a3b1e00-0000-4000-8000-00000000000${n}`;
    expect(coverageFor([mk('cancelled', ids(1)), mk('expired', ids(2)), mk('refunded', ids(3))], 'c1', '2026-11')).toEqual({ kind: 'none' });
    expect(coverageFor([mk('failed', ids(1)), mk('awaiting_confirmation', ids(2))], 'c1', '2026-11').kind).toBe('confirming');
    expect(coverageFor([mk('awaiting_confirmation', ids(1)), mk('paid', ids(2))], 'c1', '2026-11').kind).toBe('settled');
    expect(coverageFor([mk('created', ids(1))], 'c1', '2026-11').kind).toBe('open');
    expect(coverageFor([mk('paid', ids(1))], 'c1', '2026-12').kind).toBe('none');
    expect(coverageFor([mk('paid', ids(1))], 'c2', '2026-11').kind).toBe('none');
    expect(inProgress([mk('paid', ids(1)), mk('failed', ids(2)), mk('awaiting_confirmation', ids(3)), mk('expired', ids(4))]).map((o) => o.state)).toEqual(['failed', 'awaiting_confirmation']);
  });

  test('route ids must be UUIDs (invoice numbers are not addressable)', () => {
    expect(isBillingOrderId('5a3b1e00-0000-4000-8000-000000000003')).toBe(true);
    expect(isBillingOrderId('26-27/000017')).toBe(false);
    expect(isBillingOrderId('../../settings')).toBe(false);
  });
});

describe('pay gate and pay requests', () => {
  test('both the server switch and a connected provider must be open', () => {
    expect(payGate({ checkoutEnabled: false, providerConnected: true })).toEqual({ allowed: false, reason: 'checkoutOff' });
    expect(payGate({ checkoutEnabled: true, providerConnected: false })).toEqual({ allowed: false, reason: 'providerMissing' });
    expect(payGate({ checkoutEnabled: false, providerConnected: false })).toEqual({ allowed: false, reason: 'checkoutOff' });
    expect(payGate({ checkoutEnabled: true, providerConnected: true })).toEqual({ allowed: true });
  });

  test('the same request in any order gives one key and one canonical item list (the server hashes p_items as sent)', () => {
    const a = payKey('c1', [{ type: 'tuition', month: '2026-12' }, { type: 'kit' }, { type: 'tuition', month: '2026-11' }]);
    const b = payKey('c1', [{ type: 'kit' }, { type: 'tuition', month: '2026-11' }, { type: 'tuition', month: '2026-12' }]);
    expect(a).toBe(b);
    expect(payKey('c2', [{ type: 'kit' }])).not.toBe(payKey('c1', [{ type: 'kit' }]));
    expect(canonicalItems([{ type: 'tuition', month: '2026-12' }, { type: 'kit' }, { type: 'tuition', month: '2026-11' }])).toEqual([
      { type: 'kit' },
      { type: 'tuition', month: '2026-11' },
      { type: 'tuition', month: '2026-12' },
    ]);
  });
});

describe('provider failure never becomes success', () => {
  const results: CheckoutResult[] = [
    { kind: 'failed' },
    { kind: 'failed', reason: 'BAD_REQUEST_ERROR' },
    { kind: 'dismissed' },
    { kind: 'success', paymentId: 'not-a-razorpay-id' },
    { kind: 'success', paymentId: 'pay_' },
    { kind: 'success', paymentId: 'pay_ABCDEF123' },
  ];
  test.each(results)('checkout %j can at most show "Confirming", and never an invoice', (r) => {
    const next = nextAfterCheckout(r);
    expect(['awaiting_confirmation', 'awaiting_payment', 'failed']).toContain(next.provisional);
    const v = viewOf({ state: next.provisional, underReview: false });
    expect(v.showInvoice).toBe(false);
    expect(v.titleKey).not.toBe('billing.state.paid');
  });

  test('only a well-formed provider payment id is reported, and only success is reported', () => {
    expect(nextAfterCheckout({ kind: 'failed' }).report).toBeNull();
    expect(nextAfterCheckout({ kind: 'success', paymentId: 'pay_ABCDEF123' }).report).toEqual({ paymentId: 'pay_ABCDEF123' });
  });

  test('every state that shows an invoice is a settled state the server must send with an invoice', () => {
    const invoiced = ORDER_STATES.filter((s) => viewOf({ state: s, underReview: false }).showInvoice);
    expect(invoiced.sort()).toEqual(['paid', 'partially_refunded', 'refunded']);
  });
});

describe('server answers → payer copy', () => {
  test('SQLSTATE and HINT map to kinds and fixed copy; raw server text is never shown', () => {
    const off = toBillingError({ code: 'PT423', hint: 'checkout_disabled', message: 'online payment is not switched on' }, 423);
    expect(off.kind).toBe('checkoutOff');
    expect(off.message).toMatch(/isn’t switched on/);
    expect(toBillingError({ code: 'PT429', hint: 'rate_limited', message: 'x' }, 429).kind).toBe('rateLimited');
    expect(toBillingError({ code: 'PT404', hint: 'not_found', message: 'not found' }, 404).kind).toBe('notFound');
    expect(toBillingError({ code: '42501', hint: 'sign_in', message: 'sign in first' }, 403).kind).toBe('signedOut');
    expect(toBillingError({ code: '42501', message: 'super admin only' }, 403).kind).toBe('forbidden');
    expect(toBillingError({ code: 'PGRST202', message: 'Could not find the function public.billing_get_order' }, 404).kind).toBe('unavailable');
    const odd = toBillingError({ code: 'XX000', message: 'internal: relation app_private.secret' }, 500);
    expect(odd.message).not.toMatch(/app_private/);
    expect(odd.reference).toBe('XX000');
  });

  test('network failures are retryable (replay with the same operation id); conflicts are not', () => {
    const net = toBillingError({ code: '', message: 'TypeError: Network request failed' }, 0);
    expect(net.kind).toBe('network');
    expect(net.retryable).toBe(true);
    expect(toBillingError(new TypeError('Network request timed out')).retryable).toBe(true);
    expect(toBillingError({ code: 'PT409', hint: 'already_paid', message: 'already paid' }, 409).retryable).toBe(false);
    expect(toBillingError(new BillingError('invalid', 'x'))).toBeInstanceOf(BillingError);
  });
});

describe('autopay model (G7-D11: no server contract yet)', () => {
  const m = { cadetId: 'c1', mandateId: 'm1', state: 'active', method: 'upi_autopay', maxAmountPaise: 1500000, nextDebit: { onDate: '2027-01-01', amountPaise: 1475000 }, updatedAt: '2026-11-04T10:00:00Z' };
  test('parses a mandate and refuses inconsistent ones', () => {
    expect(parseMandate(m)?.state).toBe('active');
    expect(parseMandate({ ...m, state: 'none' })).toBeNull(); // none has no mandate id
    expect(parseMandate({ ...m, state: 'cancelled' })).toBeNull(); // a cancelled mandate schedules no debit
    expect(parseMandate({ ...m, method: 'cheque' })).toBeNull();
  });
  test('cancellation is requested, never shown as done by the app, and cannot be requested twice', () => {
    expect(mandateView({ state: 'active' }).canCancel).toBe(true);
    expect(mandateView({ state: 'cancel_requested' })).toMatchObject({ canCancel: false, waitingOnBank: true });
    expect(MANDATE_STATES.filter((s) => mandateView({ state: s }).canSetUp)).toEqual(['none', 'cancelled', 'failed']);
    const before = parseMandate(m)!;
    expect(afterCancelRequest(before, null)).toBe(before); // refused → unchanged
  });
});

describe('formatting', () => {
  test('titles, months and rates', () => {
    expect(itemsTitle([{ type: 'tuition', month: '2026-11' }])).toBe('Tuition · November 2026');
    expect(itemsTitle([{ type: 'kit', month: null }, { type: 'tuition', month: '2026-11' }])).toBe('Onboarding kit + tuition · November 2026');
    expect(itemsTitle([{ type: 'tuition', month: '2026-12' }, { type: 'tuition', month: '2026-11' }])).toBe('Tuition · Nov 2026 and Dec 2026');
    expect(monthName('2027-01')).toBe('January 2027');
    expect(rateLabel(1800)).toBe('18%');
    expect(rateLabel(1250)).toBe('12.5%');
  });
});
