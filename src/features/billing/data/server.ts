import { withTimeout } from '@/features/field/data/net';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';
import { isUuid } from '@/features/field/domain/operation';

import { BillingError, shapeError, toBillingError } from '../domain/billingErrors';
import {
  billingMonthOf,
  canonicalItems,
  coverageFor,
  inProgress,
  isBillingOrderId,
  parseBillingOrder,
  parseCheckoutStatus,
  parseQuote,
  type BillingOrder,
  type CheckoutStatus,
} from '../domain/orders';
import type { CheckoutResult } from '../domain/paymentState';
import type {
  BillingOrderRepository,
  BillingOverview,
  BillingRepositories,
  BillingScope,
  BlockedReason,
  CheckoutGateway,
  CheckoutSession,
  ChildMonth,
  InvoiceDocumentRepository,
  OrderWithChild,
} from './repositories';

/** Guardian-callable G7 functions (granted to `authenticated`). The service-role functions are never called by the app. */
export const BILLING_RPC = {
  checkoutStatus: 'billing_checkout_status',
  quote: 'billing_quote',
  createOrder: 'billing_create_order',
  getOrder: 'billing_get_order',
  listOrders: 'billing_list_orders',
  noteClientReturn: 'billing_note_client_return',
  cancelOrder: 'billing_cancel_order',
  getInvoicePdf: 'billing_get_invoice_pdf',
} as const;

/** Page sizes: the overview reads the newest 50 (the server's cap) to find this month's orders; BI-02 pages by 20. */
export const OVERVIEW_PAGE = 50;
export const HISTORY_PAGE = 20;

const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const NOT_FOUND = () => new BillingError('notFound', 'This payment or invoice can’t be found for your account.', 'not_found', 'CLIENT-ID');

const BLOCKED_BY_HINT: Record<string, BlockedReason> = {
  no_plan: 'noPlan',
  not_enrolled: 'notEnrolled',
  no_price: 'noPrice',
  month_out_of_range: 'outOfRange',
};

export type BillingServerOptions = { timeoutMs?: number; now?: () => Date; checkout?: CheckoutGateway };

/**
 * Billing over the G7 server draft (server/reference/g7-billing; contract in ./CONTRACT.md). Not applied to any real
 * project yet (D33): against a server without the functions every read fails as `unavailable` (PGRST202) and the
 * screens say billing is not set up. Provider checkout (E-1), invoice PDFs (G7-D07) and mandates (G7-D11) do not exist,
 * so `checkout`, `invoices` and `autopay` are absent and those actions stay unavailable. No real provider is ever called
 * from this module.
 */
export function createBillingServer(
  client: DataClient & { functions?: EdgeFunctionInvoker },
  opts: BillingServerOptions = {},
): BillingRepositories {
  const now = opts.now ?? (() => new Date());

  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    let res;
    try {
      res = await withTimeout(client.rpc(fn, args), opts.timeoutMs);
    } catch (e) {
      throw toBillingError(e);
    }
    if (res.error) throw toBillingError(res.error, res.status);
    return res.data;
  }

  const family = (scope: BillingScope) => {
    if (scope.experience !== 'family') throw new BillingError('forbidden', 'Billing is only available in the Family experience.', undefined, 'SCOPE');
  };
  const nameOf = (scope: BillingScope, cadetId: string) => scope.children?.find((c) => c.cadetId === cadetId)?.firstName ?? null;
  const withChild = (scope: BillingScope, o: BillingOrder): OrderWithChild => ({ ...o, childName: nameOf(scope, o.cadetId) });
  const order = (scope: BillingScope, json: unknown): OrderWithChild => {
    const o = parseBillingOrder(json);
    if (!o) throw shapeError('order');
    return withChild(scope, o);
  };
  const orderList = (json: unknown): BillingOrder[] => {
    if (!Array.isArray(json)) throw shapeError('orders');
    return json.map((j) => {
      const o = parseBillingOrder(j);
      if (!o) throw shapeError('order');
      return o;
    });
  };

  const checkoutStatus = async (): Promise<CheckoutStatus> => {
    const json = await call(BILLING_RPC.checkoutStatus, {});
    // billing_checkout_status() answers null when the request carries no signed-in user.
    if (json === null) throw new BillingError('signedOut', 'Your session ended. Sign in again to see billing.', 'sign_in', 'SESSION');
    const status = parseCheckoutStatus(json);
    if (!status) throw shapeError('checkout');
    return status;
  };

  const orders: BillingOrderRepository = {
    async getCheckoutStatus(scope) {
      family(scope);
      return checkoutStatus();
    },

    async getOverview(scope) {
      family(scope);
      const [checkout, listJson] = await Promise.all([checkoutStatus(), call(BILLING_RPC.listOrders, { p_before: null, p_limit: OVERVIEW_PAGE })]);
      const history = orderList(listJson);
      const month = billingMonthOf(now());

      const children: ChildMonth[] = await Promise.all(
        (scope.children ?? []).map(async (c): Promise<ChildMonth> => {
          const base = { cadetId: c.cadetId, name: c.firstName, month };
          const cover = coverageFor(history, c.cadetId, month);
          if (cover.kind !== 'none') return { ...base, kind: cover.kind, order: withChild(scope, cover.order) };
          try {
            const q = parseQuote(await call(BILLING_RPC.quote, { p_cadet: c.cadetId, p_items: [{ type: 'tuition', month }] }));
            if (!q) throw shapeError('quote');
            return { ...base, kind: 'due', quote: q };
          } catch (e) {
            const be = toBillingError(e);
            const reason = be.kind === 'notFound' ? 'notPayer' : be.hint ? BLOCKED_BY_HINT[be.hint] : undefined;
            if (reason) return { ...base, kind: 'blocked', reason };
            throw be;
          }
        }),
      );
      const shown = new Set(children.flatMap((c) => ('order' in c ? [c.order.orderId] : [])));

      // Add-ons only when the server sells them in the app (G7-D03 kit channel), priced by the server, and only for a
      // child whose kit is not already paid or being confirmed. Refusals (no price, not enrolled…) simply omit it.
      const addOns: BillingOverview['addOns'] = [];
      if (checkout.kitInApp) {
        for (const c of scope.children ?? []) {
          const hasKit = history.some((o) => o.cadetId === c.cadetId && o.lines.some((l) => l.type === 'kit') && ['paid', 'partially_refunded', 'awaiting_confirmation'].includes(o.state));
          if (hasKit) continue;
          try {
            const q = parseQuote(await call(BILLING_RPC.quote, { p_cadet: c.cadetId, p_items: [{ type: 'kit' }] }));
            if (q) addOns.push({ cadetId: c.cadetId, name: c.firstName, item: 'kit', quote: q });
          } catch (e) {
            const be = toBillingError(e);
            if (be.kind === 'network' || be.kind === 'signedOut' || be.kind === 'unavailable') throw be;
          }
        }
      }

      const overview: BillingOverview = {
        source: 'server',
        checkout,
        month,
        children,
        otherInProgress: inProgress(history).filter((o) => !shown.has(o.orderId)).map((o) => withChild(scope, o)),
        recent: history.slice(0, 3).map((o) => withChild(scope, o)),
        addOns,
        historyCount: history.length,
        historyHasMore: history.length >= OVERVIEW_PAGE,
      };
      return overview;
    },

    async listOrders(scope, before) {
      family(scope);
      if (before !== undefined && before !== null && Number.isNaN(Date.parse(before))) throw shapeError('cursor');
      const list = orderList(await call(BILLING_RPC.listOrders, { p_before: before ?? null, p_limit: HISTORY_PAGE }));
      const last = list[list.length - 1];
      return { orders: list.map((o) => withChild(scope, o)), nextBefore: list.length >= HISTORY_PAGE && last ? last.createdAt : null };
    },

    async getOrder(scope, orderId) {
      family(scope);
      if (!isBillingOrderId(orderId)) throw NOT_FOUND(); // never sent: a malformed deep link is simply not found
      return order(scope, await call(BILLING_RPC.getOrder, { p_order: orderId }));
    },

    async createOrder(scope, req) {
      family(scope);
      if (!isUuid(req.operationId)) throw new BillingError('unexpected', 'Internal error: bad operation id.', undefined, 'CLIENT-OPID');
      // UX guard only: the server checks cadets.parent_id = auth.uid() itself and answers PT404 otherwise.
      if (scope.children && !scope.children.some((c) => c.cadetId === req.cadetId)) throw NOT_FOUND();
      const data = await call(BILLING_RPC.createOrder, {
        p_cadet: req.cadetId,
        // Canonical order: the server hashes p_items as sent, so a replay must send exactly the same list.
        p_items: canonicalItems(req.items),
        p_operation_id: req.operationId,
      });
      const o = order(scope, data);
      const d = data as Record<string, unknown>;
      if (typeof d.replayed !== 'boolean' || typeof d.reused !== 'boolean') throw shapeError('replayed');
      return { order: o, replayed: d.replayed, reused: d.reused };
    },

    async cancelOrder(scope, orderId) {
      family(scope);
      if (!isBillingOrderId(orderId)) throw NOT_FOUND();
      return order(scope, await call(BILLING_RPC.cancelOrder, { p_order: orderId }));
    },

    async noteClientReturn(scope, orderId, gatewayPaymentId) {
      family(scope);
      if (!isBillingOrderId(orderId)) throw NOT_FOUND();
      if (!PAYMENT_ID.test(gatewayPaymentId)) {
        throw new BillingError('invalid', 'The payment provider’s answer wasn’t understood. Nothing is confirmed.', 'invalid_payment_id', 'CLIENT-PAYID');
      }
      return order(scope, await call(BILLING_RPC.noteClientReturn, { p_order: orderId, p_gateway_payment_id: gatewayPaymentId }));
    },
  };

  const invoices: InvoiceDocumentRepository = {
    async getPdf(scope, orderId) {
      family(scope);
      if (!isBillingOrderId(orderId)) throw NOT_FOUND();
      const json = await call(BILLING_RPC.getInvoicePdf, { p_order: orderId });
      if (!json || typeof json !== 'object') throw shapeError('invoice_pdf');
      const { url, expires_at } = json as Record<string, unknown>;
      if (typeof url !== 'string' || typeof expires_at !== 'string') throw shapeError('invoice_pdf');
      return { url, expiresAt: expires_at };
    },
  };

  const checkout = opts.checkout ?? (client.functions ? createEdgeCheckoutGateway(client.functions) : undefined);

  return { source: 'server', orders, invoices, ...(checkout ? { checkout } : {}) };
}

export type EdgeFunctionInvoker = {
  invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;
};

/** Parses and validates the session returned by the create-order Edge Function (E-1). */
export function parseCheckoutSession(v: unknown): CheckoutSession | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.keyId !== 'string' || o.keyId.length === 0 ||
    typeof o.gatewayOrderId !== 'string' || !/^order_[A-Za-z0-9]{6,40}$/.test(o.gatewayOrderId) ||
    typeof o.amountPaise !== 'number' || !Number.isSafeInteger(o.amountPaise) || o.amountPaise < 0 ||
    o.currency !== 'INR' ||
    typeof o.reference !== 'string'
  ) {
    return null;
  }
  return {
    keyId: o.keyId,
    gatewayOrderId: o.gatewayOrderId,
    amountPaise: o.amountPaise,
    currency: 'INR',
    reference: o.reference,
  };
}

/** Creates a CheckoutGateway backed by Supabase Edge Functions. */
export function createEdgeCheckoutGateway(
  functions: EdgeFunctionInvoker,
  opts: {
    mode?: 'provider' | 'test';
    open?: (session: CheckoutSession) => Promise<CheckoutResult>;
  } = {},
): CheckoutGateway {
  return {
    mode: opts.mode ?? 'provider',
    async prepare(scope, orderId) {
      if (scope.experience !== 'family') {
        throw new BillingError('forbidden', 'Billing is only available in the Family experience.', undefined, 'SCOPE');
      }
      if (!isBillingOrderId(orderId)) throw NOT_FOUND();
      let res;
      try {
        res = await functions.invoke('create-order', { body: { orderId } });
      } catch (e) {
        throw toBillingError(e);
      }
      if (res.error) throw toBillingError(res.error);
      const session = parseCheckoutSession(res.data);
      if (!session) throw shapeError('checkout_session');
      return session;
    },
    async open(session) {
      if (opts.open) return opts.open(session);
      throw new BillingError('unavailable', 'Payment provider checkout UI is not available in this build.', 'no_ui');
    },
  };
}
