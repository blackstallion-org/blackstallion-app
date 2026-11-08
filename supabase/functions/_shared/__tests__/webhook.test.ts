import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import { extractIngestParams, handleWebhook } from '../../webhook/index.ts';
import {
  WEBHOOK_SECRET,
  computeSignature,
  PAYMENT_CAPTURED_BODY,
  PAYMENT_FAILED_BODY,
  REFUND_CREATED_BODY,
  ORDER_PAID_BODY,
  TAMPERED_BODY,
} from './fixtures.ts';

function mockServiceClient(rpcResult: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: { fn: string; params: unknown }[] = [];
  return {
    calls,
    client: {
      rpc(fn: string, params: unknown) {
        calls.push({ fn, params });
        return Promise.resolve(rpcResult);
      },
    } as unknown as ReturnType<typeof import('../supabase.ts').createServiceClient>,
  };
}

async function buildRequest(body: string, secret: string): Promise<Request> {
  const sig = await computeSignature(body, secret);
  return new Request('http://localhost/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig },
    body,
  });
}

// --- extractIngestParams ---

Deno.test('extractIngestParams: payment.captured', () => {
  const params = extractIngestParams(JSON.parse(PAYMENT_CAPTURED_BODY));
  assertEquals(params, {
    p_event_id: 'evt_captured_001',
    p_type: 'payment.captured',
    p_gateway_order_id: 'order_TestOrder001',
    p_gateway_payment_id: 'pay_TestCaptured001',
    p_amount: 1003000,
    p_currency: 'INR',
  });
});

Deno.test('extractIngestParams: payment.failed', () => {
  const params = extractIngestParams(JSON.parse(PAYMENT_FAILED_BODY));
  assertEquals(params, {
    p_event_id: 'evt_failed_001',
    p_type: 'payment.failed',
    p_gateway_order_id: 'order_TestOrder002',
    p_gateway_payment_id: 'pay_TestFailed001',
    p_amount: 590000,
    p_currency: 'INR',
  });
});

Deno.test('extractIngestParams: refund.created', () => {
  const params = extractIngestParams(JSON.parse(REFUND_CREATED_BODY));
  assertEquals(params, {
    p_event_id: 'evt_refund_001',
    p_type: 'refund.created',
    p_gateway_order_id: 'order_TestOrder001',
    p_gateway_payment_id: 'pay_TestCaptured001',
    p_amount: 500000,
    p_currency: 'INR',
  });
});

Deno.test('extractIngestParams: order.paid', () => {
  const params = extractIngestParams(JSON.parse(ORDER_PAID_BODY));
  assertEquals(params, {
    p_event_id: 'evt_orderpaid_001',
    p_type: 'order.paid',
    p_gateway_order_id: 'order_TestOrder001',
    p_gateway_payment_id: 'pay_TestCaptured001',
    p_amount: 1003000,
    p_currency: 'INR',
  });
});

Deno.test('extractIngestParams: unknown event returns null', () => {
  assertEquals(extractIngestParams({ event: 'subscription.created', event_id: 'x', payload: {} }), null);
});

Deno.test('extractIngestParams: non-object returns null', () => {
  assertEquals(extractIngestParams('not an object'), null);
  assertEquals(extractIngestParams(null), null);
});

// --- handleWebhook ---

Deno.test('handleWebhook: 200 on valid payment.captured', async () => {
  const { client, calls } = mockServiceClient();
  const req = await buildRequest(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'ok');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, 'billing_ingest_event');
  assertEquals((calls[0].params as Record<string, unknown>).p_event_id, 'evt_captured_001');
});

Deno.test('handleWebhook: 400 on bad signature', async () => {
  const req = await buildRequest(TAMPERED_BODY, WEBHOOK_SECRET);
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const tampered = new Request('http://localhost/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig },
    body: TAMPERED_BODY,
  });
  const { client } = mockServiceClient();
  const res = await handleWebhook(tampered, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });
  assertEquals(res.status, 400);
});

Deno.test('handleWebhook: 200 ignored for unknown event', async () => {
  const unknownBody = JSON.stringify({ entity: 'event', event: 'subscription.created', event_id: 'x', payload: {} });
  const { client } = mockServiceClient();
  const req = await buildRequest(unknownBody, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'ignored');
});

Deno.test('handleWebhook: 500 on DB error', async () => {
  const { client } = mockServiceClient({ data: null, error: { message: 'db down' } });
  const req = await buildRequest(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });
  assertEquals(res.status, 500);
});
