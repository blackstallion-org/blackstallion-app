/**
 * BI-05 / BI-06 autopay (UPI Autopay or e-NACH mandates). Pure TypeScript.
 *
 * G7 deliberately builds NO mandate tables or functions (migration item 9; decision G7-D11: product, consent text,
 * cancellation and pre-debit notices unsigned). This module is the client side of a FUTURE contract, so the screens can
 * be designed and tested: every server build leaves `BillingRepositories.autopay` undefined and BI-05 says so. The
 * provider's lifecycle is authoritative: the app never shows a mandate as cancelled because it asked, only
 * "cancellation requested" until the provider confirms; cancelling a mandate is never a refund.
 */
export type MandateState =
  | 'none'
  /** Set-up was started; the payer's bank or UPI app has not approved it yet. */
  | 'pending_authorisation'
  | 'active'
  | 'paused'
  /** The payer asked to cancel; the provider has not confirmed. Debits may still be scheduled. */
  | 'cancel_requested'
  | 'cancelled'
  | 'failed';

export const MANDATE_STATES: readonly MandateState[] = ['none', 'pending_authorisation', 'active', 'paused', 'cancel_requested', 'cancelled', 'failed'];

export interface Mandate {
  cadetId: string;
  /** Absent while state is 'none'. */
  mandateId: string | null;
  state: MandateState;
  method: 'upi_autopay' | 'enach' | null;
  /** The ceiling the payer approved at the bank, in paise (not the amount debited). */
  maxAmountPaise: number | null;
  /** The next debit the server has scheduled (pre-debit notice), if any. */
  nextDebit: { onDate: string; amountPaise: number } | null;
  updatedAt: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const paise = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function parseMandate(json: unknown): Mandate | null {
  if (!isObj(json) || typeof json.cadetId !== 'string' || !json.cadetId) return null;
  const state = json.state;
  if (typeof state !== 'string' || !(MANDATE_STATES as readonly string[]).includes(state)) return null;
  const mandateId = typeof json.mandateId === 'string' && json.mandateId ? json.mandateId : null;
  if ((state === 'none') !== (mandateId === null)) return null;
  const method = json.method === 'upi_autopay' || json.method === 'enach' ? json.method : null;
  if (json.method !== null && json.method !== undefined && method === null) return null;
  const maxAmountPaise = json.maxAmountPaise === null || json.maxAmountPaise === undefined ? null : paise(json.maxAmountPaise) ? json.maxAmountPaise : undefined;
  if (maxAmountPaise === undefined) return null;
  let nextDebit: Mandate['nextDebit'] = null;
  if (json.nextDebit !== null && json.nextDebit !== undefined) {
    const n = json.nextDebit;
    if (!isObj(n) || typeof n.onDate !== 'string' || !DAY.test(n.onDate) || !paise(n.amountPaise)) return null;
    // A debit can only be scheduled on a live mandate (an active one, or one whose cancellation is not confirmed yet).
    if (state !== 'active' && state !== 'cancel_requested') return null;
    nextDebit = { onDate: n.onDate, amountPaise: n.amountPaise };
  }
  if (typeof json.updatedAt !== 'string' || Number.isNaN(Date.parse(json.updatedAt))) return null;
  return { cadetId: json.cadetId, mandateId, state: state as MandateState, method, maxAmountPaise, nextDebit, updatedAt: json.updatedAt };
}

export type MandateTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface MandateView {
  tone: MandateTone;
  titleKey: string;
  bodyKey: string;
  /** Start the provider's mandate set-up (external bank / UPI app flow). */
  canSetUp: boolean;
  /** Ask to cancel (BI-06). Not while the provider is still processing a request. */
  canCancel: boolean;
  /** The bank or provider has the next step; the app only waits and re-reads. */
  waitingOnBank: boolean;
}

const VIEWS: Record<MandateState, MandateView> = {
  none: { tone: 'neutral', titleKey: 'autopay.state.none', bodyKey: 'autopay.body.none', canSetUp: true, canCancel: false, waitingOnBank: false },
  pending_authorisation: { tone: 'info', titleKey: 'autopay.state.pending', bodyKey: 'autopay.body.pending', canSetUp: false, canCancel: true, waitingOnBank: true },
  active: { tone: 'success', titleKey: 'autopay.state.active', bodyKey: 'autopay.body.active', canSetUp: false, canCancel: true, waitingOnBank: false },
  paused: { tone: 'warning', titleKey: 'autopay.state.paused', bodyKey: 'autopay.body.paused', canSetUp: false, canCancel: true, waitingOnBank: false },
  cancel_requested: { tone: 'info', titleKey: 'autopay.state.cancelRequested', bodyKey: 'autopay.body.cancelRequested', canSetUp: false, canCancel: false, waitingOnBank: true },
  cancelled: { tone: 'neutral', titleKey: 'autopay.state.cancelled', bodyKey: 'autopay.body.cancelled', canSetUp: true, canCancel: false, waitingOnBank: false },
  failed: { tone: 'danger', titleKey: 'autopay.state.failed', bodyKey: 'autopay.body.failed', canSetUp: true, canCancel: false, waitingOnBank: false },
};

export const mandateView = (m: Pick<Mandate, 'state'>): MandateView => VIEWS[m.state];

/**
 * After a cancellation request the provider decides. The only states the app may show next are the server's answer;
 * a request the server accepted shows as cancel_requested, never as cancelled.
 */
export function afterCancelRequest(before: Mandate, serverAnswer: Mandate | null): Mandate {
  if (!serverAnswer || serverAnswer.cadetId !== before.cadetId) return before; // refused or malformed: unchanged
  return serverAnswer;
}
