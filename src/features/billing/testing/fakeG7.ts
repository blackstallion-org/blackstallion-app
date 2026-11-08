/**
 * TEST DOUBLE of the G7 billing functions (server/reference/g7-billing/migrations/20261104007000_mobile_g7_billing.sql)
 * behind the `rpc` surface of src/testing/fakeSupabase. Used only by jest tests (never imported by app code).
 *
 * It mirrors the SQL contract the app depends on: argument names, the `billing_order_json` shape, SQLSTATE + HINT
 * errors, payer-only reads (PT404 for anyone else), operation-id replay / reuse, the derived state precedence, and the
 * server-only entry points (attach, ingest) that the APP NEVER CALLS — tests use them to play the provider/webhook.
 * It is not the database: the authoritative checks are G7's 221 SQL tests (run.sh, R7 evidence 2026-11-05).
 */
export type FakeResult = { data: unknown; error: unknown; status: number };

type Line = { type: 'tuition' | 'kit'; fee: string; label: string; month: string | null; base: number; rateBp: number };
type Order = {
  id: string;
  reference: string;
  payer: string;
  cadet: string;
  lines: Line[];
  createdAt: number;
  expiresAt: number;
  cancelledAt?: number;
  clientReturnedAt?: number;
  clientReturnResolvedAt?: number;
  opHash: string;
  itemsHash: string;
  ledger: { status: 'PENDING' | 'FAILED' | 'PAID' | 'REFUNDED'; gatewayOrderId: string; paymentId?: string; paidAt?: number; refunded: number } | null;
  invoice?: { number: string; issuedAt: number };
  refunds: { id: string; amount: number; at: number }[];
  openCases: Set<string>;
};

export type FakeG7Options = {
  /** payer uid → children (cadet id → tier fee code, or null when no tier is set). */
  families: Record<string, Record<string, 'core_monthly' | 'elite_monthly' | null>>;
  checkoutEnabled?: boolean;
  /** G7-D03 kit channel = 'app' (the kit is sold in the app). Off by default, as in G7. */
  kitInApp?: boolean;
  now?: () => number;
};

const PRICES = { core_monthly: ['Core Cadets, monthly tuition', 850000], elite_monthly: ['Sovereign Elite, monthly tuition', 1250000] } as const;
const ok = (data: unknown): FakeResult => ({ data, error: null, status: 200 });
const fail = (code: string, hint: string, message: string): FakeResult => {
  const status = code === '42501' ? 403 : code.startsWith('PT') ? Number(code.slice(2)) : 400;
  return { data: null, error: { code, message, hint, details: null }, status };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const IST = 330 * 60_000;
const monthOf = (t: number) => {
  const d = new Date(t + IST);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function createFakeG7(opts: FakeG7Options) {
  const now = opts.now ?? Date.now;
  let checkoutEnabled = opts.checkoutEnabled ?? false;
  let uid: string | null = null;
  const orders: Order[] = [];
  const aliases = new Map<string, { hash: string; order: string }>(); // payer|op → order
  const events = new Set<string>();
  let invoiceNo = 0;
  let seq = 0;

  const stateOf = (o: Order, at = now()): string => {
    const pr = o.ledger;
    if (pr?.status === 'REFUNDED') return 'refunded';
    if (pr?.status === 'PAID' && pr.refunded > 0) return 'partially_refunded';
    if (pr?.status === 'PAID') return 'paid';
    if (o.cancelledAt !== undefined) return 'cancelled';
    if (o.clientReturnedAt !== undefined && o.clientReturnResolvedAt === undefined) return 'awaiting_confirmation';
    if (at >= o.expiresAt) return 'expired';
    if (!pr) return 'created';
    if (pr.status === 'FAILED') return 'failed';
    return 'awaiting_payment';
  };

  const json = (o: Order) => {
    const lines = o.lines.map((l, i) => {
      const gst = (l.base * l.rateBp) / 10000;
      return { lineNo: i + 1, type: l.type, feeCode: l.fee, label: l.label, month: l.month, priceVersionId: `pv-${l.fee}`, unitAmountPaise: l.base, gstRateBp: l.rateBp, basePaise: l.base, gstPaise: gst, totalPaise: l.base + gst };
    });
    const sub = lines.reduce((s, l) => s + l.basePaise, 0);
    const gst = lines.reduce((s, l) => s + l.gstPaise, 0);
    const iso = (t?: number) => (t === undefined ? null : new Date(t).toISOString());
    return {
      orderId: o.id, reference: o.reference, cadetId: o.cadet, state: stateOf(o), underReview: o.openCases.size > 0, currency: 'INR',
      subtotalPaise: sub, gstPaise: gst, totalPaise: sub + gst, createdAt: iso(o.createdAt), expiresAt: iso(o.expiresAt),
      cancelledAt: iso(o.cancelledAt), clientReturnedAt: iso(o.clientReturnedAt), gatewayOrderId: o.ledger?.gatewayOrderId ?? null,
      paidAt: iso(o.ledger?.paidAt), refundedPaise: o.ledger?.refunded ?? 0,
      invoice: o.invoice ? { number: o.invoice.number, issuedAt: iso(o.invoice.issuedAt) } : null,
      lines, refunds: o.refunds.map((r) => ({ amountPaise: r.amount, appliedAt: iso(r.at) })),
    };
  };
  const totalOf = (o: Order) => o.lines.reduce((s, l) => s + l.base + (l.base * l.rateBp) / 10000, 0);
  const signedIn = () => (uid ? null : fail('42501', 'sign_in', 'sign in first'));
  const ownChild = (cadet: unknown) => typeof cadet === 'string' && uid !== null && cadet in (opts.families[uid] ?? {});

  const price = (cadet: string, items: unknown): FakeResult | { lines: Line[]; norm: string } => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 13) return fail('PT422', 'invalid_items', 'items must be a list of 1 to 13 entries');
    const months: string[] = [];
    let kit = 0;
    for (const it of items as Record<string, unknown>[]) {
      if (it?.type === 'kit' && !('month' in it)) {
        if (!opts.kitInApp) return fail('PT422', 'kit_not_sold_in_app', 'the kit is not sold in the app');
        kit += 1;
        if (kit > 1) return fail('PT422', 'invalid_items', 'one kit per order');
        continue;
      }
      if (it?.type !== 'tuition' || typeof it.month !== 'string' || !MONTH.test(it.month)) return fail('PT422', 'invalid_items', 'bad item');
      if (months.includes(it.month)) return fail('PT422', 'invalid_items', 'a month appears twice');
      months.push(it.month);
    }
    const tier = opts.families[uid as string]?.[cadet];
    const lines: Line[] = kit ? [{ type: 'kit', fee: 'onboarding_kit', label: 'Onboarding kit (one-time)', month: null, base: 500000, rateBp: 1800 }] : [];
    for (const m of [...months].sort()) {
      const thisMonth = monthOf(now());
      if (m < thisMonth || m > next(thisMonth)) return fail('PT422', 'month_out_of_range', 'tuition cannot be paid now');
      if (!tier) return fail('PT422', 'no_plan', 'no tuition plan is set');
      const [label, base] = PRICES[tier];
      lines.push({ type: 'tuition', fee: tier, label, month: m, base, rateBp: 1800 });
    }
    return { lines, norm: JSON.stringify({ cadet, kit, items: [...months].sort() }) };
  };
  const next = (m: string) => {
    const [y, mm] = m.split('-').map(Number) as [number, number];
    return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  };

  /** Guardian-callable functions (granted to `authenticated`). */
  const rpc: Record<string, (args: Record<string, unknown>) => FakeResult> = {
    billing_checkout_status: () => ok(uid ? { enabled: checkoutEnabled, kitInApp: opts.kitInApp ?? false } : null),
    billing_quote: ({ p_cadet, p_items }) => {
      const e = signedIn();
      if (e) return e;
      if (!ownChild(p_cadet)) return fail('PT404', 'not_found', 'not found');
      const p = price(p_cadet as string, p_items);
      if ('error' in p) return p;
      const lines = p.lines.map((l, i) => {
        const gst = (l.base * l.rateBp) / 10000;
        return { lineNo: i + 1, type: l.type, feeCode: l.fee, label: l.label, month: l.month, gstRateBp: l.rateBp, basePaise: l.base, gstPaise: gst, totalPaise: l.base + gst, priceVersion: 1 };
      });
      const sub = lines.reduce((s, l) => s + l.basePaise, 0);
      const gst = lines.reduce((s, l) => s + l.gstPaise, 0);
      return ok({ cadetId: p_cadet, lines, currency: 'INR', subtotalPaise: sub, gstPaise: gst, totalPaise: sub + gst });
    },
    billing_create_order: ({ p_cadet, p_items, p_operation_id }) => {
      const e = signedIn();
      if (e) return e;
      if (typeof p_operation_id !== 'string' || !UUID.test(p_operation_id)) return fail('PT422', 'operation_id', 'operation id required');
      if (!ownChild(p_cadet)) return fail('PT404', 'not_found', 'not found');
      const opHash = JSON.stringify({ cadet: p_cadet, items: p_items });
      const alias = aliases.get(`${uid}|${p_operation_id}`);
      if (alias) {
        if (alias.hash !== opHash) return fail('PT409', 'operation_reused', 'operation id already used for a different request');
        return ok({ ...json(orders.find((o) => o.id === alias.order) as Order), replayed: true, reused: false });
      }
      if (!checkoutEnabled) return fail('PT423', 'checkout_disabled', 'online payment is not switched on');
      const p = price(p_cadet as string, p_items);
      if ('error' in p) return p;
      const months = p.lines.flatMap((l) => (l.month ? [l.month] : []));
      const hasKit = p.lines.some((l) => l.type === 'kit');
      const touching = orders.filter((o) => o.cadet === p_cadet && o.lines.some((l) => (l.month !== null && months.includes(l.month)) || (hasKit && l.type === 'kit')));
      if (touching.some((o) => ['paid', 'partially_refunded', 'awaiting_confirmation'].includes(stateOf(o)))) return fail('PT409', 'already_paid', 'already paid or being confirmed');
      const open = touching.filter((o) => ['created', 'awaiting_payment', 'failed'].includes(stateOf(o)));
      const same = open.find((o) => o.itemsHash === p.norm && o.payer === uid);
      if (same && open.length === 1) {
        aliases.set(`${uid}|${p_operation_id}`, { hash: opHash, order: same.id });
        return ok({ ...json(same), replayed: false, reused: true });
      }
      if (open.length) return fail('PT409', 'order_open', 'another open order already covers part of this request');
      seq += 1;
      const o: Order = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, reference: `BO-TEST${String(seq).padStart(5, '0')}`, payer: uid as string,
        cadet: p_cadet as string, lines: p.lines, createdAt: now(), expiresAt: now() + 2 * 3_600_000, opHash, itemsHash: p.norm, ledger: null, refunds: [], openCases: new Set(),
      };
      orders.push(o);
      aliases.set(`${uid}|${p_operation_id}`, { hash: opHash, order: o.id });
      return ok({ ...json(o), replayed: false, reused: false });
    },
    billing_get_order: ({ p_order }) => {
      const e = signedIn();
      if (e) return e;
      const o = orders.find((x) => x.id === p_order && x.payer === uid); // [M3] payer only
      return o ? ok(json(o)) : fail('PT404', 'not_found', 'not found');
    },
    billing_list_orders: ({ p_before, p_limit }) => {
      const e = signedIn();
      if (e) return e;
      const before = typeof p_before === 'string' ? Date.parse(p_before) : Number.POSITIVE_INFINITY;
      const limit = Math.min(Math.max(typeof p_limit === 'number' ? p_limit : 20, 1), 50);
      const own = orders.filter((o) => o.payer === uid && o.createdAt < before).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      return ok(own.slice(0, limit).map(json));
    },
    billing_note_client_return: ({ p_order, p_gateway_payment_id }) => {
      const e = signedIn();
      if (e) return e;
      const o = orders.find((x) => x.id === p_order && x.payer === uid);
      if (!o) return fail('PT404', 'not_found', 'not found');
      if (typeof p_gateway_payment_id !== 'string' || !/^pay_[A-Za-z0-9]{6,40}$/.test(p_gateway_payment_id)) return fail('PT422', 'invalid_payment_id', 'payment id not understood');
      const s = stateOf(o);
      if (!['awaiting_payment', 'failed', 'awaiting_confirmation', 'paid', 'partially_refunded', 'refunded'].includes(s)) return fail('PT409', 'not_in_checkout', 'this order is not in checkout');
      if (o.clientReturnedAt === undefined && (s === 'awaiting_payment' || s === 'failed')) o.clientReturnedAt = now(); // [M2] never paid
      return ok(json(o));
    },
    billing_cancel_order: ({ p_order }) => {
      const e = signedIn();
      if (e) return e;
      const o = orders.find((x) => x.id === p_order && x.payer === uid);
      if (!o) return fail('PT404', 'not_found', 'not found');
      const s = stateOf(o);
      if (!['created', 'awaiting_payment', 'failed'].includes(s)) return fail('PT409', 'cannot_cancel', `an order that is ${s} cannot be cancelled`);
      o.cancelledAt = now();
      return ok(json(o));
    },
    billing_get_invoice_pdf: ({ p_order }) => {
      const e = signedIn();
      if (e) return e;
      const o = orders.find((x) => x.id === p_order && x.payer === uid);
      if (!o) return fail('PT404', 'not_found', 'not found');
      if (!o.invoice) return fail('PT409', 'no_invoice', 'no invoice issued');
      return ok({ url: `https://example.test/invoices/${p_order}.pdf`, expires_at: new Date(now() + 120_000).toISOString() });
    },
  };

  /** Service-role side (Edge Functions / webhook route). The app never has these. */
  const service = {
    setCheckout(enabled: boolean) {
      checkoutEnabled = enabled;
    },
    attach(orderId: string, gatewayOrderId: string) {
      const o = orders.find((x) => x.id === orderId);
      if (!o) throw new Error('no order');
      o.ledger ??= { status: 'PENDING', gatewayOrderId, refunded: 0 };
    },
    /** billing_ingest_event after the webhook route verified the signature. Event ids are applied once. */
    ingest(eventId: string, type: string, gatewayOrderId: string, paymentId: string | null, amount: number | null, currency: string | null): string {
      if (events.has(eventId)) return 'duplicate';
      events.add(eventId);
      const o = orders.find((x) => x.ledger?.gatewayOrderId === gatewayOrderId);
      if (!o || !o.ledger) return 'unknown_order';
      const pr = o.ledger;
      if (type === 'payment.captured' || type === 'order.paid') {
        if (currency !== 'INR') return (o.openCases.add('currency_mismatch'), 'currency_mismatch');
        if (amount !== totalOf(o)) return (o.openCases.add('amount_mismatch'), 'amount_mismatch');
        if (pr.status === 'PAID' || pr.status === 'REFUNDED') return pr.paymentId === paymentId ? 'already_paid' : (o.openCases.add('second_payment'), 'second_payment');
        invoiceNo += 1;
        Object.assign(pr, { status: 'PAID', paymentId: paymentId ?? undefined, paidAt: now() });
        o.invoice = { number: `26-27/${String(invoiceNo).padStart(6, '0')}`, issuedAt: now() };
        if (o.clientReturnedAt !== undefined) o.clientReturnResolvedAt = now();
        return 'paid';
      }
      if (type === 'payment.failed') {
        if (pr.status !== 'PENDING') return 'ignored'; // a late failure never undoes a capture
        pr.status = 'FAILED';
        return 'failed';
      }
      return 'ignored';
    },
    orderCount: () => orders.length,
    invoiceCount: () => orders.filter((o) => o.invoice).length,
    eventCount: () => events.size,
  };

  return {
    rpc,
    service,
    signInAs(id: string | null) {
      uid = id;
    },
  };
}
