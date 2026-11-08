import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import { handleWebhook } from '../../webhook/index.ts';
import {
  WEBHOOK_SECRET,
  computeSignature,
  PAYMENT_CAPTURED_BODY,
  PAYMENT_FAILED_BODY,
  REFUND_PROCESSED_BODY,
  ORDER_PAID_BODY,
  TAMPERED_BODY,
} from './fixtures.ts';

function mockServiceClient(rpcResult: { data?: unknown; error?: unknown } = { data: 'paid', error: null }) {
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

async function buildRequest(
  body: string,
  secret: string,
  options: { headerEventId?: string; method?: string; signature?: string } = {},
): Promise<Request> {
  const sig = options.signature ?? (await computeSignature(body, secret));
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Razorpay-Signature': sig,
  });
  if (options.headerEventId) {
    headers.set('X-Razorpay-Event-Id', options.headerEventId);
  }
  return new Request('http://localhost/webhook', {
    method: options.method ?? 'POST',
    headers,
    body,
  });
}

Deno.test('handleWebhook: payment.captured calls billing_ingest_event with exact params', async () => {
  const { client, calls } = mockServiceClient({ data: 'paid', error: null });
  const req = await buildRequest(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.status, 'ok');
  assertEquals(data.outcome, 'paid');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, 'billing_ingest_event');
  assertEquals(calls[0].params, {
    p_event_id: 'evt_captured_001',
    p_event_type: 'payment.captured',
    p_gateway_order_id: 'order_TestOrder001',
    p_gateway_payment_id: 'pay_TestCaptured001',
    p_gateway_refund_id: null,
    p_amount_paise: 1003000,
    p_currency: 'INR',
    p_occurred_at: new Date(1793800000 * 1000).toISOString(),
    p_source: 'webhook',
  });
});

Deno.test('handleWebhook: refund.processed passes gateway refund ID', async () => {
  const { client, calls } = mockServiceClient({ data: 'refunded', error: null });
  const req = await buildRequest(REFUND_PROCESSED_BODY, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  const params = calls[0].params as Record<string, unknown>;
  assertEquals(params.p_event_type, 'refund.processed');
  assertEquals(params.p_gateway_refund_id, 'rfnd_TestRefund001');
  assertEquals(params.p_amount_paise, 500000);
});

Deno.test('handleWebhook: extracts event id from X-Razorpay-Event-Id header', async () => {
  const { client, calls } = mockServiceClient();
  const bodyWithoutEventId = JSON.stringify({
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_TestCaptured001',
          order_id: 'order_TestOrder001',
          amount: 1003000,
          currency: 'INR',
        },
      },
    },
  });
  const req = await buildRequest(bodyWithoutEventId, WEBHOOK_SECRET, { headerEventId: 'evt_from_header_999' });
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  const params = calls[0].params as Record<string, unknown>;
  assertEquals(params.p_event_id, 'evt_from_header_999');
});

Deno.test('handleWebhook: rejects invalid signature with 401 without DB call', async () => {
  const { client, calls } = mockServiceClient();
  const req = await buildRequest(PAYMENT_CAPTURED_BODY, 'wrong_secret');
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('handleWebhook: rejects tampered body with 401 without DB call', async () => {
  const { client, calls } = mockServiceClient();
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const req = await buildRequest(TAMPERED_BODY, WEBHOOK_SECRET, { signature: sig });
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('handleWebhook: returns 200 bad_json on invalid JSON (protects webhook from being disabled)', async () => {
  const { client, calls } = mockServiceClient();
  const badBody = '{ not-valid-json';
  const req = await buildRequest(badBody, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.error, 'bad_json');
  assertEquals(calls.length, 0);
});

Deno.test('handleWebhook: ignores unhandled event types with 200', async () => {
  const { client, calls } = mockServiceClient();
  const unhandledBody = JSON.stringify({
    entity: 'event',
    event: 'subscription.charged',
    event_id: 'evt_sub_001',
    payload: {},
  });
  const req = await buildRequest(unhandledBody, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.status, 'ignored');
  assertEquals(calls.length, 0);
});

Deno.test('handleWebhook: refuses oversized payload (>100k bytes) with 413', async () => {
  const { client, calls } = mockServiceClient();
  const largeBody = ' '.repeat(100_001);
  const req = await buildRequest(largeBody, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 413);
  assertEquals(calls.length, 0);
});

Deno.test('handleWebhook: returns 200 rejected when DB reports PT422 malformed facts', async () => {
  const { client } = mockServiceClient({ error: { code: 'PT422', message: 'malformed facts' } });
  const req = await buildRequest(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.status, 'rejected');
});

Deno.test('handleWebhook: returns 500 on transient database error to trigger retry', async () => {
  const { client } = mockServiceClient({ error: { code: '57P01', message: 'connection lost' } });
  const req = await buildRequest(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });

  assertEquals(res.status, 500);
});

Deno.test('handleWebhook: rejects non-POST methods with 405', async () => {
  const { client } = mockServiceClient();
  const req = new Request('http://localhost/webhook', { method: 'GET' });
  const res = await handleWebhook(req, { serviceClient: client, webhookSecret: WEBHOOK_SECRET });
  assertEquals(res.status, 405);
});
