import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import { handleCreateOrder } from '../../create-order/index.ts';
import {
  createMockRazorpayClient,
  type RazorpayOrder,
  type RazorpayOrderParams,
} from '../razorpay.ts';

type Obj = Record<string, unknown>;

const TEST_ORDER_ID = '00000000-0000-4000-8000-000000000001';
const TEST_USER_ID = 'user_abc123';

function buildRequest(body: unknown, token = 'valid-jwt'): Request {
  return new Request('http://localhost/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function mockDeps(overrides: {
  order?: Obj | null;
  orderErr?: Obj | null;
  attachData?: Obj | null;
  attachErr?: Obj | null;
  rzpHandler?: (p: RazorpayOrderParams) => RazorpayOrder;
  userId?: string;
} = {}) {
  const serviceCalls: { fn: string; params: unknown }[] = [];
  const userCalls: { fn: string; params: unknown }[] = [];
  const rzpCalls: RazorpayOrderParams[] = [];

  const defaultOrder = {
    orderId: TEST_ORDER_ID,
    state: 'created',
    gatewayOrderId: null,
    totalPaise: 1003000,
    currency: 'INR',
    reference: 'REF-2026-001',
  };

  const userClient = {
    rpc(fn: string, params: unknown) {
      userCalls.push({ fn, params });
      if (overrides.orderErr) return Promise.resolve({ data: null, error: overrides.orderErr });
      return Promise.resolve({ data: overrides.order !== undefined ? overrides.order : defaultOrder, error: null });
    },
  } as unknown as ReturnType<typeof import('../supabase.ts').createUserClient>;

  const serviceClient = {
    rpc(fn: string, params: unknown) {
      serviceCalls.push({ fn, params });
      if (fn === 'billing_attach_gateway_order') {
        if (overrides.attachErr) return Promise.resolve({ data: null, error: overrides.attachErr });
        return Promise.resolve({
          data: overrides.attachData !== undefined ? overrides.attachData : { attached: true },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser(_token: string) {
        return Promise.resolve({ data: { user: { id: TEST_USER_ID } }, error: null });
      },
    },
  } as unknown as ReturnType<typeof import('../supabase.ts').createServiceClient>;

  const razorpay = createMockRazorpayClient(
    overrides.rzpHandler ??
      ((p) => {
        rzpCalls.push(p);
        return { id: 'order_RZP001', amount: p.amount, currency: p.currency, receipt: p.receipt, status: 'created' };
      }),
  );

  const keyId = 'rzp_test_key_123';
  const userId = overrides.userId ?? TEST_USER_ID;

  return { serviceClient, userClient, razorpay, keyId, userId, serviceCalls, userCalls, rzpCalls };
}

Deno.test('create-order: happy path creates Razorpay order, attaches with 4 params, returns session', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId, serviceCalls, rzpCalls } = mockDeps();
  const req = buildRequest({ orderId: TEST_ORDER_ID });

  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 200);

  const session = await res.json();
  assertEquals(session, {
    keyId: 'rzp_test_key_123',
    gatewayOrderId: 'order_RZP001',
    amountPaise: 1003000,
    currency: 'INR',
    reference: 'REF-2026-001',
  });

  assertEquals(rzpCalls.length, 1);
  assertEquals(rzpCalls[0], {
    amount: 1003000,
    currency: 'INR',
    receipt: 'REF-2026-001',
    notes: { billing_order_id: TEST_ORDER_ID, user_id: TEST_USER_ID },
  });

  assertEquals(serviceCalls.length, 1);
  assertEquals(serviceCalls[0].fn, 'billing_attach_gateway_order');
  assertEquals(serviceCalls[0].params, {
    p_order: TEST_ORDER_ID,
    p_gateway_order_id: 'order_RZP001',
    p_amount_paise: 1003000,
    p_currency: 'INR',
  });
});

Deno.test('create-order: idempotent when order already has a gatewayOrderId', async () => {
  const existingOrder = {
    orderId: TEST_ORDER_ID,
    state: 'awaiting_payment',
    gatewayOrderId: 'order_EXISTING001',
    totalPaise: 1003000,
    currency: 'INR',
    reference: 'REF-2026-001',
  };

  const { serviceClient, userClient, razorpay, keyId, userId, rzpCalls, serviceCalls } = mockDeps({
    order: existingOrder,
  });

  const req = buildRequest({ orderId: TEST_ORDER_ID });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 200);

  const session = await res.json();
  assertEquals(session.gatewayOrderId, 'order_EXISTING001');
  assertEquals(rzpCalls.length, 0); // No new order created
  assertEquals(serviceCalls.length, 0); // No attach call needed
});

Deno.test('create-order: racing requests return winning gateway order ID when attach was won by another call', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps({
    attachData: { attached: false, gatewayOrderId: 'order_WINNER999' },
  });

  const req = buildRequest({ orderId: TEST_ORDER_ID });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 200);

  const session = await res.json();
  assertEquals(session.gatewayOrderId, 'order_WINNER999');
});

Deno.test('create-order: attach mismatch returns 409 conflict and does not hand out order', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps({
    attachData: { attached: false, error: 'gateway_mismatch' },
  });

  const req = buildRequest({ orderId: TEST_ORDER_ID });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 409);
  const data = await res.json();
  assertEquals(data.error, 'Gateway order mismatch');
});

Deno.test('create-order: checkout disabled returns 403', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps({
    attachErr: { code: 'PT423', message: 'online payment is not switched on' },
  });

  const req = buildRequest({ orderId: TEST_ORDER_ID });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 403);
  const data = await res.json();
  assertEquals(data.hint, 'checkout_disabled');
});

Deno.test('create-order: unpayable states (paid, confirming, cancelled, expired) return 409', async () => {
  for (const state of ['awaiting_confirmation', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'expired']) {
    const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps({
      order: {
        orderId: TEST_ORDER_ID,
        state,
        gatewayOrderId: null,
        totalPaise: 1003000,
        currency: 'INR',
        reference: 'REF-001',
      },
    });

    const req = buildRequest({ orderId: TEST_ORDER_ID });
    const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
    assertEquals(res.status, 409);
    const data = await res.json();
    assertEquals(data.error, 'Order is not payable');
  }
});

Deno.test('create-order: returns 404 when user does not own order (RLS PT404)', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps({
    orderErr: { code: 'PT404', message: 'not found' },
  });

  const req = buildRequest({ orderId: TEST_ORDER_ID });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 404);
});

Deno.test('create-order: returns 400 on malformed orderId', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps();
  const req = buildRequest({ orderId: 'not-a-uuid' });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 400);
});

Deno.test('create-order: returns 502 on Razorpay API error', async () => {
  const { serviceClient, userClient, razorpay, keyId, userId } = mockDeps({
    rzpHandler: () => {
      throw new Error('Razorpay API 500: internal error');
    },
  });

  const req = buildRequest({ orderId: TEST_ORDER_ID });
  const res = await handleCreateOrder(req, { serviceClient, userClient, razorpay, keyId, userId });
  assertEquals(res.status, 502);
});
