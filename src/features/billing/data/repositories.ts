/**
 * Billing (BI-01..BI-06): repository contract. Contract source: `./CONTRACT.md` (derived from the G7 server draft in
 * server/reference/g7-billing). Implementations: fixtures in `src/dev/fixtures/billing.ts` (development only, synthetic),
 * server in `./server.ts` (supabase-js over the G7 functions).
 *
 * Payer only: every method takes the caller's family scope; the server derives the payer from the session
 * (`auth.uid()` = `cadets.parent_id`) and answers PT404 for anyone else's records. The client never sends a payer id,
 * a price, a tax amount or a total.
 */
import type { Mandate } from '../domain/autopay';
import type { CheckoutResult } from '../domain/paymentState';
import type { BillingOrder, BillingQuote, CheckoutStatus, PayItem } from '../domain/orders';

export type BillingSource = 'synthetic-preview' | 'server';

/** The signed-in guardian's family scope (from the access snapshot). */
export type BillingScope = {
  subjectId: string;
  experience: 'family';
  /** Children linked to this guardian by the server snapshot. Fixtures ignore this and use their own synthetic family. */
  children?: readonly { cadetId: string; firstName: string; hubId: string | null }[];
};

/** An order plus the child's display name (from the scope; null when the child is no longer listed). */
export type OrderWithChild = BillingOrder & { childName: string | null };

/** Why a child's current month cannot be quoted. Each maps to a server hint from `billing_quote`. */
export type BlockedReason = 'noPlan' | 'notEnrolled' | 'noPrice' | 'outOfRange' | 'notPayer';

/** One child's tuition for the current billing month, as the payer sees it on BI-01. */
export type ChildMonth =
  | { cadetId: string; name: string; month: string; kind: 'due'; quote: BillingQuote }
  | { cadetId: string; name: string; month: string; kind: 'settled' | 'confirming' | 'open'; order: OrderWithChild }
  | { cadetId: string; name: string; month: string; kind: 'blocked'; reason: BlockedReason };

export interface BillingOverview {
  source: BillingSource;
  checkout: CheckoutStatus;
  /** Current billing month, YYYY-MM in Asia/Kolkata (the server's zone). */
  month: string;
  children: ChildMonth[];
  /** Open or confirming orders that are NOT already shown as a child's current month. */
  otherInProgress: OrderWithChild[];
  /** The newest orders (at most 3), for the "Recent" rows. */
  recent: OrderWithChild[];
  /** Add-ons the server permits in the app, priced by the server (the kit only when G7-D03 says `app`). */
  addOns: { cadetId: string; name: string; item: 'kit'; quote: BillingQuote }[];
  /** Number of orders in the newest page of history (for the Invoices entry). */
  historyCount: number;
  /** True when the history has more than the newest page. */
  historyHasMore: boolean;
}

export interface OrderPage {
  orders: OrderWithChild[];
  /** Keyset cursor for the next (older) page, or null when this is the last page. */
  nextBefore: string | null;
}

export interface CreateOrderRequest {
  cadetId: string;
  items: readonly PayItem[];
  /** Replay-safe: the same id with the same request returns the original order (G7 `billing_create_order`). */
  operationId: string;
}

export interface CreateOrderResult {
  order: OrderWithChild;
  /** The server returned an order created earlier for this operation id. */
  replayed: boolean;
  /** The server returned an identical open order instead of creating a second one. */
  reused: boolean;
}

export interface BillingOrderRepository {
  /** BI-01: checkout switch, each child's current month (server quote or covering order), other open payments. */
  getOverview(scope: BillingScope): Promise<BillingOverview>;
  /** `billing_checkout_status()`: the server switch (G7-D15) and kit channel (G7-D03). */
  getCheckoutStatus(scope: BillingScope): Promise<CheckoutStatus>;
  /** BI-02: own orders newest first (`billing_list_orders`, keyset on created_at). */
  listOrders(scope: BillingScope, before?: string | null): Promise<OrderPage>;
  /** BI-03 / BI-04: one own order. Someone else's, or an invalid id → BillingError notFound. */
  getOrder(scope: BillingScope, orderId: string): Promise<OrderWithChild>;
  /** Pay: the server prices the request and creates (or returns) the order. Gated by `payGate` in every build today. */
  createOrder(scope: BillingScope, req: CreateOrderRequest): Promise<CreateOrderResult>;
  /** BI-04: cancel an unpaid order (refused once a checkout success was reported). */
  cancelOrder(scope: BillingScope, orderId: string): Promise<OrderWithChild>;
  /** The checkout sheet said "success": a hint only. The order moves to awaiting_confirmation, never to paid. */
  noteClientReturn(scope: BillingScope, orderId: string, gatewayPaymentId: string): Promise<OrderWithChild>;
}

/** What the server's checkout Edge Function (E-1) hands the app for one billing order. Amount comes from the server. */
export interface CheckoutSession {
  keyId: string;
  gatewayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  reference: string;
}

/**
 * Provider checkout boundary. E-1 (`billing-checkout`, service role inside) creates or returns the Razorpay order and
 * records it on the billing order server-side (service role); `open` shows the provider's own checkout UI. Not written: no Razorpay
 * sandbox (G7-D13) and no verified SDK for Expo SDK 58. The server build has none, so Pay stays unavailable there;
 * development fixtures use the labelled local test checkout (`./testCheckout.ts`).
 */
export interface CheckoutGateway {
  /** 'provider' = the real provider SDK/hosted page; 'test' = the labelled local test checkout (no money moves). */
  readonly mode: 'provider' | 'test';
  prepare(scope: BillingScope, orderId: string): Promise<CheckoutSession>;
  open(session: CheckoutSession): Promise<CheckoutResult>;
}

/** BI-03 PDF boundary: a short-lived signed URL from the private `invoices` bucket. Not built (G7-D07). */
export interface InvoiceDocumentRepository {
  getPdf(scope: BillingScope, orderId: string): Promise<{ url: string; expiresAt: string }>;
}

export type MandateWithChild = Mandate & { childName: string | null };

/** BI-05 / BI-06 mandates. No server contract exists (G7-D11); fixtures only. */
export interface AutopayRepository {
  /** One entry per child in the scope (state 'none' when nothing was set up). */
  list(scope: BillingScope): Promise<MandateWithChild[]>;
  /** Ask the provider to cancel. Replay-safe by operation id. Answers the mandate as the server now sees it. */
  requestCancellation(scope: BillingScope, cadetId: string, operationId: string): Promise<MandateWithChild>;
  /** The provider's mandate set-up flow (bank / UPI app). Absent until a provider is connected. */
  startSetUp?: (scope: BillingScope, cadetId: string) => Promise<void>;
}

export interface BillingRepositories {
  readonly source: BillingSource;
  orders: BillingOrderRepository;
  /** Absent = no provider checkout in this build: Pay is shown, disabled and labelled. */
  checkout?: CheckoutGateway;
  /** Absent = no tax-invoice PDF yet: Download and Share are shown, disabled and labelled. */
  invoices?: InvoiceDocumentRepository;
  /** Absent = autopay not offered (G7-D11): BI-05 says so. */
  autopay?: AutopayRepository;
}
