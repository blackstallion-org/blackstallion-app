/**
 * BI-01..BI-06 on the real route tree (src/app) with the development adapter (JS-level, jest-expo; not a device).
 * Billing repositories are swapped per test: the labelled fixtures, nothing (unconnected build), or the REAL server
 * repository over a fake of the G7 functions with a fake provider checkout, to show the critical rules end to end:
 * provider failure never becomes success, a checkout success shows "Confirming" until the server records a verified
 * capture, duplicate pay taps create one order, and only the payer can open an order.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import path from 'path';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { createBillingFixtures, SAMPLE_ORDER_IDS } from '@/dev/fixtures/billing';
import type { PersonaId } from '@/dev/personas';
import { createFakeSupabase } from '@/testing/fakeSupabase';

import type { BillingRepositories, CheckoutGateway, CheckoutSession } from '../data/repositories';
import { createBillingServer } from '../data/server';
import { BillingError } from '../domain/billingErrors';
import { billingMonthOf } from '../domain/orders';
import type { CheckoutResult } from '../domain/paymentState';
import { BILLING_COPY as C } from '../strings';
import { createFakeG7 } from '../testing/fakeG7';

jest.mock('@/dev/preview', () => {
  const actual = jest.requireActual('@/dev/preview');
  const { createDevAccessAdapter } = jest.requireActual('@/dev/devAccessAdapter');
  const { createFixtureRepositories } = jest.requireActual('@/dev/fixtures');
  return { ...actual, devAccessAdapter: createDevAccessAdapter({ latencyMs: 0 }), devRepositories: createFixtureRepositories({ latencyMs: 0 }) };
});
const dev = jest.requireMock('@/dev/preview') as typeof import('@/dev/preview');
const APP_DIR = path.resolve(__dirname, '../../../app');
jest.setTimeout(20000);

const setBilling = (b: BillingRepositories | undefined) => {
  dev.devRepositories.billing = b;
};

beforeEach(async () => {
  await dev.devAccessAdapter.signOut();
  await AsyncStorage.clear();
  setBilling(createBillingFixtures({ latencyMs: 0 }));
});

const signIn = async (id: PersonaId = 'guardian') => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await act(async () => dev.devAccessAdapter.selectPersona(id));
  await waitFor(() => expect(r.getPathname()).not.toBe('/sign-in'));
  return r;
};
const open = async (r: Awaited<ReturnType<typeof signIn>>, url: string) => {
  await act(async () => router.push(url));
  await waitFor(() => expect(r.getPathname()).toBe(url));
};
const text = () => JSON.stringify(screen.toJSON());

describe('BI-01 Billing', () => {
  test('server-quoted amount due and line items; Pay enabled only through the labelled local test checkout', async () => {
    const r = await signIn();
    await open(r, '/family/billing');
    expect((await screen.findByTestId('billing-amount-due')).props.accessibilityLabel).toMatch(/₹10,030\.00$/);
    expect(screen.getByTestId('preview-banner')).toBeTruthy();
    expect(screen.getByTestId('billing-child-syn-cadet-a1-total')).toHaveTextContent('₹10,030.00', { exact: false });
    expect(screen.getByTestId('billing-pay-syn-cadet-a1')).toBeEnabled();
    expect(screen.getByTestId('billing-pay-why-syn-cadet-a1')).toHaveTextContent(C.testMode, { exact: false });
    expect(screen.getByTestId('billing-child-syn-cadet-a2-status')).toHaveTextContent(/Paid$/);
    const other = screen.getByTestId('billing-other-in-progress');
    expect(within(other).getByText('Confirming')).toBeTruthy();
    expect(within(other).getByText('Failed')).toBeTruthy();
    expect(screen.getByTestId('billing-recent')).toBeTruthy();
    expect(screen.queryByTestId('billing-add-ons')).toBeNull(); // G7-D03: the kit is not sold in the app
  });

  test('server switch off (pilot default, G7-D15): Pay is shown, disabled, explained, and cannot create an order', async () => {
    const billing = createBillingFixtures({ latencyMs: 0 });
    const create = jest.spyOn(billing.orders, 'createOrder');
    setBilling(billing);
    const r = await signIn('dualRole');
    await open(r, '/family/billing');
    const pay = await screen.findByTestId('billing-pay-syn-cadet-d1');
    expect(pay).toBeDisabled();
    expect(pay.props.accessibilityHint).toMatch(/Unavailable: online payment is switched off/);
    expect(screen.getByTestId('billing-pay-why-syn-cadet-d1')).toHaveTextContent(/switched off/);
    await fireEvent.press(pay);
    expect(create).not.toHaveBeenCalled();
  });

  test('records lead to Invoices → invoice detail and back; a cold deep link backs out to Profile', async () => {
    const r = await signIn();
    await open(r, '/family/billing');
    await fireEvent.press(await screen.findByTestId('open-invoices'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/billing/invoices'));
    await fireEvent.press(await screen.findByTestId(`invoice-row-${SAMPLE_ORDER_IDS.meeraThisPaid}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/family/billing/invoices/${SAMPLE_ORDER_IDS.meeraThisPaid}`));
    expect(await screen.findByTestId('invoice-number')).toHaveTextContent(/^\d{2}-\d{2}\/000017$/);
    expect(screen.getByTestId('invoice-download')).toBeDisabled();
    expect(screen.getByTestId('invoice-share')).toBeDisabled();
    expect(screen.getByTestId('invoice-pdf-unavailable')).toHaveTextContent(C.pdfUnavailableTitle, { exact: false });
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/billing/invoices'));
    // A non-settled row opens the payment status instead of an invoice.
    await fireEvent.press(await screen.findByTestId(`invoice-row-${SAMPLE_ORDER_IDS.aaravNextFailed}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/family/billing/orders/${SAMPLE_ORDER_IDS.aaravNextFailed}`));
  });

  test('back from a cold deep link to BI-01 goes to the Family Profile, not out of the app', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    await act(async () => dev.devAccessAdapter.selectPersona('guardian'));
    await waitFor(() => expect(r.getPathname()).toBe('/family'));
    await act(async () => router.replace('/family/billing'));
    await screen.findByTestId('billing-amount-due');
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/profile'));
  });

  test('no linked child → a meaningful empty state, still with the records entry', async () => {
    const r = await signIn('guardianNoChild');
    await open(r, '/family/billing');
    expect(await screen.findByTestId('billing-no-children')).toBeTruthy();
    expect(screen.getByTestId('open-invoices')).toBeTruthy();
  });

  test('academy unreachable → offline state with a retry (no stale or invented amounts)', async () => {
    const r = await signIn('familyDataError');
    await open(r, '/family/billing');
    expect(await screen.findByTestId('billing-error-offline')).toHaveTextContent(C.offlineMessage, { exact: false });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByTestId('billing-amount-due')).toBeNull();
  });

  test('tier not set by the academy (G7-D04) → the child’s month is explained, nothing is due', async () => {
    setBilling(createBillingFixtures({ latencyMs: 0, families: { 'syn-dual': { checkout: false, children: [{ cadetId: 'syn-cadet-d1', name: 'Isha (sample)', plan: null, enrolled: true }] } } }));
    const r = await signIn('dualRole');
    await open(r, '/family/billing');
    expect(await screen.findByTestId('billing-child-syn-cadet-d1-blocked')).toHaveTextContent(C.blocked.noPlan);
    expect(screen.queryByTestId('billing-amount-due')).toBeNull();
    expect(screen.getByTestId('billing-nothing-due')).toBeTruthy();
  });

  test('a session the server no longer accepts → permission-denied state, not an error or empty list', async () => {
    const billing = createBillingFixtures({ latencyMs: 0 });
    jest.spyOn(billing.orders, 'getOverview').mockRejectedValue(new BillingError('signedOut', 'Your session ended. Sign in again to see billing.', 'sign_in', '42501'));
    setBilling(billing);
    const r = await signIn();
    await open(r, '/family/billing');
    expect(await screen.findByTestId('billing-error-denied')).toHaveTextContent(C.signedOutTitle, { exact: false });
  });

  test('an unconnected build says so honestly on every billing route', async () => {
    setBilling(undefined);
    const r = await signIn();
    for (const url of ['/family/billing', '/family/billing/invoices', '/family/billing/autopay', `/family/billing/orders/${SAMPLE_ORDER_IDS.meeraThisPaid}`]) {
      await open(r, url);
      expect(await screen.findByTestId('billing-unconnected')).toHaveTextContent(C.unconnectedTitle, { exact: false });
    }
  });

  test('Field Ops staff cannot reach billing (Family experience only)', async () => {
    const r = await signIn('instructor');
    await act(async () => {
      try {
        router.push('/family/billing');
      } catch {
        // the guard refuses the route
      }
    });
    expect(r.getPathname()).not.toBe('/family/billing');
    expect(screen.queryByTestId('billing-home')).toBeNull();
  });
});

describe('payer-only deep links', () => {
  test('another payer’s order and a malformed id read as "not found"; the malformed id is never requested', async () => {
    const billing = createBillingFixtures({ latencyMs: 0 });
    const get = jest.spyOn(billing.orders, 'getOrder');
    setBilling(billing);
    const r = await signIn();
    await open(r, `/family/billing/orders/${SAMPLE_ORDER_IDS.otherPayers}`);
    expect(await screen.findByTestId('order-error-not-found')).toBeTruthy();
    expect(text()).not.toMatch(/BO-SAMPLE0090/);
    await open(r, `/family/billing/invoices/${SAMPLE_ORDER_IDS.otherPayers}`);
    expect(await screen.findByTestId('invoice-error-not-found')).toBeTruthy();
    const calls = get.mock.calls.length;
    await open(r, '/family/billing/orders/not-an-order');
    expect(await screen.findByTestId('order-error-not-found')).toBeTruthy();
    await open(r, '/family/billing/invoices/26-27');
    expect(await screen.findByTestId('invoice-error-not-found')).toBeTruthy();
    expect(get.mock.calls.length).toBe(calls);
    await fireEvent.press(screen.getByRole('button', { name: C.backToBilling }));
    await waitFor(() => expect(r.getPathname()).toBe('/family/billing'));
  });
});

// ------------------------------------------------------------------ the real server repository over a fake G7

const NOW = Date.now();
const MONTH = billingMonthOf(new Date(NOW));
const PAYER = 'syn-guardian-a';

function serverWithCheckout(open: (s: CheckoutSession) => Promise<CheckoutResult>, amountDelta = 0) {
  const g7 = createFakeG7({ families: { [PAYER]: { 'syn-cadet-a1': 'core_monthly' } }, checkoutEnabled: true });
  g7.signInAs(PAYER);
  const { client, calls } = createFakeSupabase({ rpc: g7.rpc });
  const server = createBillingServer(client);
  const gateway: CheckoutGateway = {
    mode: 'provider',
    // Stands in for Edge Function E-1: the server creates the provider order and states the amount.
    prepare: jest.fn(async (_scope, orderId: string) => {
      const o = await server.orders.getOrder({ subjectId: PAYER, experience: 'family' }, orderId);
      g7.service.attach(orderId, 'order_TEST000001');
      return { keyId: 'rzp_test_x', gatewayOrderId: 'order_TEST000001', amountPaise: o.totalPaise + amountDelta, currency: 'INR' as const, reference: o.reference };
    }),
    open: jest.fn(open),
  };
  const billing: BillingRepositories = { ...server, checkout: gateway };
  return { g7, billing, gateway, rpcNames: () => calls.flatMap((c) => (c.kind === 'rpc' ? [c.fn] : [])) };
}

const newOrder = async (billing: BillingRepositories) =>
  (await billing.orders.createOrder({ subjectId: PAYER, experience: 'family' }, { cadetId: 'syn-cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: '33333333-3333-4333-8333-333333333333' })).order;

describe('BI-04 payment status: provider failure never becomes success', () => {
  test('a failed checkout leaves the server state on screen, reports nothing, and never says Paid', async () => {
    const { billing, gateway, rpcNames } = serverWithCheckout(async () => ({ kind: 'failed', reason: 'PAYMENT_DECLINED' }));
    const order = await newOrder(billing);
    setBilling(billing);
    const r = await signIn();
    await open(r, `/family/billing/orders/${order.orderId}`);
    const pay = await screen.findByTestId('order-pay');
    expect(pay).toBeEnabled();
    await fireEvent.press(pay);
    expect(await screen.findByTestId('order-note')).toHaveTextContent(C.checkoutFailedNote, { exact: false });
    expect(gateway.open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('order-state-title')).toHaveTextContent('Waiting for payment'));
    expect(rpcNames()).not.toContain('billing_note_client_return');
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByTestId('order-view-invoice')).toBeNull();
  });

  test('a checkout "success" shows Confirming (never Paid) until the server records the verified capture; a replayed webhook changes nothing', async () => {
    const { g7, billing } = serverWithCheckout(async () => ({ kind: 'success', paymentId: 'pay_TEST1234567' }));
    const order = await newOrder(billing);
    setBilling(billing);
    const r = await signIn();
    await open(r, `/family/billing/orders/${order.orderId}`);
    await fireEvent.press(await screen.findByTestId('order-pay'));
    await waitFor(() => expect(screen.getByTestId('order-state-title')).toHaveTextContent('Confirming your payment'));
    expect(screen.getByTestId('order-polling')).toBeTruthy();
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByTestId('order-pay')).toBeNull(); // no second payment while confirming
    expect(screen.queryByTestId('order-cancel')).toBeNull();

    // Server side: the webhook route verified the signature and calls billing_ingest_event (twice: replay).
    expect(g7.service.ingest('evt_A', 'payment.captured', 'order_TEST000001', 'pay_TEST1234567', 1003000, 'INR')).toBe('paid');
    expect(g7.service.ingest('evt_A', 'payment.captured', 'order_TEST000001', 'pay_TEST1234567', 1003000, 'INR')).toBe('duplicate');
    await waitFor(() => expect(screen.getByTestId('order-state-title')).toHaveTextContent('Paid'), { timeout: 8000 });
    expect(screen.getByTestId('order-view-invoice')).toBeTruthy();
    expect(g7.service.invoiceCount()).toBe(1);
  });

  test('a provider amount that differs from the order never opens checkout', async () => {
    const { billing, gateway } = serverWithCheckout(async () => ({ kind: 'success', paymentId: 'pay_TEST1234567' }), 1);
    const order = await newOrder(billing);
    setBilling(billing);
    const r = await signIn();
    await open(r, `/family/billing/orders/${order.orderId}`);
    await fireEvent.press(await screen.findByTestId('order-pay'));
    expect(await screen.findByTestId('order-note')).toHaveTextContent(C.amountMismatch, { exact: false });
    expect(gateway.open).not.toHaveBeenCalled();
  });

  test('cancel asks first (icon + text), then shows the server’s cancelled state and the start-again path', async () => {
    const r = await signIn();
    await open(r, `/family/billing/orders/${SAMPLE_ORDER_IDS.aaravNextFailed}`);
    expect(await screen.findByTestId('order-state-title')).toHaveTextContent('Payment didn’t go through');
    expect(screen.getByTestId('order-retry-rule')).toHaveTextContent(C.retryRules.failed);
    await fireEvent.press(screen.getByTestId('order-cancel'));
    const dialog = await screen.findByTestId('order-cancel-dialog');
    const buttons = within(dialog).getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(buttons.indexOf(C.keepOrder)).toBeLessThan(buttons.indexOf(C.cancelOrder)); // the safe choice comes first
    await fireEvent.press(screen.getByTestId('order-cancel-dialog-keep'));
    await waitFor(() => expect(screen.queryByTestId('order-cancel-dialog')).toBeNull());
    expect(screen.getByTestId('order-state-title')).toHaveTextContent('Payment didn’t go through');
    await fireEvent.press(screen.getByTestId('order-cancel'));
    await fireEvent.press(await screen.findByTestId('order-cancel-dialog-confirm'));
    await waitFor(() => expect(screen.getByTestId('order-state-title')).toHaveTextContent('Cancelled'));
    expect(screen.getByTestId('order-start-again')).toBeTruthy();
    expect(screen.queryByTestId('order-cancel')).toBeNull();
  });
});

describe('duplicate pay taps create one order', () => {
  const withCheckout = () => {
    const billing = createBillingFixtures({ latencyMs: 0, checkoutEnabled: true });
    const gateway: CheckoutGateway = { mode: 'provider', prepare: jest.fn(), open: jest.fn() };
    return { ...billing, checkout: gateway };
  };

  test('two quick taps on Pay send one create request and open one order', async () => {
    const billing = withCheckout();
    const create = jest.spyOn(billing.orders, 'createOrder');
    setBilling(billing);
    const r = await signIn();
    await open(r, '/family/billing');
    const pay = await screen.findByTestId('billing-pay-syn-cadet-a1');
    expect(pay).toBeEnabled();
    await act(async () => {
      fireEvent.press(pay);
      fireEvent.press(pay);
    });
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/family\/billing\/orders\/[0-9a-f-]{36}$/));
    expect(create).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('order-state-title')).toHaveTextContent('Ready to pay');
  });

  test('after a lost answer the retry reuses the same operation id (a replay, not a second order)', async () => {
    const billing = withCheckout();
    const real = billing.orders.createOrder.bind(billing.orders);
    let first = true;
    const create = jest.spyOn(billing.orders, 'createOrder').mockImplementation(async (scope, req) => {
      const res = await real(scope, req);
      if (first) {
        first = false;
        throw new BillingError('network', 'We couldn’t reach the academy.', undefined, 'HTTP-0'); // committed, answer lost
      }
      return res;
    });
    setBilling(billing);
    const r = await signIn();
    await open(r, '/family/billing');
    await fireEvent.press(await screen.findByTestId('billing-pay-syn-cadet-a1'));
    expect(await screen.findByTestId('billing-pay-error-syn-cadet-a1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('billing-pay-syn-cadet-a1'));
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/family\/billing\/orders\//));
    expect(create).toHaveBeenCalledTimes(2);
    const [a, b] = create.mock.calls.map((c) => c[1].operationId);
    expect(a).toBe(b);
    expect((await create.mock.results[1]?.value)?.replayed).toBe(true);
  });
});

describe('BI-05 Autopay and BI-06 Cancel autopay', () => {
  test('cancelling needs a destructive confirmation; Keep leaves it; Confirm shows "requested", never "cancelled"', async () => {
    const r = await signIn();
    await open(r, '/family/billing/autopay');
    expect(await screen.findByTestId('autopay-preview')).toHaveTextContent(C.autopayPreview);
    expect(screen.getByTestId('autopay-syn-cadet-a2-state')).toHaveTextContent(/On$/);
    expect(screen.getByTestId('autopay-syn-cadet-a1-state')).toHaveTextContent(/Waiting for your bank$/);
    await fireEvent.press(screen.getByTestId('autopay-syn-cadet-a2-cancel'));
    const dialog = await screen.findByTestId('autopay-cancel-dialog');
    expect(within(dialog).getByText('Cancel autopay for Meera (sample)?')).toBeTruthy();
    expect(within(dialog).getByText(/doesn’t refund anything/)).toBeTruthy();
    const order = within(dialog).getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(order.indexOf(C.keepAutopay)).toBeLessThan(order.indexOf(C.cancelAutopay)); // Cancel (keep) is the default
    await fireEvent.press(screen.getByTestId('autopay-cancel-dialog-keep'));
    await waitFor(() => expect(screen.queryByTestId('autopay-cancel-dialog')).toBeNull());
    expect(screen.getByTestId('autopay-syn-cadet-a2-state')).toHaveTextContent(/On$/);

    await fireEvent.press(screen.getByTestId('autopay-syn-cadet-a2-cancel'));
    await fireEvent.press(await screen.findByTestId('autopay-cancel-dialog-confirm'));
    await waitFor(() => expect(screen.getByTestId('autopay-syn-cadet-a2-state')).toHaveTextContent(/Cancellation requested$/));
    expect(screen.getByTestId('autopay-syn-cadet-a2-note')).toHaveTextContent(C.cancelRequested, { exact: false });
    expect(screen.queryByText('Cancelled')).toBeNull();
    expect(screen.queryByTestId('autopay-syn-cadet-a2-cancel')).toBeNull();
    expect(screen.queryByTestId('autopay-syn-cadet-a1-setup')).toBeNull(); // waiting for the bank: no second set-up
  });

  test('without a mandate contract (every server build) autopay says it isn’t offered; set-up is never faked', async () => {
    const { client } = createFakeSupabase({ rpc: {} });
    setBilling(createBillingServer(client));
    const r = await signIn();
    await open(r, '/family/billing/autopay');
    expect(await screen.findByTestId('autopay-unavailable')).toHaveTextContent(C.autopayUnavailableTitle, { exact: false });
  });
});

describe('local test checkout (labelled; no provider, no money) in the development fixtures', () => {
  test('Pay → order → test sheet → "success" shows Confirming, never Paid; the order cannot be paid twice', async () => {
    const r = await signIn();
    await open(r, '/family/billing');
    await fireEvent.press(await screen.findByTestId('billing-pay-syn-cadet-a1'));
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/family\/billing\/orders\//));
    expect(await screen.findByTestId('order-state-title')).toHaveTextContent('Ready to pay');
    expect(screen.getByTestId('order-gate')).toHaveTextContent(C.testMode, { exact: false });
    await fireEvent.press(screen.getByTestId('order-pay'));
    expect(await screen.findByTestId('test-checkout-banner')).toHaveTextContent(C.testCheckoutBanner, { exact: false });
    await fireEvent.press(screen.getByTestId('test-checkout-success'));
    await waitFor(() => expect(screen.getByTestId('order-state-title')).toHaveTextContent('Confirming your payment'));
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByTestId('order-pay')).toBeNull();
    expect(screen.queryByTestId('order-view-invoice')).toBeNull();
  });

  test('a failed and a closed test checkout stay distinct, and neither becomes success', async () => {
    const r = await signIn();
    await open(r, `/family/billing/orders/${SAMPLE_ORDER_IDS.aaravNextFailed}`);
    await fireEvent.press(await screen.findByTestId('order-pay'));
    await fireEvent.press(await screen.findByTestId('test-checkout-failure'));
    expect(await screen.findByTestId('order-note')).toHaveTextContent(C.checkoutFailedNote, { exact: false });
    expect(screen.getByTestId('order-state-title')).toHaveTextContent('Payment didn’t go through');
    await fireEvent.press(screen.getByTestId('order-pay'));
    await fireEvent.press(await screen.findByTestId('test-checkout-dismiss'));
    await waitFor(() => expect(screen.getByTestId('order-note')).toHaveTextContent(C.checkoutDismissedNote, { exact: false }));
    expect(screen.queryByText('Paid')).toBeNull();
  });
});

describe('offline after a successful load (cached, money actions off)', () => {
  test('a failed background re-read keeps the amounts on screen, says offline, and disables Pay', async () => {
    const billing = createBillingFixtures({ latencyMs: 0 });
    const real = billing.orders.getOverview.bind(billing.orders);
    let calls = 0;
    jest.spyOn(billing.orders, 'getOverview').mockImplementation(async (scope) => {
      calls += 1;
      if (calls > 1) throw new BillingError('network', 'offline', undefined, 'HTTP-0');
      return real(scope);
    });
    setBilling(billing);
    const r = await signIn();
    await open(r, '/family/billing');
    expect(await screen.findByTestId('billing-pay-syn-cadet-a1')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('open-autopay'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/billing/autopay'));
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/billing'));
    expect(await screen.findByTestId('billing-stale')).toHaveTextContent(C.staleTitle, { exact: false });
    expect(screen.getByTestId('billing-amount-due')).toBeTruthy();
    expect(screen.getByTestId('billing-pay-syn-cadet-a1')).toBeDisabled();
    expect(screen.getByTestId('billing-pay-why-syn-cadet-a1')).toHaveTextContent(C.offlineAction, { exact: false });
  });
});

describe('registered routes (/settings/billing/...)', () => {
  test('alias the Family billing screens, passing the id through', async () => {
    const r = await signIn();
    await act(async () => router.push('/settings/billing'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/billing'));
    await act(async () => router.push(`/settings/billing/orders/${SAMPLE_ORDER_IDS.aaravNextFailed}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/family/billing/orders/${SAMPLE_ORDER_IDS.aaravNextFailed}`));
    expect(await screen.findByTestId('order-state-title')).toHaveTextContent('Payment didn’t go through');
  });

  test('outside the Family experience they explain that billing is Family-only', async () => {
    const r = await signIn('instructor');
    await act(async () => router.push('/settings/billing'));
    await waitFor(() => expect(r.getPathname()).toBe('/settings/billing'));
    expect(await screen.findByTestId('billing-family-only')).toBeTruthy();
  });
});
