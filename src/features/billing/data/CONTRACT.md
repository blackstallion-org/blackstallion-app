# Billing data contract (BI-01..BI-06)

Source of truth: the G7 server draft staged at `server/reference/g7-billing/` (migration
`20261104007000_mobile_g7_billing.sql`, tests `g7_billing_tests.sql`, provider module `provider/razorpay.ts`).
**Not applied anywhere real** (D33). It was replayed on throwaway local clusters on 5 Nov 2026: R7 in
`server/live-delta/g9-app-surfaces/evidence/2026-11-05-replay-existing/merged/r7_g7_runner.txt` (221 G7 checks
passed, 0 failed; provider unit tests 13/0; mutation checks 7/7).

The client binding is `server.ts` (`createBillingServer`). `__tests__/billingServer.contract.test.ts` reads the SQL
file and fails if a function name, a parameter name, a grant or an order-JSON key used here drifts from it.

## Functions the app calls (all granted to `authenticated`; each checks its own caller)

| App method | RPC + exact arguments | Returns |
|---|---|---|
| `getCheckoutStatus` | `billing_checkout_status()` with `{}` | `{enabled, kitInApp}`; `null` when there is no signed-in user → `signedOut` |
| `getOverview` (BI-01) | `billing_checkout_status()`, `billing_list_orders({p_before: null, p_limit: 50})`, then for each child in the access snapshot whose current month is not covered: `billing_quote({p_cadet, p_items: [{type:'tuition', month:'YYYY-MM'}]})`; only when `kitInApp` (G7-D03), for each child without a paid/confirming kit: `billing_quote({p_cadet, p_items: [{type:'kit'}]})` | composed `BillingOverview` (children, other in-progress orders, `recent` = newest 3, `addOns`) |
| `listOrders` (BI-02) | `billing_list_orders({p_before: ISO \| null, p_limit: 20})` (keyset on `created_at`, newest first, server cap 50) | `OrderPage`; `nextBefore` = last `createdAt` when the page is full |
| `getOrder` (BI-03/04) | `billing_get_order({p_order})` | order JSON |
| `createOrder` (Pay) | `billing_create_order({p_cadet, p_items, p_operation_id})` | order JSON + `replayed`, `reused` |
| `cancelOrder` (BI-04) | `billing_cancel_order({p_order})` | order JSON |
| `noteClientReturn` (BI-04) | `billing_note_client_return({p_order, p_gateway_payment_id})` | order JSON |

Never sent by the app: a payer id (the server uses `auth.uid()` = `cadets.parent_id`), a price, a GST amount or a
total. `p_items` is sent in one canonical order (kit first, months ascending) because the server hashes it as sent to
recognise a replay.

**Order JSON** (`app_private.billing_order_json`): `orderId, reference, cadetId, state, underReview, currency,
subtotalPaise, gstPaise, totalPaise, createdAt, expiresAt, cancelledAt, clientReturnedAt, gatewayOrderId, paidAt,
refundedPaise, invoice {number, issuedAt} | null, lines[{lineNo, type, feeCode, label, month, priceVersionId,
unitAmountPaise, gstRateBp, basePaise, gstPaise, totalPaise}], refunds[{amountPaise, appliedAt}]`.
`domain/orders.parseBillingOrder` (on top of `paymentState.parseServerOrder`) refuses anything inconsistent: lines that
don't add up, GST that is not exact at the stated rate (the table's own constraint), an invoice on an unsettled order
or a settled order without one, non-INR, non-integer paise. A refused answer is an error state, never a payment.

**State** is derived by the server (`app_private.billing_state`, precedence refunded > partially_refunded > paid >
cancelled > awaiting_confirmation > expired > created > failed > awaiting_payment). The app displays it via
`paymentState.viewOf`; it never derives or stores one.

## Errors (SQLSTATE + HINT) → `domain/billingErrors`

| Server | Kind | Screen |
|---|---|---|
| `42501` + `sign_in`; `billing_checkout_status()` = null | `signedOut` | permission-denied state |
| `42501` other | `forbidden` | permission-denied state |
| `PT404` (also someone else's record), malformed route id (never sent) | `notFound` | "Not found" + Back to billing |
| `PT409` `already_paid` / `order_open` / `operation_reused` / `cannot_cancel` / `not_in_checkout` | `conflict` | fixed copy per hint |
| `PT422` `no_plan` / `not_enrolled` / `no_price` / `month_out_of_range` (from `billing_quote`) | `invalid` → BI-01 child "not billable yet" with the reason | |
| `PT423` `checkout_disabled` | `checkoutOff` | |
| `PT429` `rate_limited` | `rateLimited` | |
| status 0 / timeout (20 s) / 5xx | `network` (retryable with the same operation id) | offline state |
| `PGRST202` (function missing: G7 not applied on that server) | `unavailable` | "Billing isn't set up yet" |

Raw server text is never shown; unknown errors show generic copy plus a reference (SQLSTATE or `HTTP-nnn`).

## Rules the client enforces (UX only; the server enforces them again)

- **Payer only.** Billing routes exist only in the Family experience (`family/_layout` guard). Every repository call
  takes the family scope; a non-family scope is refused before any request. Route ids must be UUIDs; anything else is
  "not found" without a request. Another payer's id answers PT404 and renders the same "not found".
- **Replay-safe Pay.** BI-01 latches one operation id per pay request (`field/domain/operation.latchOperation` keyed
  by `payKey(cadet, items)`); a network failure keeps the id so the retry is a replay. `GlassButton`'s press guard drops
  taps while the request is in flight. The server answers a replay with the original order (`replayed`), reuses an
  identical open order for a new id (`reused`), and refuses a reused id with another request (PT409).
- **Client success is a hint.** `paymentState.nextAfterCheckout` can only produce `awaiting_confirmation`,
  `awaiting_payment` or `failed`; a success is reported with `billing_note_client_return`; BI-04 then polls
  `billing_get_order` on `nextPollDelay` (about 4 minutes) and afterwards asks the family to wait. "Paid" appears only
  when the server sends a settled state with an invoice.
- **Checkout amount check.** Before opening the provider sheet BI-04 refuses a session whose amount or currency differs
  from the order.
- **Webhook verification is server-side only.** The app has no webhook, signature, secret or ingest code (asserted by the
  contract test). Replays are handled by `billing_ingest_event` (event id once; refund id once) — G7 checks
  "ingest: the same event again changes nothing", "ingest: order.paid for the same payment is harmless", "ingest: a late
  failure does not undo the capture", "refund: the same refund reported again (reconciliation) counts once",
  "delayed: reconciling again changes nothing" (R7, 221/0).

## Boundaries that exist in the app but have no server yet (live actions unavailable and labelled)

| Boundary (`BillingRepositories`) | Needs | Decision | In every build today |
|---|---|---|---|
| `checkout?: CheckoutGateway` (`mode: 'provider' \| 'test'`) — `prepare(orderId)` → `{keyId, gatewayOrderId, amountPaise, currency, reference}`; `open(session)` → `CheckoutResult` | Edge Function E-1 `billing-checkout` (service role inside: `billing_create_order` as the user, `POST /v1/orders`, `billing_attach_gateway_order`), webhook W-1, reconcile cron E-2, a Razorpay test account, a checkout SDK verified on Expo SDK 58 + dev build | G7-D13 (no sandbox), G7-D14, F-05 | server build: absent → Pay disabled, "Payment provider not connected". Development fixtures: `data/testCheckout.ts`, the **local test checkout** (`mode: 'test'`): an in-app sheet labelled "Local test adapter — not a payment provider. No money moves", whose outcomes (success / failure / close) go through the same hint-only rules; no provider is contacted |
| Server switch `billing_checkout_status().enabled` | `billing_configure(true, …)` by SUPER_ADMIN after the README preconditions | **G7-D15: off for the pilot** | false → Pay disabled, "Online payment is switched off" |
| `invoices?: InvoiceDocumentRepository` — `getPdf(orderId)` → short-lived signed URL from the private `invoices` bucket, fetched fresh for every Download/Share | Tax-invoice format (GSTIN, SAC, place of supply, CGST/SGST vs IGST, entity, credit notes), PDF generation, bucket object policy | G7-D07 | absent → Download/Share disabled, labelled |
| `autopay?: AutopayRepository` — `list()`, `requestCancellation(cadetId, operationId)`, `startSetUp?()` | Mandate tables/functions (none in G7 by design), provider mandate flow, consent text, pre-debit notices, cancellation policy | G7-D11 | absent in the server build → BI-05 "Autopay isn't offered yet"; the development fixtures render a labelled design preview |
| Kit in the app | `kit_channel = 'app'` | G7-D03 | not offered (`kitInApp` false) |

Proposed shape for G7-D11 (NOT in G7, nothing calls it): `billing_list_mandates()` → `[{cadetId, mandateId, state,
method, maxAmountPaise, nextDebit {onDate, amountPaise} | null, updatedAt}]` with the states of `domain/autopay.ts`;
`billing_request_mandate_cancellation(p_cadet, p_operation_id)` → the mandate as the server now sees it
(`cancel_requested` until the provider confirms). Cancelling a mandate is never a refund.

## Client behaviour required by the 43-screen spec (Layer 7)

- **Offline.** A screen that loaded keeps its data when a background re-read fails with a network error, says
  "You're offline · showing what was loaded at …", and disables Pay, Buy, Set up and Cancel until a read succeeds
  (`ui/kit.useBillingResource` → `stale`). A first load that fails offline shows the offline state; a failed fetch is
  never shown as an empty list or zero debt.
- **BI-04 reconcile.** Re-reads on app resume (`AppState` → active), polls while `awaiting_confirmation`
  (`nextPollDelay`), bounds the checkout sheet at 15 minutes (`CHECKOUT_TIMEOUT_MS`); a timeout, a close and a
  failure are reported differently and none of them changes the server state shown.
- **Dialogs (BI-06, cancel order).** The safe choice ("Keep …") is first and is what every dismiss gesture does; the
  dialog cannot be dismissed while the request runs; the result shown is the server's answer
  (`cancel_requested`, or unchanged on refusal).

## Tax display (unsigned rules stay configurable and labelled)

GST is shown as one amount per line at the line's own `gstRateBp` (from the price version used), plus the order totals
the server stored. No CGST/SGST/IGST split, GSTIN or place of supply is shown until G7-D07 is signed (BI-03 footnote
and BI-01 footnote say so). Old invoices are never re-priced: BI-03 shows the stored lines only.

## Routes

`/family/billing` (BI-01) · `/family/billing/invoices` (BI-02) · `/family/billing/invoices/[invoiceId]` (BI-03;
the id is the billing order id, because invoice numbers `YY-YY/NNNNNN` contain a slash and no function reads by
number) · `/family/billing/orders/[orderId]` (BI-04) · `/family/billing/autopay` (BI-05; BI-06 is a dialog inside).
The registered paths `/settings/billing`, `/settings/billing/invoices`, `/settings/billing/invoices/[invoiceId]`,
`/settings/billing/orders/[orderId]`, `/settings/billing/autopay` exist as aliases (`ui/RegisterRouteAlias.tsx`) that
redirect to the Family routes; outside the Family experience they explain that billing is Family-only. The screens
live under `/family` because the Family stack already guards the experience.
