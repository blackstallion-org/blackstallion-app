/**
 * @jest-environment node
 */
import {
  CONFIRMATION_POLL_MS,
  ORDER_STATES,
  formatPaise,
  nextAfterCheckout,
  nextPollDelay,
  parseServerOrder,
  viewOf,
  type CheckoutResult,
} from '../domain/paymentState';

// shape returned by public.billing_get_order (foundations/g7-billing); synthetic values
const order = (over: Record<string, unknown> = {}) => ({
  orderId: '3f8e0a52-0000-4000-8000-000000000001', reference: 'BO-TEST00000001', cadetId: '3f8e0a52-0000-4000-8000-0000000000c1',
  state: 'paid', underReview: false, currency: 'INR', subtotalPaise: 1350000, gstPaise: 243000, totalPaise: 1593000, refundedPaise: 0,
  invoice: { number: '26-27/000001', issuedAt: '2026-11-04T10:00:00Z' },
  lines: [
    { lineNo: 1, type: 'kit', label: 'Onboarding kit (one-time)', month: null, basePaise: 500000, gstPaise: 90000, totalPaise: 590000 },
    { lineNo: 2, type: 'tuition', label: 'Core Cadets, monthly tuition', month: '2026-11', basePaise: 850000, gstPaise: 153000, totalPaise: 1003000 },
  ],
  ...over,
});

describe('billing payment state', () => {
  test('B01 a checkout "success" is reported and shown as confirming, never as paid', () => {
    const results: CheckoutResult[] = [
      { kind: 'success', paymentId: 'pay_TEST00000001' },
      { kind: 'success', paymentId: 'not-a-payment-id' },
      { kind: 'dismissed' },
      { kind: 'failed', reason: 'BAD_REQUEST_ERROR' },
    ];
    for (const r of results) {
      const next = nextAfterCheckout(r);
      expect(['paid', 'partially_refunded', 'refunded']).not.toContain(next.provisional);
    }
    expect(nextAfterCheckout(results[0]!)).toEqual({ report: { paymentId: 'pay_TEST00000001' }, provisional: 'awaiting_confirmation' });
    expect(nextAfterCheckout(results[1]!)).toEqual({ report: null, provisional: 'awaiting_payment' });
    expect(nextAfterCheckout(results[2]!)).toEqual({ report: null, provisional: 'awaiting_payment' });
    expect(nextAfterCheckout(results[3]!)).toEqual({ report: null, provisional: 'failed' });
  });

  test('B02 every server state has one view; pay/cancel only while unpaid; invoice only after a recorded capture', () => {
    for (const state of ORDER_STATES) {
      const v = viewOf({ state, underReview: false });
      expect(v.titleKey).toMatch(/^billing\.state\./);
      expect(v.canPay).toBe(['created', 'awaiting_payment', 'failed'].includes(state));
      expect(v.canCancel).toBe(['created', 'awaiting_payment', 'failed'].includes(state));
      expect(v.showInvoice).toBe(['paid', 'partially_refunded', 'refunded'].includes(state));
      expect(v.pollConfirmation).toBe(state === 'awaiting_confirmation');
      expect(v.tone === 'success').toBe(state === 'paid');
    }
  });

  test('B03 an open reconciliation case shows a neutral "under review" note and nothing else', () => {
    expect(viewOf({ state: 'paid', underReview: true }).reviewNoteKey).toBe('billing.note.underReview');
    expect(viewOf({ state: 'paid', underReview: false }).reviewNoteKey).toBeNull();
  });

  test('B04 a well-formed server order parses', () => {
    const o = parseServerOrder(order());
    expect(o?.state).toBe('paid');
    expect(o?.lines.map((l) => l.type)).toEqual(['kit', 'tuition']);
    expect(o?.invoice?.number).toBe('26-27/000001');
  });

  test('B05 anything unexpected parses to null, so it can never render as paid', () => {
    expect(parseServerOrder(order({ state: 'PAID' }))).toBeNull();
    expect(parseServerOrder(order({ state: 'settled' }))).toBeNull();
    expect(parseServerOrder(order({ currency: 'USD' }))).toBeNull();
    expect(parseServerOrder(order({ totalPaise: 1593001 }))).toBeNull();
    expect(parseServerOrder(order({ gstPaise: 243000.5 }))).toBeNull();
    expect(parseServerOrder(order({ refundedPaise: 1593001 }))).toBeNull();
    expect(parseServerOrder(order({ invoice: null }))).toBeNull(); // "paid" without an invoice is not a server capture
    expect(parseServerOrder(order({ state: 'awaiting_confirmation' }))).toBeNull(); // an invoice before a capture
    expect(parseServerOrder(order({ lines: [] }))).toBeNull();
    expect(parseServerOrder(order({ lines: [{ lineNo: 1, type: 'tuition', label: 'x', month: null, basePaise: 1, gstPaise: 0, totalPaise: 1 }] }))).toBeNull();
    expect(parseServerOrder(order({ underReview: 'no' }))).toBeNull();
    expect(parseServerOrder(null)).toBeNull();
    expect(parseServerOrder('paid')).toBeNull();
  });

  test('B06 confirmation polling backs off, stops after the schedule, and only while confirming', () => {
    expect(CONFIRMATION_POLL_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(nextPollDelay(0, 'awaiting_confirmation')).toBe(2000);
    expect(nextPollDelay(CONFIRMATION_POLL_MS.length, 'awaiting_confirmation')).toBeNull();
    expect(nextPollDelay(0, 'paid')).toBeNull();
    expect(nextPollDelay(0, 'awaiting_payment')).toBeNull();
    expect(nextPollDelay(-1, 'awaiting_confirmation')).toBeNull();
  });

  test('B07 rupees from integer paise with Indian grouping and no float arithmetic', () => {
    expect(formatPaise(1003000)).toBe('₹10,030.00');
    expect(formatPaise(1593000)).toBe('₹15,930.00');
    expect(formatPaise(1475000)).toBe('₹14,750.00');
    expect(formatPaise(12345678901)).toBe('₹12,34,56,789.01');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(0)).toBe('₹0.00');
    expect(() => formatPaise(-1)).toThrow();
    expect(() => formatPaise(10.5)).toThrow();
  });
});
