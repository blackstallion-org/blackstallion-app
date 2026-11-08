import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import { verifyWebhookSignature } from '../razorpay.ts';
import {
  WEBHOOK_SECRET,
  computeSignature,
  PAYMENT_CAPTURED_BODY,
  PAYMENT_FAILED_BODY,
  REFUND_CREATED_BODY,
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

Deno.test('accepts correct signature for refund.created', async () => {
  const sig = await computeSignature(REFUND_CREATED_BODY, WEBHOOK_SECRET);
  assertEquals(await verifyWebhookSignature(REFUND_CREATED_BODY, sig, WEBHOOK_SECRET), true);
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
  const sig = await computeSignature(PAYMENT_CAPTURED_BODY, 'wrong_secret');
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, sig, WEBHOOK_SECRET), false);
});

Deno.test('rejects empty signature', async () => {
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, '', WEBHOOK_SECRET), false);
});

Deno.test('rejects empty body', async () => {
  assertEquals(await verifyWebhookSignature('', 'abcdef', WEBHOOK_SECRET), false);
});

Deno.test('rejects empty secret', async () => {
  assertEquals(await verifyWebhookSignature(PAYMENT_CAPTURED_BODY, 'abcdef', ''), false);
});
