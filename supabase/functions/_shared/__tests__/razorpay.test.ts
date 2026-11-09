import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import {
  readWebhook,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type IngestParams,
} from '../razorpay.ts';
import {
  WEBHOOK_SECRET,
  computeSignature,
  PAYMENT_CAPTURED_BODY,
  PAYMENT_FAILED_BODY,
  REFUND_PROCESSED_BODY,
  ORDER_PAID_BODY,
  TAMPERED_BODY,
} from './fixtures.ts';

Deno.test('accepts correct signature for payment.captured', async () => {
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, sig, WEBHOOK_SECRET), true);
});

Deno.test('accepts correct signature for payment.failed', async () => {
  const sig = await computeSignature(PAYMENT_FAILED_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(PAYMENT_FAILED_BODY, sig, WEBHOOK_SECRET), true);
});

Deno.test('accepts correct signature for refund.processed', async () => {
  const sig = await computeSignature(REFUND_PROCESSED_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(REFUND_PROCESSED_BODY, sig, WEBHOOK_SECRET), true);
});

Deno.test('accepts correct signature for order.paid', async () => {
  const sig = await computeSignature(ORDER_PAID_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(ORDER_PAID_BODY, sig, WEBHOOK_SECRET), true);
});

Deno.test('rejects tampered body', async () => {
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(TAMPERED_BODY, sig, WEBHOOK_SECRET), false);
});

Deno.test('rejects wrong secret', async () => {
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, 'wrong_secret_12345678901234567890');
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, sig, WEBHOOK_SECRET), false);
});

Deno.test('rejects non-hex or malformed signature', async () => {
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, '', WEBHOOK_SECRET), false);
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, 'not-a-hex-signature', WEBHOOK_SECRET), false);
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, null, WEBHOOK_SECRET), false);
});

Deno.test('rejects uppercase signature (Razorpay delivers lowercase hex)', async () => {
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, sig.toUpperCase(), WEBHOOK_SECRET), false);
});

Deno.test('rejects re-serialised JSON (signature requires exact raw body bytes)', async () => {
  const raw = JSON.stringify(JSON.parse(PAYMENT_CAPTURED_BODY), null, 2);
  const sig = await computeSignature(raw, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(raw, sig, WEBHOOK_SECRET), true);
  assertEquals(await verifyWebhookSignature(JSON.stringify(JSON.parse(raw)), sig, WEBHOOK_SECRET), false);
});

Deno.test('checkout signature binds the server order id and payment id', async () => {
  const secret = 'test_key_secret_12345';
  const orderId = 'order_TEST00000001';
  const payId = 'pay_TEST00000001';
  const sig = await computeSignature(`${orderId}|${payId}`, secret);
  assertEquals(await verifyCheckoutSignature(orderId, payId, sig, secret), true);
  assertEquals(await verifyCheckoutSignature(orderId, 'pay_TEST00000002', sig, secret), false);
  assertEquals(await verifyCheckoutSignature('order_TEST00000002', payId, sig, secret), false);
  assertEquals(await verifyCheckoutSignature(orderId, payId, 'bad-sig', secret), false);
});

Deno.test('readWebhook maps payment.captured to exact IngestParams', () => {
  const parsed = JSON.parse(PAYMENT_CAPTURED_BODY);
  const res = readWebhook('evt_captured_001', parsed);
  assertEquals(res.ok, true);
  if (!res.ok) return;
  assertEquals(res.params, {
    p_event_id: 'evt_captured_001',
    p_event_type: 'payment.captured',
    p_gateway_order_id: 'order_TestOrder001',
    p_gateway_payment_id: 'pay_TestCaptured001',
    p_gateway_refund_id: null,
    p_amount_paise: 1003000,
    p_currency: 'INR',
    p_occurred_at: new Date(1793800000 * 1000).toISOString(),
    p_source: 'webhook',
  } satisfies IngestParams);
});

Deno.test('readWebhook maps refund.processed with refund and payment IDs', () => {
  const parsed = JSON.parse(REFUND_PROCESSED_BODY);
  const res = readWebhook('evt_refund_001', parsed);
  assertEquals(res.ok, true);
  if (!res.ok) return;
  assertEquals(res.params, {
    p_event_id: 'evt_refund_001',
    p_event_type: 'refund.processed',
    p_gateway_order_id: 'order_TestOrder001',
    p_gateway_payment_id: 'pay_TestCaptured001',
    p_gateway_refund_id: 'rfnd_TestRefund001',
    p_amount_paise: 500000,
    p_currency: 'INR',
    p_occurred_at: new Date(1793900000 * 1000).toISOString(),
    p_source: 'webhook',
  } satisfies IngestParams);
});

Deno.test('readWebhook maps order.paid correctly', () => {
  const parsed = JSON.parse(ORDER_PAID_BODY);
  const res = readWebhook('evt_orderpaid_001', parsed);
  assertEquals(res.ok, true);
  if (!res.ok) return;
  assertEquals(res.params.p_event_type, 'order.paid');
  assertEquals(res.params.p_amount_paise, 1003000);
  assertEquals(res.params.p_currency, 'INR');
});

Deno.test('readWebhook leaves blank currency as null to fail closed', () => {
  const parsed = JSON.parse(PAYMENT_CAPTURED_BODY);
  parsed.payload.payment.entity.currency = '';
  const res = readWebhook('evt_captured_001', parsed);
  assertEquals(res.ok, true);
  if (!res.ok) return;
  assertEquals(res.params.p_currency, null);
});

Deno.test('readWebhook refuses unhandled events and malformed IDs', () => {
  const parsed = JSON.parse(PAYMENT_CAPTURED_BODY);
  parsed.event = 'invoice.paid';
  assertEquals(readWebhook('evt_001', parsed), { ok: false, reason: 'not_handled' });
  assertEquals(readWebhook(null, JSON.parse(PAYMENT_CAPTURED_BODY)), { ok: false, reason: 'bad_event_id' });
  assertEquals(readWebhook('bad!', JSON.parse(PAYMENT_CAPTURED_BODY)), { ok: false, reason: 'bad_event_id' });
});
