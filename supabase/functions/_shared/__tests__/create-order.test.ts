import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import { handleCreateOrder } from '../../create-order/index.ts';
import { createMockRazorpayClient } from '../razorpay.ts';
import { AuthError } from '../supabase.ts';

type Obj = Record<string, unknown>;

const TEST_ORDER_ID = '00000000-0000-0000-0000-000000000001';
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
  attachErr?: Obj | null;
  rzpHandler?: (p: { amount: number; currency: string; receipt: string }) => Obj;
  authError?: boolean;
} = {}) {
  const rpcCalls: { fn: string; params: unknown }[] = [];

  const serviceClient = {
    rpc(fn: string, params: unknown) {
      rpcCalls.push({ fn, params });
      if (fn === 'billing_attach_gateway_order') {
        return Promise.resolve({ data: null, error: overrides.attachErr ?? null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser(_token: string) {
        if (overrides.authError) return Promise.resolve({ data: { user: null }, error: { message: 'bad' } });
        return Promise.resolve({ data: { user: { id: TEST_USER_ID } }, error: null });
      },
    },
  } as unknown as ReturnType<typeof import('../supabase.ts').createServiceClient>;

  const razorpay = createMockRazorpayClient(
    overrides.rzpHandler ??
      ((p) => ({ id: 'order_RZP001', amount: p.amount, currency: p.currency, receipt: p.receipt, status: 'created' })),
  );

  const keyId = 'rzp_test_key';

  // Patch global Deno.env and createUserClient behavior via a proxy on the service client
  // We mock createUserClient indirectly: handleCreateOrder imports it, so we intercept at the module level.
  // Since we can't easily mock module imports in Deno, we test via the exported handler's deps pattern.
  // The user client is created inside handleCreateOrder from the request; we need to mock its rpc.
  // However, handleCreateOrder uses createUserClient(req) internally, which reads Deno.env.
  // For unit tests, we set the required env vars.
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');

  return { serviceClient, razorpay, keyId, rpcCalls };
}

// We need to mock createUserClient. Since handleCreateOrder calls it internally,
// we'll test extractable logic and the handler with a patched approach.
// The cleanest approach: mock the global fetch to intercept Supabase PostgREST calls.

function withFetchMock(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init ?? {}));
  };
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test('create-order: happy path creates order and returns session', async () => {
  const { serviceClient, razorpay, keyId } = mockDeps();

  const orderData = {
    state: 'created',
    gatewayOrderId: null,
    totalPaise: 1003000,
    reference: 'REF-001',
  };

  const restore = withFetchMock((url) => {
    if (url.includes('/rest/v1/rpc/billing_get_order')) {
      return new Response(JSON.stringify(orderData), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = buildRequest({ orderId: TEST_ORDER_ID });
    const res = await handleCreateOrder(req, { serviceClient, razorpay, keyId });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.keyId, 'rzp_test_key');
    assertEquals(body.gatewayOrderId, 'order_RZP001');
    assertEquals(body.amountPaise, 1003000);
    assertEquals(body.currency, 'INR');
    assertEquals(body.reference, 'REF-001');
  } finally {
    restore();
  }
});

Deno.test('create-order: idempotent — returns existing gateway order', async () => {
  const { serviceClient, razorpay, keyId } = mockDeps();

  const orderData = {
    state: 'awaiting_payment',
    gatewayOrderId: 'order_EXISTING',
    totalPaise: 500000,
    reference: 'REF-002',
  };

  const restore = withFetchMock((url) => {
    if (url.includes('/rest/v1/rpc/billing_get_order')) {
      return new Response(JSON.stringify(orderData), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = buildRequest({ orderId: TEST_ORDER_ID });
    const res = await handleCreateOrder(req, { serviceClient, razorpay, keyId });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.gatewayOrderId, 'order_EXISTING');
  } finally {
    restore();
  }
});

Deno.test('create-order: 409 when order is already paid', async () => {
  const { serviceClient, razorpay, keyId } = mockDeps();

  const orderData = { state: 'paid', gatewayOrderId: 'order_X', totalPaise: 100, reference: 'R' };

  const restore = withFetchMock((url) => {
    if (url.includes('/rest/v1/rpc/billing_get_order')) {
      return new Response(JSON.stringify(orderData), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = buildRequest({ orderId: TEST_ORDER_ID });
    const res = await handleCreateOrder(req, { serviceClient, razorpay, keyId });
    assertEquals(res.status, 409);
  } finally {
    restore();
  }
});

Deno.test('create-order: 401 on invalid JWT', async () => {
  const { serviceClient, razorpay, keyId } = mockDeps({ authError: true });

  const restore = withFetchMock(() => new Response('{}', { status: 200 }));

  try {
    const req = buildRequest({ orderId: TEST_ORDER_ID });
    const res = await handleCreateOrder(req, { serviceClient, razorpay, keyId });
    assertEquals(res.status, 401);
  } finally {
    restore();
  }
});

Deno.test('create-order: 400 on invalid orderId', async () => {
  const { serviceClient, razorpay, keyId } = mockDeps();
  const restore = withFetchMock(() => new Response('{}', { status: 200 }));

  try {
    const req = buildRequest({ orderId: 'not-a-uuid' });
    const res = await handleCreateOrder(req, { serviceClient, razorpay, keyId });
    assertEquals(res.status, 400);
  } finally {
    restore();
  }
});

Deno.test('create-order: 502 on Razorpay failure', async () => {
  const { serviceClient, keyId } = mockDeps();
  const razorpay = createMockRazorpayClient(() => {
    throw new Error('Razorpay API 500: internal');
  });

  const orderData = { state: 'created', gatewayOrderId: null, totalPaise: 100, reference: 'R' };

  const restore = withFetchMock((url) => {
    if (url.includes('/rest/v1/rpc/billing_get_order')) {
      return new Response(JSON.stringify(orderData), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  });

  try {
    const req = buildRequest({ orderId: TEST_ORDER_ID });
    const res = await handleCreateOrder(req, { serviceClient, razorpay, keyId });
    assertEquals(res.status, 502);
  } finally {
    restore();
  }
});
