// Razorpay boundary for Edge Functions: signature checks, webhook parsing, and order creation API.
// Runtime-agnostic (Web Crypto only).
// Never logs or returns secrets. Strictly validates IDs, amounts, and currencies.

export type IngestParams = {
  p_event_id: string;
  p_event_type: string;
  p_gateway_order_id: string;
  p_gateway_payment_id: string | null;
  p_gateway_refund_id: string | null;
  p_amount_paise: number | null;
  p_currency: string | null;
  p_occurred_at: string | null;
  p_source: 'webhook' | 'reconciliation';
};

export const HANDLED_EVENTS = [
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
  'refund.processed',
] as const;

export const MAX_BODY_BYTES = 100_000;

const HEX64 = /^[a-f0-9]{64}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{4,120}$/;
const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
const PAY_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const REFUND_ID = /^rfnd_[A-Za-z0-9]{6,40}$/;
const CURRENCY = /^[A-Z]{3}$/;

const enc = new TextEncoder();

function hexToBytes(hex: string): BufferSource {
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/** X-Razorpay-Signature = hex HMAC-SHA256(raw request body, webhook secret). Use the RAW body, never re-serialised JSON. */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || !signature || !HEX64.test(signature)) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), hexToBytes(signature), enc.encode(rawBody));
}

/**
 * Checkout signature = hex HMAC-SHA256(serverOrderId + "|" + paymentId, key secret).
 * Proves the payment id was issued for that order; not proof of capture.
 */
export async function verifyCheckoutSignature(
  serverOrderId: string,
  paymentId: string,
  signature: string | null | undefined,
  keySecret: string | undefined,
): Promise<boolean> {
  if (!keySecret || !signature || !HEX64.test(signature) || !ORDER_ID.test(serverOrderId) || !PAY_ID.test(paymentId)) {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(keySecret), hexToBytes(signature), enc.encode(`${serverOrderId}|${paymentId}`));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const entity = (body: Obj, key: string): Obj => {
  const p = isObj(body.payload) ? body.payload : {};
  const holder = isObj(p[key]) ? (p[key] as Obj) : {};
  return isObj(holder.entity) ? holder.entity : {};
};

const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000_000 ? v : null;

const currencyOrNull = (v: unknown): string | null =>
  typeof v === 'string' && CURRENCY.test(v) ? v : null;

const isoFromUnix = (v: unknown): string | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 1_000_000_000 && v < 10_000_000_000
    ? new Date(v * 1000).toISOString()
    : null;

export type ReadResult =
  | { ok: true; params: IngestParams }
  | { ok: false; reason: 'bad_event_id' | 'not_handled' | 'malformed' };

/** Turns an already signature-verified webhook body into billing_ingest_event parameters. */
export function readWebhook(eventId: string | null | undefined, body: unknown): ReadResult {
  if (!eventId || !EVENT_ID.test(eventId)) return { ok: false, reason: 'bad_event_id' };
  if (!isObj(body) || typeof body.event !== 'string') return { ok: false, reason: 'malformed' };
  const type = body.event;
  if (!(HANDLED_EVENTS as readonly string[]).includes(type)) return { ok: false, reason: 'not_handled' };

  const payment = entity(body, 'payment');
  const refund = entity(body, 'refund');
  const order = entity(body, 'order');

  const orderId =
    typeof payment.order_id === 'string'
      ? payment.order_id
      : typeof order.id === 'string'
      ? order.id
      : '';
  if (!ORDER_ID.test(orderId)) return { ok: false, reason: 'malformed' };

  let amount: number | null;
  let currency: string | null;
  let paymentId: string | null =
    typeof payment.id === 'string' && PAY_ID.test(payment.id) ? payment.id : null;
  let refundId: string | null = null;

  if (type === 'refund.processed') {
    if (typeof refund.id !== 'string' || !REFUND_ID.test(refund.id)) return { ok: false, reason: 'malformed' };
    refundId = refund.id;
    amount = intOrNull(refund.amount);
    currency = currencyOrNull(refund.currency);
    if (typeof refund.payment_id === 'string' && PAY_ID.test(refund.payment_id)) {
      paymentId = refund.payment_id;
    }
  } else {
    amount = intOrNull(payment.amount) ?? (type === 'order.paid' ? intOrNull(order.amount_paid) : null);
    // Blank currency stays null: the server fails closed on captures without one
    currency = currencyOrNull(payment.currency) ?? currencyOrNull(order.currency);
  }

  if (amount === null && type !== 'payment.failed' && type !== 'payment.authorized') {
    return { ok: false, reason: 'malformed' };
  }

  return {
    ok: true,
    params: {
      p_event_id: eventId,
      p_event_type: type,
      p_gateway_order_id: orderId,
      p_gateway_payment_id: paymentId,
      p_gateway_refund_id: refundId,
      p_amount_paise: amount,
      p_currency: currency,
      p_occurred_at: isoFromUnix(body.created_at),
      p_source: 'webhook',
    },
  };
}

// ---------------------------------------------------------------------------
// Razorpay API client (dependency-injectable for tests)
// ---------------------------------------------------------------------------

export interface RazorpayOrderParams {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayClient {
  createOrder(params: RazorpayOrderParams): Promise<RazorpayOrder>;
}

export function createRazorpayClient(keyId: string, keySecret: string): RazorpayClient {
  const credentials = btoa(`${keyId}:${keySecret}`);
  return {
    async createOrder(params: RazorpayOrderParams): Promise<RazorpayOrder> {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Razorpay API ${res.status}: ${text}`);
      }
      return (await res.json()) as RazorpayOrder;
    },
  };
}

export function createMockRazorpayClient(
  handler: (params: RazorpayOrderParams) => RazorpayOrder,
): RazorpayClient {
  return { createOrder: async (p) => handler(p) };
}
