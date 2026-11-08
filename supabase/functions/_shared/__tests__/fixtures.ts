/**
 * Recorded Razorpay webhook payloads for testing. Each fixture includes the raw JSON body,
 * a fake webhook secret, and the correct HMAC-SHA256 hex signature.
 */

export const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_0001';

const encoder = new TextEncoder();

export async function computeSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const PAYMENT_CAPTURED_BODY = JSON.stringify({
  entity: 'event',
  event: 'payment.captured',
  event_id: 'evt_captured_001',
  created_at: 1793800000,
  payload: {
    payment: {
      entity: {
        id: 'pay_TestCaptured001',
        order_id: 'order_TestOrder001',
        amount: 1003000,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
      },
    },
  },
});

export const PAYMENT_FAILED_BODY = JSON.stringify({
  entity: 'event',
  event: 'payment.failed',
  event_id: 'evt_failed_001',
  created_at: 1793800000,
  payload: {
    payment: {
      entity: {
        id: 'pay_TestFailed001',
        order_id: 'order_TestOrder002',
        amount: 590000,
        currency: 'INR',
        status: 'failed',
        method: 'card',
        error_code: 'BAD_REQUEST_ERROR',
        error_description: 'Payment declined by bank',
      },
    },
  },
});

export const REFUND_PROCESSED_BODY = JSON.stringify({
  entity: 'event',
  event: 'refund.processed',
  event_id: 'evt_refund_001',
  created_at: 1793900000,
  payload: {
    refund: {
      entity: {
        id: 'rfnd_TestRefund001',
        payment_id: 'pay_TestCaptured001',
        amount: 500000,
        currency: 'INR',
        status: 'processed',
        created_at: 1793899999,
      },
    },
    payment: {
      entity: {
        id: 'pay_TestCaptured001',
        order_id: 'order_TestOrder001',
        amount: 1003000,
        currency: 'INR',
        status: 'refunded',
      },
    },
  },
});

export const ORDER_PAID_BODY = JSON.stringify({
  entity: 'event',
  event: 'order.paid',
  event_id: 'evt_orderpaid_001',
  created_at: 1793800001,
  payload: {
    payment: {
      entity: {
        id: 'pay_TestCaptured001',
        order_id: 'order_TestOrder001',
        amount: 1003000,
        currency: 'INR',
      },
    },
    order: {
      entity: {
        id: 'order_TestOrder001',
        amount: 1003000,
        amount_paid: 1003000,
        currency: 'INR',
        status: 'paid',
      },
    },
  },
});

export const TAMPERED_BODY = PAYMENT_CAPTURED_BODY.replace('"pay_TestCaptured001"', '"pay_TAMPERED999"');
