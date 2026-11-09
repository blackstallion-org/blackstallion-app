/**
 * @jest-environment node
 *
 * Billing journeys J34–J37: pay dues, download invoice, autopay, buy kit/passport.
 * Exercises billing repositories against the local staging stack. Razorpay integration is stubbed
 * (no gateway in staging); the server-side order lifecycle (create → cancel) is tested.
 */
import { randomUUID } from 'node:crypto';

import { seedScreens, setCheckout, snapshotSwitches, restoreSwitches, type ScreensWorld } from '../seedScreens';
import { seedWorld, type Account } from '../stack';
import { cachedSession, clearSessionCache } from './helpers';

jest.setTimeout(60_000);

let w: ScreensWorld;
let switches: ReturnType<typeof snapshotSwitches>;
const as = (name: keyof ScreensWorld & string) => cachedSession(name, w[name] as Account);

beforeAll(async () => {
  w = await seedScreens(await seedWorld());
  switches = snapshotSwitches();
  setCheckout(true);
});
afterAll(() => {
  restoreSwitches(switches);
  clearSessionCache();
});

// ──────────────────────────────────────────────────────────── J34: Pay dues
describe('J34: Pay dues', () => {
  test('billing overview returns checkout status and children months', async () => {
    const s = await as('guardianA');
    const overview = await s.repos.billing.orders.getOverview(s.billing);
    expect(overview).toBeDefined();
    expect(overview.source).toBe('server');
    expect(overview.checkout).toBeDefined();
    expect(Array.isArray(overview.children)).toBe(true);
  });

  test('create order for cadet A (replay-safe)', async () => {
    const s = await as('guardianA');
    const overview = await s.repos.billing.orders.getOverview(s.billing);
    const due = overview.children.find((c) => c.kind === 'due' && c.cadetId === w.cadetA);
    if (!due || due.kind !== 'due') throw new Error('expected a due month for cadet A (seeded enrollment)');
    const opId = randomUUID();
    const req = { cadetId: w.cadetA, items: [{ type: 'tuition' as const, month: due.month }], operationId: opId };
    const result = await s.repos.billing.orders.createOrder(s.billing, req);
    expect(result.order).toBeDefined();
    const replay = await s.repos.billing.orders.createOrder(s.billing, req);
    expect(replay.replayed || replay.reused).toBeTruthy();
  });

  test('cancel order', async () => {
    const s = await as('guardianA');
    const overview = await s.repos.billing.orders.getOverview(s.billing);
    const open = overview.children.find((c) => c.kind === 'open' || c.kind === 'confirming');
    if (!open || !('order' in open)) throw new Error('expected an open order to cancel (created above)');
    const result = await s.repos.billing.orders.cancelOrder(s.billing, open.order.orderId);
    expect(result).toBeDefined();
  });

  test('guardian B denied access to guardian A billing', async () => {
    const s = await as('guardianB');
    const overview = await s.repos.billing.orders.getOverview(s.billing);
    const hasA = overview.children.some((c: { cadetId: string }) => c.cadetId === w.cadetA);
    expect(hasA).toBe(false);
  });

  test.skip('PARTIAL:no-Razorpay – payment gateway not available in staging', () => {});
});

// ──────────────────────────────────────────────────────────── J35: Download invoice (order history)
describe('J35: Download invoice / order history', () => {
  test('list orders returns paginated history', async () => {
    const s = await as('guardianA');
    const page = await s.repos.billing.orders.listOrders(s.billing);
    expect(page).toBeDefined();
    expect(Array.isArray(page.orders)).toBe(true);
  });

  test('get single order by id', async () => {
    const s = await as('guardianA');
    const page = await s.repos.billing.orders.listOrders(s.billing);
    if (page.orders.length > 0) {
      const order = await s.repos.billing.orders.getOrder(s.billing, page.orders[0]!.orderId);
      expect(order).toBeDefined();
    }
  });
});

// ──────────────────────────────────────────────────────────── J36: Autopay setup/cancel
describe('J36: Autopay setup/cancel', () => {
  test.skip('BLOCKED:D11 – autopay feature not approved', () => {});
});

// ──────────────────────────────────────────────────────────── J37: Buy kit / passport
describe('J37: Buy kit / passport add-on', () => {
  test('billing overview shows add-ons', async () => {
    const s = await as('guardianA');
    const overview = await s.repos.billing.orders.getOverview(s.billing);
    expect(Array.isArray(overview.addOns)).toBe(true);
  });

  test.skip('PARTIAL:no-Razorpay – add-on purchase needs payment gateway', () => {});
});
