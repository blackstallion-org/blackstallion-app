/**
 * G7 billing answers → what the payer sees. SQLSTATEs from server/reference/g7-billing (migration header):
 * 42501 not allowed · PT404 not found (also for someone else's records) · PT409 conflict · PT422 invalid ·
 * PT423 checkout switched off · PT429 rate limit. HINT carries a machine-readable reason. Raw server text is never shown;
 * known hints map to fixed copy, anything else gets generic copy plus a reference.
 */
import { classifyCommandError } from '@/features/field/domain/commandErrors';

export type BillingErrorKind =
  | 'forbidden'
  | 'signedOut'
  | 'notFound'
  | 'conflict'
  | 'invalid'
  | 'checkoutOff'
  | 'rateLimited'
  | 'network'
  /** The billing functions do not exist on this server (G7 not applied: PostgREST PGRST202). */
  | 'unavailable'
  | 'unexpected';

export class BillingError extends Error {
  constructor(
    readonly kind: BillingErrorKind,
    message: string,
    readonly hint?: string,
    readonly reference?: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
  /** Repeating the SAME request (same operation id) is safe and may succeed. */
  get retryable(): boolean {
    return this.kind === 'network';
  }
}

const HINT_COPY: Record<string, string> = {
  checkout_disabled: 'Online payment isn’t switched on yet. Nothing was charged.',
  already_paid: 'This is already paid, or a payment for it is being confirmed. Nothing was charged.',
  order_open: 'A payment for this is already open. Continue that one from Billing instead of starting another.',
  operation_reused: 'This payment request clashed with an earlier one. Go back to Billing and start again.',
  not_in_checkout: 'This order isn’t waiting for a payment, so nothing was recorded.',
  cannot_cancel: 'This order can’t be cancelled now: a payment may already be on its way.',
  rate_limited: 'Too many payment attempts in a short time. Try again later.',
  not_enrolled: 'There is no active enrolment, so there is nothing to bill.',
  no_plan: 'The academy hasn’t set a plan for this month yet.',
  no_price: 'The academy hasn’t approved a price for this month yet.',
  month_out_of_range: 'This month can’t be paid yet.',
  kit_not_sold_in_app: 'The kit isn’t sold in the app.',
  invalid_payment_id: 'The payment provider’s answer wasn’t understood. Nothing is confirmed.',
  sign_in: 'Your session ended. Sign in again to see billing.',
  not_found: 'Not found.',
};

const GENERIC: Record<BillingErrorKind, string> = {
  forbidden: 'Only the parent who pays for a child can see or pay their billing.',
  signedOut: 'Your session ended. Sign in again to see billing.',
  notFound: 'This payment or invoice can’t be found for your account.',
  conflict: 'This clashed with another change. Reload and try again.',
  invalid: 'The academy refused this request. Nothing was charged.',
  checkoutOff: HINT_COPY.checkout_disabled as string,
  rateLimited: HINT_COPY.rate_limited as string,
  network: 'We couldn’t reach the academy. Check your connection and try again — repeating it is safe and won’t pay twice.',
  unavailable: 'Billing isn’t set up on the academy’s server yet.',
  unexpected: 'Something went wrong. Nothing is confirmed; try again.',
};

type ErrLike = { code?: unknown; message?: unknown; hint?: unknown; status?: unknown; name?: unknown };

export function toBillingError(e: unknown, status?: number): BillingError {
  if (e instanceof BillingError) return e;
  const err = (e ?? {}) as ErrLike;
  const code = typeof err.code === 'string' ? err.code : '';
  const hint = typeof err.hint === 'string' && err.hint ? err.hint : undefined;
  const reference = code ? code : typeof status === 'number' && status ? `HTTP-${status}` : undefined;
  let kind: BillingErrorKind;
  if (code === 'PT423') kind = 'checkoutOff';
  else if (code === 'PT429') kind = 'rateLimited';
  else if (code === 'PGRST202') kind = 'unavailable';
  else if (code === '42501' && hint === 'sign_in') kind = 'signedOut';
  else {
    const k = classifyCommandError(err, status);
    kind = k === 'unexpected' && status === 404 ? 'unavailable' : k;
  }
  const message = kind !== 'network' && hint && HINT_COPY[hint] ? (HINT_COPY[hint] as string) : GENERIC[kind];
  return new BillingError(kind, message, hint, reference);
}

/** The server answered, but not in a shape this app understands. Never treated as success. */
export const shapeError = (what: string) =>
  new BillingError('unexpected', 'The academy sent an answer this app doesn’t understand. Nothing is confirmed.', undefined, `SHAPE-${what}`);
