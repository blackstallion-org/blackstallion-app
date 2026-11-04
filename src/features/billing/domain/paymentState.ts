/**
 * Family billing state (G7). Pure TypeScript: no React, Expo or transport imports.
 *
 * The server owns money. Every amount, the order state and the invoice come from
 * billing_get_order / billing_list_orders (foundations/g7-billing). The checkout
 * sheet's own "success" is only a hint that is reported back to the server: on the
 * device it can at most show "Confirming your payment", never "Paid"
 * (nextAfterCheckout cannot return a paid state, and viewOf only shows an invoice
 * for states the server sent). A malformed server response parses to null and is
 * shown as an error, never as paid.
 */
export type OrderState =
  | 'created'
  | 'awaiting_payment'
  | 'failed'
  | 'awaiting_confirmation'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'cancelled'
  | 'expired';

export const ORDER_STATES: readonly OrderState[] = [
  'created',
  'awaiting_payment',
  'failed',
  'awaiting_confirmation',
  'paid',
  'partially_refunded',
  'refunded',
  'cancelled',
  'expired',
];

export interface ServerOrderLine {
  lineNo: number;
  type: 'tuition' | 'kit';
  label: string;
  month: string | null;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
}

export interface ServerOrder {
  orderId: string;
  reference: string;
  cadetId: string;
  state: OrderState;
  underReview: boolean;
  currency: 'INR';
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
  refundedPaise: number;
  invoice: { number: string; issuedAt: string } | null;
  lines: ServerOrderLine[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const paise = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Strict parse of the server's order JSON. Anything unexpected returns null (render the error state). */
export function parseServerOrder(json: unknown): ServerOrder | null {
  if (!isObj(json)) return null;
  const { orderId, reference, cadetId, state, underReview, currency, subtotalPaise, gstPaise, totalPaise, refundedPaise, invoice, lines } = json;
  if (!str(orderId) || !str(reference) || !str(cadetId)) return null;
  if (typeof state !== 'string' || !(ORDER_STATES as readonly string[]).includes(state)) return null;
  if (typeof underReview !== 'boolean' || currency !== 'INR') return null;
  if (!paise(subtotalPaise) || !paise(gstPaise) || !paise(totalPaise) || !paise(refundedPaise)) return null;
  if (subtotalPaise + gstPaise !== totalPaise || refundedPaise > totalPaise) return null;
  let inv: ServerOrder['invoice'] = null;
  if (invoice !== null) {
    if (!isObj(invoice) || !str(invoice.number) || !str(invoice.issuedAt)) return null;
    inv = { number: invoice.number, issuedAt: invoice.issuedAt };
  }
  const settled = state === 'paid' || state === 'partially_refunded' || state === 'refunded';
  if (settled !== (inv !== null)) return null; // an invoice exists exactly when the server recorded a capture
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const parsed: ServerOrderLine[] = [];
  for (const l of lines) {
    if (!isObj(l) || typeof l.lineNo !== 'number' || (l.type !== 'tuition' && l.type !== 'kit') || !str(l.label)) return null;
    if (!paise(l.basePaise) || !paise(l.gstPaise) || !paise(l.totalPaise) || l.basePaise + l.gstPaise !== l.totalPaise) return null;
    const month = typeof l.month === 'string' ? l.month : null;
    const monthOk = l.type === 'tuition'
      ? month !== null && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)
      : l.month === null || l.month === undefined;
    if (!monthOk) return null;
    parsed.push({ lineNo: l.lineNo, type: l.type, label: l.label, month, basePaise: l.basePaise, gstPaise: l.gstPaise, totalPaise: l.totalPaise });
  }
  if (parsed.reduce((s, l) => s + l.totalPaise, 0) !== totalPaise) return null;
  return {
    orderId, reference, cadetId, state: state as OrderState, underReview, currency: 'INR',
    subtotalPaise, gstPaise, totalPaise, refundedPaise, invoice: inv, lines: parsed,
  };
}

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface PaymentView {
  state: OrderState;
  tone: Tone;
  titleKey: string;
  /** a second line explaining what happens next */
  bodyKey: string;
  canPay: boolean;
  canCancel: boolean;
  showInvoice: boolean;
  /** keep asking the server (never the checkout sheet) whether the capture arrived */
  pollConfirmation: boolean;
  /** an open reconciliation case: the academy is checking; no details are shown to the family */
  reviewNoteKey: string | null;
}

const VIEWS: Record<OrderState, Omit<PaymentView, 'state' | 'reviewNoteKey'>> = {
  created: { tone: 'neutral', titleKey: 'billing.state.created', bodyKey: 'billing.body.payNow', canPay: true, canCancel: true, showInvoice: false, pollConfirmation: false },
  awaiting_payment: { tone: 'neutral', titleKey: 'billing.state.awaitingPayment', bodyKey: 'billing.body.payNow', canPay: true, canCancel: true, showInvoice: false, pollConfirmation: false },
  failed: { tone: 'danger', titleKey: 'billing.state.failed', bodyKey: 'billing.body.tryAgain', canPay: true, canCancel: true, showInvoice: false, pollConfirmation: false },
  awaiting_confirmation: { tone: 'progress', titleKey: 'billing.state.confirming', bodyKey: 'billing.body.confirming', canPay: false, canCancel: false, showInvoice: false, pollConfirmation: true },
  paid: { tone: 'success', titleKey: 'billing.state.paid', bodyKey: 'billing.body.invoiceReady', canPay: false, canCancel: false, showInvoice: true, pollConfirmation: false },
  partially_refunded: { tone: 'neutral', titleKey: 'billing.state.partiallyRefunded', bodyKey: 'billing.body.refundRecorded', canPay: false, canCancel: false, showInvoice: true, pollConfirmation: false },
  refunded: { tone: 'neutral', titleKey: 'billing.state.refunded', bodyKey: 'billing.body.refundRecorded', canPay: false, canCancel: false, showInvoice: true, pollConfirmation: false },
  cancelled: { tone: 'neutral', titleKey: 'billing.state.cancelled', bodyKey: 'billing.body.startAgain', canPay: false, canCancel: false, showInvoice: false, pollConfirmation: false },
  expired: { tone: 'warning', titleKey: 'billing.state.expired', bodyKey: 'billing.body.startAgain', canPay: false, canCancel: false, showInvoice: false, pollConfirmation: false },
};

/** What the Family invoice/payment screen shows for a server-confirmed order. */
export function viewOf(order: Pick<ServerOrder, 'state' | 'underReview'>): PaymentView {
  return { state: order.state, ...VIEWS[order.state], reviewNoteKey: order.underReview ? 'billing.note.underReview' : null };
}

export type CheckoutResult = { kind: 'success'; paymentId: string } | { kind: 'dismissed' } | { kind: 'failed'; reason?: string };

/**
 * After the checkout sheet closes. A success result is reported to the server (billing_note_client_return) and the
 * screen shows "Confirming"; dismissal and failure leave the order payable. Nothing here can produce a paid state.
 */
export function nextAfterCheckout(result: CheckoutResult): {
  report: { paymentId: string } | null;
  provisional: Extract<OrderState, 'awaiting_confirmation' | 'awaiting_payment' | 'failed'>;
} {
  if (result.kind === 'success') {
    return /^pay_[A-Za-z0-9]{6,40}$/.test(result.paymentId)
      ? { report: { paymentId: result.paymentId }, provisional: 'awaiting_confirmation' }
      : { report: null, provisional: 'awaiting_payment' };
  }
  return { report: null, provisional: result.kind === 'failed' ? 'failed' : 'awaiting_payment' };
}

/** Confirmation polling (about 4 minutes in all), then stop and say the academy will confirm. */
export const CONFIRMATION_POLL_MS: readonly number[] = [2000, 3000, 5000, 8000, 13000, 21000, 30000, 30000, 30000, 30000, 30000, 30000];

/** Delay before the next server read, or null to stop polling. */
export function nextPollDelay(attempt: number, state: OrderState): number | null {
  if (state !== 'awaiting_confirmation' || !Number.isInteger(attempt) || attempt < 0) return null;
  return CONFIRMATION_POLL_MS[attempt] ?? null;
}

/** Indian rupee format from integer paise, with lakh/crore grouping: 1593000 -> "₹15,930.00". No float arithmetic. */
export function formatPaise(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('amount must be whole, non-negative paise');
  const rupees = Math.floor(value / 100).toString();
  const fraction = (value % 100).toString().padStart(2, '0');
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `₹${grouped}.${fraction}`;
}
