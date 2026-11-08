import { BillingError } from '../domain/billingErrors';
import type { BillingScope, CheckoutSession } from '../data/repositories';
import {
  createBillingServer,
  createEdgeCheckoutGateway,
  parseCheckoutSession,
  type EdgeFunctionInvoker,
} from '../data/server';

const ORDER_ID = '00000000-0000-4000-8000-000000000001';
const scope: BillingScope = { subjectId: 'user-1', experience: 'family' };

describe('parseCheckoutSession', () => {
  test('parses a valid checkout session', () => {
    const raw = {
      keyId: 'rzp_live_test123',
      gatewayOrderId: 'order_TEST00000001',
      amountPaise: 1003000,
      currency: 'INR',
      reference: 'REF-2026-001',
    };
    expect(parseCheckoutSession(raw)).toEqual(raw);
  });

  test('refuses invalid or malformed sessions', () => {
    expect(parseCheckoutSession(null)).toBeNull();
    expect(parseCheckoutSession({})).toBeNull();
    expect(parseCheckoutSession({ keyId: '', gatewayOrderId: 'order_1', amountPaise: 100, currency: 'INR', reference: 'ref' })).toBeNull();
    expect(parseCheckoutSession({ keyId: 'k', gatewayOrderId: 'invalid_order', amountPaise: 100, currency: 'INR', reference: 'ref' })).toBeNull();
    expect(parseCheckoutSession({ keyId: 'k', gatewayOrderId: 'order_TEST0001', amountPaise: -1, currency: 'INR', reference: 'ref' })).toBeNull();
    expect(parseCheckoutSession({ keyId: 'k', gatewayOrderId: 'order_TEST0001', amountPaise: 100.5, currency: 'INR', reference: 'ref' })).toBeNull();
    expect(parseCheckoutSession({ keyId: 'k', gatewayOrderId: 'order_TEST0001', amountPaise: 100, currency: 'USD', reference: 'ref' })).toBeNull();
  });
});

describe('createEdgeCheckoutGateway', () => {
  test('prepare calls create-order Edge Function and returns validated session', async () => {
    const calls: { name: string; options: { body: unknown } }[] = [];
    const functions: EdgeFunctionInvoker = {
      async invoke(name, options) {
        calls.push({ name, options });
        return {
          data: {
            keyId: 'rzp_test_123',
            gatewayOrderId: 'order_TEST00000001',
            amountPaise: 1003000,
            currency: 'INR',
            reference: 'REF-001',
          },
          error: null,
        };
      },
    };

    const gateway = createEdgeCheckoutGateway(functions);
    const session = await gateway.prepare(scope, ORDER_ID);

    expect(calls).toEqual([{ name: 'create-order', options: { body: { orderId: ORDER_ID } } }]);
    expect(session.gatewayOrderId).toBe('order_TEST00000001');
    expect(session.amountPaise).toBe(1003000);
    expect(session.currency).toBe('INR');
  });

  test('prepare rejects non-family scope', async () => {
    const functions: EdgeFunctionInvoker = { async invoke() { return { data: null, error: null }; } };
    const gateway = createEdgeCheckoutGateway(functions);
    const nonFamily = { subjectId: 'user-1', experience: 'ops' } as unknown as BillingScope;
    await expect(gateway.prepare(nonFamily, ORDER_ID)).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('prepare rejects malformed orderId without network call', async () => {
    const functions: EdgeFunctionInvoker = { async invoke() { throw new Error('should not be called'); } };
    const gateway = createEdgeCheckoutGateway(functions);
    await expect(gateway.prepare(scope, 'not-a-uuid')).rejects.toMatchObject({ kind: 'notFound' });
  });

  test('prepare translates Edge Function errors to BillingError', async () => {
    const functions: EdgeFunctionInvoker = {
      async invoke() {
        return { data: null, error: { message: 'Order is not payable', status: 409 } };
      },
    };
    const gateway = createEdgeCheckoutGateway(functions);
    await expect(gateway.prepare(scope, ORDER_ID)).rejects.toBeInstanceOf(BillingError);
  });

  test('open calls custom handler when provided, or throws unavailable', async () => {
    const session: CheckoutSession = {
      keyId: 'k',
      gatewayOrderId: 'order_TEST00000001',
      amountPaise: 1000,
      currency: 'INR',
      reference: 'ref',
    };
    const gatewayWithoutUI = createEdgeCheckoutGateway({ async invoke() { return { data: null, error: null }; } });
    await expect(gatewayWithoutUI.open(session)).rejects.toMatchObject({ kind: 'unavailable' });

    const gatewayWithUI = createEdgeCheckoutGateway(
      { async invoke() { return { data: null, error: null }; } },
      { open: async () => ({ kind: 'success', paymentId: 'pay_TEST00000001' }) },
    );
    const result = await gatewayWithUI.open(session);
    expect(result).toEqual({ kind: 'success', paymentId: 'pay_TEST00000001' });
  });

  test('createBillingServer wires checkout when client has functions', () => {
    const fakeClient = {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({ select: () => ({}) }) as any,
      functions: { async invoke() { return { data: null, error: null }; } },
    } as any;
    const repo = createBillingServer(fakeClient);
    expect(repo.checkout).toBeDefined();
    expect(repo.checkout?.mode).toBe('provider');
  });
});
