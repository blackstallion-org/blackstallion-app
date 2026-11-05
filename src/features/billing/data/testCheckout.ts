/**
 * LOCAL TEST CHECKOUT — a safe stand-in for the provider's checkout sheet (brief §1: local adapters where a production
 * provider is unavailable). No provider is contacted and no money moves: the payer chooses an outcome in an in-app
 * sheet that says so (ui/TestCheckoutSheet). Its answers go through exactly the same rules as a real provider result
 * (paymentState.nextAfterCheckout): "success" is reported to the server as a hint and can at most show "Confirming".
 *
 * `prepare` is supplied by the caller (the synthetic fixture server, or a test) and stands in for Edge Function E-1.
 */
import type { CheckoutResult } from '../domain/paymentState';
import type { BillingScope, CheckoutGateway, CheckoutSession } from './repositories';

export type TestCheckoutChoice = 'success' | 'failure' | 'dismiss';

export interface TestCheckoutGateway extends CheckoutGateway {
  readonly mode: 'test';
  /** The checkout currently waiting for a choice (null when none is open). */
  pending(): CheckoutSession | null;
  subscribe(listener: () => void): () => void;
  choose(choice: TestCheckoutChoice): void;
}

let counter = 0;
const testPaymentId = () => `pay_TEST${Date.now().toString(36).toUpperCase()}${(counter++).toString(36).toUpperCase()}`.slice(0, 40);

export function createTestCheckout(prepare: (scope: BillingScope, orderId: string) => Promise<CheckoutSession>): TestCheckoutGateway {
  let open: { session: CheckoutSession; resolve: (r: CheckoutResult) => void } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    mode: 'test',
    prepare,
    open(session) {
      open?.resolve({ kind: 'dismissed' }); // only one sheet at a time
      return new Promise<CheckoutResult>((resolve) => {
        open = { session, resolve };
        notify();
      });
    },
    pending: () => open?.session ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    choose(choice) {
      const current = open;
      if (!current) return;
      open = null;
      notify();
      current.resolve(
        choice === 'success'
          ? { kind: 'success', paymentId: testPaymentId() }
          : choice === 'failure'
            ? { kind: 'failed', reason: 'TEST_DECLINED' }
            : { kind: 'dismissed' },
      );
    },
  };
}

export const isTestCheckout = (g: CheckoutGateway | undefined): g is TestCheckoutGateway => g?.mode === 'test';
