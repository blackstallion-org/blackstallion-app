/**
 * Client side of the G7 billing contract (data/CONTRACT.md).
 *  1. Static: every function and argument the app sends exists in the staged G7 SQL with that exact signature and is
 *     granted to `authenticated`; the service-role functions (ingest, attach, reconcile, flag_overdue) are never used by
 *     the app, and no webhook/signature handling exists in the app source.
 *  2. Behaviour: `createBillingServer` over src/testing/fakeSupabase + a fake of the G7 functions (testing/fakeG7):
 *     exact RPC arguments, payer-only reads, replay-safe ordering, provider failure / webhook replay never fabricating
 *     a payment, and honest errors. The real authorization and replay checks are G7's SQL tests (referenced below).
 */
import fs from 'fs';
import path from 'path';

import { createFakeSupabase, networkFailure, type FakeResult } from '@/testing/fakeSupabase';

import { BILLING_RPC, createBillingServer, HISTORY_PAGE, OVERVIEW_PAGE } from '../data/server';
import type { BillingScope } from '../data/repositories';
import { BillingError } from '../domain/billingErrors';
import { billingMonthOf } from '../domain/orders';
import { createFakeG7 } from '../testing/fakeG7';

const REPO = path.resolve(__dirname, '../../../../..');
const G7 = path.join(REPO, 'server/reference/g7-billing');
const SQL = fs.readFileSync(path.join(G7, 'migrations/20261104007000_mobile_g7_billing.sql'), 'utf8');
const G7_TESTS = fs.readFileSync(path.join(G7, 'tests/g7_billing_tests.sql'), 'utf8');

const A = 'guardian-a';
const B = 'guardian-b';
const NOW = Date.parse('2026-11-05T06:00:00Z'); // 11:30 IST, 5 Nov 2026
const MONTH = billingMonthOf(new Date(NOW));
const scopeA: BillingScope = {
  subjectId: A,
  experience: 'family',
  children: [
    { cadetId: 'cadet-a1', firstName: 'Aarav', hubId: null },
    { cadetId: 'cadet-a2', firstName: 'Meera', hubId: null },
  ],
};
const scopeB: BillingScope = { subjectId: B, experience: 'family', children: [{ cadetId: 'cadet-b1', firstName: 'Kabir', hubId: null }] };
const OP1 = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';

function setup({
  checkoutEnabled = true,
  kitInApp = false,
  wrap,
}: { checkoutEnabled?: boolean; kitInApp?: boolean; wrap?: (fn: string, args: Record<string, unknown>, real: () => FakeResult) => FakeResult } = {}) {
  const g7 = createFakeG7({ families: { [A]: { 'cadet-a1': 'core_monthly', 'cadet-a2': null }, [B]: { 'cadet-b1': 'elite_monthly' } }, checkoutEnabled, kitInApp, now: () => NOW });
  g7.signInAs(A);
  const rpc = Object.fromEntries(
    Object.entries(g7.rpc).map(([fn, h]) => [fn, (args: Record<string, unknown>) => (wrap ? wrap(fn, args, () => h(args)) : h(args))]),
  );
  const fake = createFakeSupabase({ rpc });
  const repo = createBillingServer(fake.client, { now: () => new Date(NOW), timeoutMs: 500 });
  const rpcCalls = () => fake.calls.flatMap((c) => (c.kind === 'rpc' ? [c] : []));
  return { g7, repo, fake, rpcCalls };
}

const expectBillingError = async (p: Promise<unknown>, kind: BillingError['kind']) => {
  await expect(p).rejects.toBeInstanceOf(BillingError);
  await expect(p).rejects.toMatchObject({ kind });
};

// ------------------------------------------------------------------ 1. static contract against the G7 SQL

/** `create or replace function public.NAME(p_a type, p_b type default …)` → ['p_a', 'p_b']. */
function sqlParams(fn: string): string[] | null {
  const m = new RegExp(`create or replace function public\\.${fn}\\(([^)]*)\\)`, 'm').exec(SQL);
  if (!m) return null;
  return (m[1] ?? '').split(',').map((p) => p.trim().split(/\s+/)[0] ?? '').filter(Boolean);
}
const GRANTED_AUTHENTICATED = /foreach f in array array\[([^\]]*)\] loop\s+execute format\('revoke all on function %s from public, anon, service_role', f\);\s+execute format\('grant execute on function %s to authenticated'/.exec(SQL)?.[1] ?? '';
const SERVICE_ONLY = /foreach f in array array\[([^\]]*)\] loop\s+execute format\('revoke all on function %s from public, anon, authenticated', f\);\s+execute format\('grant execute on function %s to service_role'/.exec(SQL)?.[1] ?? '';

describe('static contract: the app calls only guardian functions of the G7 SQL, with their exact parameters', () => {
  const sent: Record<string, string[]> = {
    [BILLING_RPC.checkoutStatus]: [],
    [BILLING_RPC.quote]: ['p_cadet', 'p_items'],
    [BILLING_RPC.createOrder]: ['p_cadet', 'p_items', 'p_operation_id'],
    [BILLING_RPC.getOrder]: ['p_order'],
    [BILLING_RPC.listOrders]: ['p_before', 'p_limit'],
    [BILLING_RPC.noteClientReturn]: ['p_order', 'p_gateway_payment_id'],
    [BILLING_RPC.cancelOrder]: ['p_order'],
    [BILLING_RPC.getInvoicePdf]: ['p_order'],
  };
  test('the grant blocks were found', () => {
    expect(GRANTED_AUTHENTICATED).toContain('public.billing_get_order(uuid)');
    expect(SERVICE_ONLY).toContain('public.billing_ingest_event(');
  });

  test.each(Object.entries(sent))('%s exists with parameters %j and is granted to authenticated', (fn, params) => {
    expect(sqlParams(fn)).toEqual(params);
    expect(GRANTED_AUTHENTICATED).toContain(`'public.${fn}(`);
    expect(SERVICE_ONLY).not.toContain(`'public.${fn}(`);
  });

  test('the order JSON keys the app reads are the keys billing_order_json builds', () => {
    const body = /function app_private\.billing_order_json[\s\S]*?\$\$;/.exec(SQL)?.[0] ?? '';
    for (const k of ['orderId', 'reference', 'cadetId', 'state', 'underReview', 'currency', 'subtotalPaise', 'gstPaise', 'totalPaise', 'createdAt', 'expiresAt', 'cancelledAt', 'clientReturnedAt', 'paidAt', 'refundedPaise', 'invoice', 'number', 'issuedAt', 'lines', 'lineNo', 'type', 'label', 'month', 'unitAmountPaise', 'gstRateBp', 'basePaise', 'refunds', 'amountPaise', 'appliedAt']) {
      expect(body).toContain(`'${k}'`);
    }
  });

  test('provider-facing functions are service-role only and never referenced by app code; no webhook secret handling in the app', () => {
    for (const fn of ['billing_ingest_event', 'billing_attach_gateway_order', 'billing_reconcile_order', 'billing_flag_overdue']) {
      expect(SERVICE_ONLY).toContain(`'public.${fn}(`);
    }
    const appFiles: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'testing' && e.name !== 'node_modules') walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name)) appFiles.push(p);
      }
    };
    walk(path.resolve(__dirname, '../../..')); // mobile/src
    const offenders = appFiles.filter((f) => /billing_ingest_event|billing_attach_gateway_order|billing_reconcile_order|billing_flag_overdue|x-razorpay-signature|webhook_secret|RAZORPAY_KEY_SECRET/i.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('G7 server tests cover webhook replay, payer-only reads and replay-safe orders (run in R7: 221 passed, 0 failed)', () => {
    for (const name of [
      'ingest: the same event again changes nothing',
      'ingest: order.paid for the same payment is harmless',
      'ingest: a late failure does not undo the capture',
      'refund: the same refund reported again (reconciliation) counts once',
      'delayed: reconciling again changes nothing',
      'client: a success report moves the order to awaiting_confirmation only',
      'order: replay with the same operation id returns the same order',
      'order: same operation id with another request is refused',
      'authz: guardian B cannot order for guardian A',
      'cancel: another guardian cannot cancel it',
    ]) {
      expect(G7_TESTS).toContain(`'${name}'`);
    }
    const r7 = fs.readFileSync(path.join(REPO, 'server/live-delta/g9-app-surfaces/evidence/2026-11-05-replay-existing/merged/r7_g7_runner.txt'), 'utf8');
    expect(r7).toMatch(/G7 tests on the full website chain: 221 passed, 0 failed/);
    expect(r7).toMatch(/==== total failures: 0/);
  });
});

// ------------------------------------------------------------------ 2. behaviour over the fake G7 functions

describe('overview (BI-01)', () => {
  test('reads checkout status, the newest page, and quotes only uncovered months, with exact arguments', async () => {
    const { repo, rpcCalls } = setup({ checkoutEnabled: false });
    const o = await repo.orders.getOverview(scopeA);
    expect(o.source).toBe('server');
    expect(o.checkout).toEqual({ enabled: false, kitInApp: false });
    expect(o.month).toBe(MONTH);
    const calls = rpcCalls();
    expect(calls.find((c) => c.fn === 'billing_list_orders')?.args).toEqual({ p_before: null, p_limit: OVERVIEW_PAGE });
    expect(calls.filter((c) => c.fn === 'billing_quote').map((c) => c.args)).toEqual([
      { p_cadet: 'cadet-a1', p_items: [{ type: 'tuition', month: MONTH }] },
      { p_cadet: 'cadet-a2', p_items: [{ type: 'tuition', month: MONTH }] },
    ]);
    const [aarav, meera] = o.children;
    expect(aarav).toMatchObject({ kind: 'due', name: 'Aarav' });
    expect(aarav?.kind === 'due' && aarav.quote.totalPaise).toBe(1003000);
    expect(meera).toMatchObject({ kind: 'blocked', reason: 'noPlan' }); // PT422 no_plan (G7-D04: tier not set)
  });

  test('a child the caller does not pay for reads as notPayer (PT404), never as another family’s data', async () => {
    const { repo } = setup();
    const o = await repo.orders.getOverview({ ...scopeA, children: [{ cadetId: 'cadet-b1', firstName: 'Kabir', hubId: null }] });
    expect(o.children[0]).toMatchObject({ kind: 'blocked', reason: 'notPayer' });
  });

  test('a month that is being confirmed is not quoted again and is not shown twice', async () => {
    const { repo, g7, rpcCalls } = setup();
    const created = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    g7.service.attach(created.order.orderId, 'order_TEST000001');
    await repo.orders.noteClientReturn(scopeA, created.order.orderId, 'pay_TEST000001');
    const before = rpcCalls().filter((c) => c.fn === 'billing_quote').length;
    const o = await repo.orders.getOverview(scopeA);
    expect(o.children[0]).toMatchObject({ kind: 'confirming' });
    expect(rpcCalls().filter((c) => c.fn === 'billing_quote').length - before).toBe(1); // only Meera's month
    expect(o.otherInProgress).toEqual([]);
  });

  test('recent = the newest three orders; the kit add-on is quoted only when the server sells it in the app (G7-D03)', async () => {
    const off = setup();
    for (const [i, op] of [OP1, OP2].entries()) {
      const o = await off.repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: i ? '2026-12' : MONTH }], operationId: op });
      if (!i) await off.repo.orders.cancelOrder(scopeA, o.order.orderId);
    }
    const ov = await off.repo.orders.getOverview(scopeA);
    expect(ov.recent.map((o) => o.lines[0]?.month)).toEqual(['2026-12', MONTH]);
    expect(ov.addOns).toEqual([]);
    expect(off.rpcCalls().some((c) => c.fn === 'billing_quote' && JSON.stringify(c.args).includes('"kit"'))).toBe(false);

    const on = setup({ kitInApp: true });
    const withKit = await on.repo.orders.getOverview(scopeA);
    expect(withKit.addOns.map((a) => [a.cadetId, a.quote.totalPaise])).toEqual([
      ['cadet-a1', 590000],
      ['cadet-a2', 590000],
    ]);
    const kitOrder = await on.repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'kit' }], operationId: OP1 });
    on.g7.service.attach(kitOrder.order.orderId, 'order_KIT0000001');
    await on.repo.orders.noteClientReturn(scopeA, kitOrder.order.orderId, 'pay_KIT0000001');
    expect((await on.repo.orders.getOverview(scopeA)).addOns.map((a) => a.cadetId)).toEqual(['cadet-a2']); // confirming kit: not offered again
  });

  test('G7 not applied on this server (PGRST202) → unavailable; a null checkout status → signed out', async () => {
    const missing = createBillingServer(createFakeSupabase({ rpc: {} }).client);
    await expectBillingError(missing.orders.getOverview(scopeA), 'unavailable');
    const { repo, g7 } = setup();
    g7.signInAs(null);
    await expectBillingError(repo.orders.getOverview(scopeA), 'signedOut');
  });

  test('a non-family scope is refused before any request', async () => {
    const { repo, rpcCalls } = setup();
    await expectBillingError(repo.orders.getOverview({ ...scopeA, experience: 'field' as 'family' }), 'forbidden');
    expect(rpcCalls()).toEqual([]);
  });
});

describe('duplicate pay taps create one order (operation id)', () => {
  test('the app sends only cadet, canonical items and the operation id: no amount, no payer', async () => {
    const { repo, rpcCalls } = setup();
    await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    expect(rpcCalls().find((c) => c.fn === 'billing_create_order')?.args).toEqual({ p_cadet: 'cadet-a1', p_items: [{ type: 'tuition', month: MONTH }], p_operation_id: OP1 });
  });

  test('the same operation id twice returns the original order (replayed), and only one order exists', async () => {
    const { repo, g7 } = setup();
    const req = { cadetId: 'cadet-a1', items: [{ type: 'tuition' as const, month: MONTH }], operationId: OP1 };
    const [first, second] = await Promise.all([repo.orders.createOrder(scopeA, req), repo.orders.createOrder(scopeA, req)]);
    expect(second.order.orderId).toBe(first.order.orderId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(g7.service.orderCount()).toBe(1);
  });

  test('a lost answer (network failure after the server committed) is retried with the same id and gives the same order', async () => {
    let drop = true;
    const { repo, g7 } = setup({
      wrap: (fn, _args, real) => {
        const r = real();
        if (fn === 'billing_create_order' && drop) {
          drop = false;
          return networkFailure(); // committed server-side, answer lost
        }
        return r;
      },
    });
    const req = { cadetId: 'cadet-a1', items: [{ type: 'tuition' as const, month: MONTH }], operationId: OP1 };
    const lost = repo.orders.createOrder(scopeA, req);
    await expectBillingError(lost, 'network');
    await expect(lost).rejects.toMatchObject({ retryable: true });
    const retry = await repo.orders.createOrder(scopeA, req);
    expect(retry.replayed).toBe(true);
    expect(g7.service.orderCount()).toBe(1);
  });

  test('a new operation id for an identical open order reuses it; a reused id with another request is a conflict', async () => {
    const { repo, g7 } = setup();
    const first = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    const again = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP2 });
    expect(again).toMatchObject({ reused: true, replayed: false });
    expect(again.order.orderId).toBe(first.order.orderId);
    expect(g7.service.orderCount()).toBe(1);
    await expectBillingError(repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: '2026-12' }], operationId: OP1 }), 'conflict');
  });

  test('checkout switched off (G7-D15) refuses a new order; a malformed operation id never leaves the phone', async () => {
    const { repo, rpcCalls } = setup({ checkoutEnabled: false });
    await expectBillingError(repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 }), 'checkoutOff');
    const n = rpcCalls().length;
    await expectBillingError(repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: 'op-1' }), 'unexpected');
    expect(rpcCalls().length).toBe(n);
  });
});

describe('payer-only access', () => {
  test('guardian B gets "not found" for guardian A’s order (read, cancel, report) and the answer carries none of A’s data', async () => {
    const { repo, g7 } = setup();
    const a = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    g7.signInAs(B);
    await expectBillingError(repo.orders.getOrder(scopeB, a.order.orderId), 'notFound');
    await expectBillingError(repo.orders.cancelOrder(scopeB, a.order.orderId), 'notFound');
    await expectBillingError(repo.orders.noteClientReturn(scopeB, a.order.orderId, 'pay_TEST000001'), 'notFound');
    expect((await repo.orders.listOrders(scopeB)).orders).toEqual([]);
    await expectBillingError(repo.orders.createOrder(scopeB, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP2 }), 'notFound');
  });

  test('a malformed deep-link id is "not found" without a request', async () => {
    const { repo, rpcCalls } = setup();
    for (const id of ['26-27/000017', '', '../../../settings', 'DROP TABLE']) {
      await expectBillingError(repo.orders.getOrder(scopeA, id), 'notFound');
    }
    expect(rpcCalls()).toEqual([]);
  });
});

describe('provider failure never becomes success; webhook replay is harmless', () => {
  test('a checkout success report only moves the order to awaiting_confirmation (no invoice)', async () => {
    const { repo, g7 } = setup();
    const { order } = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    g7.service.attach(order.orderId, 'order_TEST000001');
    const after = await repo.orders.noteClientReturn(scopeA, order.orderId, 'pay_TEST000001');
    expect(after.state).toBe('awaiting_confirmation');
    expect(after.invoice).toBeNull();
  });

  test('payment.failed leaves the order payable; a malformed payment id is refused on the phone', async () => {
    const { repo, g7, rpcCalls } = setup();
    const { order } = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    g7.service.attach(order.orderId, 'order_TEST000001');
    expect(g7.service.ingest('evt_1', 'payment.failed', 'order_TEST000001', 'pay_TEST000001', 1003000, 'INR')).toBe('failed');
    expect((await repo.orders.getOrder(scopeA, order.orderId)).state).toBe('failed');
    const n = rpcCalls().length;
    await expectBillingError(repo.orders.noteClientReturn(scopeA, order.orderId, 'payment-ok'), 'invalid');
    expect(rpcCalls().length).toBe(n);
  });

  test('a server answer claiming "paid" without an invoice is a shape error, never a payment', async () => {
    const { repo } = setup({
      wrap: (fn, args, real) => {
        const r = real();
        if (fn !== 'billing_get_order' || !r.data) return r;
        return { ...r, data: { ...(r.data as object), state: 'paid', invoice: null } };
      },
    });
    const { order } = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    const p = repo.orders.getOrder(scopeA, order.orderId);
    await expectBillingError(p, 'unexpected');
    await expect(p).rejects.toMatchObject({ reference: 'SHAPE-order' });
  });

  test('the verified capture delivered twice (and as order.paid) settles once: one invoice, the same answer to the app', async () => {
    const { repo, g7 } = setup();
    const { order } = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    g7.service.attach(order.orderId, 'order_TEST000001');
    expect(g7.service.ingest('evt_cap', 'payment.captured', 'order_TEST000001', 'pay_TEST000001', 1003000, 'INR')).toBe('paid');
    const first = await repo.orders.getOrder(scopeA, order.orderId);
    expect(g7.service.ingest('evt_cap', 'payment.captured', 'order_TEST000001', 'pay_TEST000001', 1003000, 'INR')).toBe('duplicate');
    expect(g7.service.ingest('evt_paid', 'order.paid', 'order_TEST000001', 'pay_TEST000001', 1003000, 'INR')).toBe('already_paid');
    expect(g7.service.ingest('evt_late', 'payment.failed', 'order_TEST000001', 'pay_TEST000001', 1003000, 'INR')).toBe('ignored');
    const again = await repo.orders.getOrder(scopeA, order.orderId);
    expect(again).toEqual(first);
    expect(again.state).toBe('paid');
    expect(g7.service.invoiceCount()).toBe(1);
  });

  test('a capture for the wrong amount is not a payment: the order stays unpaid and shows "under review"', async () => {
    const { repo, g7 } = setup();
    const { order } = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    g7.service.attach(order.orderId, 'order_TEST000001');
    expect(g7.service.ingest('evt_short', 'payment.captured', 'order_TEST000001', 'pay_TEST000001', 1002999, 'INR')).toBe('amount_mismatch');
    const o = await repo.orders.getOrder(scopeA, order.orderId);
    expect(o).toMatchObject({ state: 'awaiting_payment', underReview: true, invoice: null });
  });
});

describe('history and cancellation', () => {
  test('history pages by keyset with the server cap; the cursor is the last createdAt', async () => {
    const { repo, rpcCalls } = setup();
    const page = await repo.orders.listOrders(scopeA, null);
    expect(rpcCalls().at(-1)?.args).toEqual({ p_before: null, p_limit: HISTORY_PAGE });
    expect(page.nextBefore).toBeNull();
    await repo.orders.listOrders(scopeA, '2026-11-04T00:00:00.000Z');
    expect(rpcCalls().at(-1)?.args).toEqual({ p_before: '2026-11-04T00:00:00.000Z', p_limit: HISTORY_PAGE });
    await expect(repo.orders.listOrders(scopeA, 'yesterday')).rejects.toMatchObject({ reference: 'SHAPE-cursor' });
  });

  test('an unpaid order can be cancelled once; after a success report it cannot', async () => {
    const { repo, g7 } = setup();
    const { order } = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP1 });
    expect((await repo.orders.cancelOrder(scopeA, order.orderId)).state).toBe('cancelled');
    await expectBillingError(repo.orders.cancelOrder(scopeA, order.orderId), 'conflict');
    const second = await repo.orders.createOrder(scopeA, { cadetId: 'cadet-a1', items: [{ type: 'tuition', month: MONTH }], operationId: OP2 });
    g7.service.attach(second.order.orderId, 'order_TEST000002');
    await repo.orders.noteClientReturn(scopeA, second.order.orderId, 'pay_TEST000002');
    await expectBillingError(repo.orders.cancelOrder(scopeA, second.order.orderId), 'conflict');
  });

  test('a hung request times out as a retryable network error', async () => {
    const fake = createFakeSupabase({ rpc: { billing_get_order: () => new Promise<FakeResult>(() => undefined) } });
    const repo = createBillingServer(fake.client, { timeoutMs: 20 });
    const p = repo.orders.getOrder(scopeA, '5a3b1e00-0000-4000-8000-000000000003');
    await expectBillingError(p, 'network');
  });

  test('the server build connects invoice PDF but no checkout or autopay (G7-D13, G7-D11)', () => {
    const { repo } = setup();
    expect(repo.checkout).toBeUndefined();
    expect(repo.invoices).toBeDefined();
    expect(repo.autopay).toBeUndefined();
  });
});
