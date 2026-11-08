import { verifyWebhookSignature } from '../_shared/razorpay.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

interface IngestParams {
  p_event_id: string;
  p_type: string;
  p_gateway_order_id: string;
  p_gateway_payment_id: string | null;
  p_amount: number;
  p_currency: string;
}

export function extractIngestParams(payload: unknown): IngestParams | null {
  if (!isObj(payload)) return null;
  const eventId = payload.event_id;
  const eventType = payload.event;
  if (typeof eventId !== 'string' || typeof eventType !== 'string') return null;

  const inner = payload.payload;
  if (!isObj(inner)) return null;

  if (eventType === 'payment.captured' || eventType === 'payment.failed') {
    const payment = isObj(inner.payment) && isObj((inner.payment as Obj).entity) ? (inner.payment as Obj).entity as Obj : null;
    if (!payment) return null;
    return {
      p_event_id: eventId,
      p_type: eventType,
      p_gateway_order_id: String(payment.order_id ?? ''),
      p_gateway_payment_id: typeof payment.id === 'string' ? payment.id : null,
      p_amount: typeof payment.amount === 'number' ? payment.amount : 0,
      p_currency: typeof payment.currency === 'string' ? payment.currency : 'INR',
    };
  }

  if (eventType === 'order.paid') {
    const order = isObj(inner.order) && isObj((inner.order as Obj).entity) ? (inner.order as Obj).entity as Obj : null;
    if (!order) return null;
    const payments = isObj(order.payments) && Array.isArray((order.payments as Obj).items) ? (order.payments as Obj).items as Obj[] : null;
    const payment = payments?.[0];
    return {
      p_event_id: eventId,
      p_type: eventType,
      p_gateway_order_id: String(order.id ?? ''),
      p_gateway_payment_id: payment && typeof payment.id === 'string' ? payment.id : null,
      p_amount: typeof order.amount_paid === 'number' ? order.amount_paid : 0,
      p_currency: typeof order.currency === 'string' ? order.currency : 'INR',
    };
  }

  if (eventType === 'refund.created') {
    const refund = isObj(inner.refund) && isObj((inner.refund as Obj).entity) ? (inner.refund as Obj).entity as Obj : null;
    if (!refund) return null;
    const payment = isObj(inner.payment) && isObj((inner.payment as Obj).entity) ? (inner.payment as Obj).entity as Obj : null;
    return {
      p_event_id: eventId,
      p_type: eventType,
      p_gateway_order_id: payment ? String(payment.order_id ?? '') : '',
      p_gateway_payment_id: typeof refund.payment_id === 'string' ? refund.payment_id : null,
      p_amount: typeof refund.amount === 'number' ? refund.amount : 0,
      p_currency: typeof refund.currency === 'string' ? refund.currency : 'INR',
    };
  }

  return null;
}

export async function handleWebhook(
  req: Request,
  deps: { serviceClient: ReturnType<typeof createServiceClient>; webhookSecret: string },
): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get('X-Razorpay-Signature') ?? '';

  const valid = await verifyWebhookSignature(rawBody, signature, deps.webhookSecret);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const params = extractIngestParams(parsed);
  if (!params) {
    return new Response(JSON.stringify({ status: 'ignored', reason: 'unhandled event type' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error } = await deps.serviceClient.rpc('billing_ingest_event', params);
  if (error) {
    console.error('billing_ingest_event error:', error);
    return new Response(JSON.stringify({ error: 'Ingest failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createServiceClient();
  return handleWebhook(req, { serviceClient, webhookSecret });
});
