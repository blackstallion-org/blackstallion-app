import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { GlassButton, GlassSurface, ListGroup, Row, StatusNote, UnavailableState, toneColors } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import type { BillingRepositories, BillingScope, OrderWithChild } from '../data/repositories';
import { isTestCheckout } from '../data/testCheckout';
import { BillingError, toBillingError } from '../domain/billingErrors';
import { isBillingOrderId, payGate, type CheckoutStatus } from '../domain/orders';
import { nextAfterCheckout, nextPollDelay, viewOf, type CheckoutResult, type OrderState } from '../domain/paymentState';
import { dayTimeOf, itemsTitle, money, monthName, rateLabel } from '../format';
import { BILLING_COPY as C, t } from '../strings';
import { Amount, AmountLine, BILLING_ROUTES, BillingLoading, BillingPage, ConfirmDestructive, LoadFailure, StaleNote, toneOf, useBackTo, useBillingResource, useBillingScope } from '../ui/kit';
import { TestCheckoutSheet } from '../ui/TestCheckoutSheet';

/** How long the provider's checkout may stay open before the screen treats it as timed out (not failed). */
export const CHECKOUT_TIMEOUT_MS = 15 * 60_000;

/**
 * BI-04 Order and payment status. Shows ONLY what the server derived (`billing_get_order`): the provider's checkout
 * result is a hint that is reported back (`billing_note_client_return`) and can at most produce "Confirming"; "Paid"
 * appears only when the server recorded a verified capture (webhook W-1 / reconciliation E-2, server side). While
 * confirming, the screen re-reads on the `nextPollDelay` schedule (about 4 minutes), then asks the family to wait.
 */
export function OrderStatusScreen() {
  const billing = useRepositories().billing;
  const back = useBackTo(BILLING_ROUTES.home);
  const { orderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const id = typeof orderId === 'string' ? orderId : '';
  if (!billing) {
    return (
      <BillingPage title={C.statusTitle} onBack={back} testID="billing-order">
        <UnavailableState title={C.unconnectedTitle} message={C.unconnectedMessage} testID="billing-unconnected" />
      </BillingPage>
    );
  }
  return <OrderBody billing={billing} back={back} orderId={id} />;
}

type Loaded = { order: OrderWithChild; checkout: CheckoutStatus };

function OrderBody({ billing, back, orderId }: { billing: BillingRepositories; back: () => void; orderId: string }) {
  const { scope, key } = useBillingScope();
  const res = useBillingResource<Loaded>(`${key}:order:${orderId}`, async () => {
    // A malformed id never reaches the server and reads exactly like someone else's id: not found.
    if (!isBillingOrderId(orderId)) throw new BillingError('notFound', C.notFoundMessage, 'not_found', 'CLIENT-ID');
    const [order, checkout] = await Promise.all([billing.orders.getOrder(scope, orderId), billing.orders.getCheckoutStatus(scope)]);
    return { order, checkout };
  });
  return (
    <BillingPage title={C.statusTitle} onBack={back} source={billing.source} testID="billing-order">
      {res.status === 'loading' ? (
        <BillingLoading testID="order-loading" />
      ) : res.status === 'error' ? (
        <LoadFailure error={res.error} onRetry={res.retry} testID="order-error" />
      ) : (
        <OrderStatus data={res.data} loadedAt={res.loadedAt} onOrder={(order) => res.replace({ ...res.data, order })} billing={billing} scope={scope} />
      )}
    </BillingPage>
  );
}

/** Re-reads the order while the server says awaiting_confirmation, on the paymentState schedule; never asks the provider. */
function useConfirmationPolling(
  order: OrderWithChild,
  onOrder: (o: OrderWithChild) => void,
  onReadError: (e: BillingError | null) => void,
  billing: BillingRepositories,
  scope: BillingScope,
) {
  const [attempt, setAttempt] = useState(0);
  const delay = nextPollDelay(attempt, order.state);
  // A failed read is retried on the next tick; nothing is assumed from it (the screen only says it is offline).
  const read = useEffectEvent(() =>
    billing.orders.getOrder(scope, order.orderId).then(
      (o) => {
        onReadError(null);
        onOrder(o);
      },
      (e: unknown) => onReadError(toBillingError(e)),
    ),
  );
  useEffect(() => {
    if (delay === null) return;
    let live = true;
    const timer = setTimeout(() => {
      void read().finally(() => {
        if (live) setAttempt((a) => a + 1);
      });
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [delay, attempt]);
  const checkNow = useCallback(async () => {
    try {
      onOrder(await billing.orders.getOrder(scope, order.orderId));
    } finally {
      setAttempt(0);
    }
  }, [billing, scope, order.orderId, onOrder]);
  return { polling: delay !== null, exhausted: order.state === 'awaiting_confirmation' && delay === null, checkNow };
}

type Note = { tone: 'info' | 'warning' | 'danger'; message: string };

function OrderStatus({
  data,
  loadedAt: initialLoadedAt,
  onOrder,
  billing,
  scope,
}: {
  data: Loaded;
  loadedAt: number;
  onOrder: (o: OrderWithChild) => void;
  billing: BillingRepositories;
  scope: BillingScope;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { order, checkout } = data;
  const view = viewOf(order);
  const [note, setNote] = useState<Note | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [readError, setReadError] = useState<{ error: BillingError; loadedAt: number } | null>(null);
  const loadedAt = useRef(initialLoadedAt);
  const onRead = useCallback(
    (o: OrderWithChild) => {
      loadedAt.current = Date.now();
      onOrder(o);
    },
    [onOrder],
  );
  const onReadError = useCallback((e: BillingError | null) => setReadError(e ? { error: e, loadedAt: loadedAt.current } : null), []);
  const { polling, exhausted, checkNow } = useConfirmationPolling(order, onRead, onReadError, billing, scope);
  const offline = readError?.error.kind === 'network';
  const gate = payGate({ checkoutEnabled: checkout.enabled, providerConnected: billing.checkout !== undefined });
  const reason = offline ? C.offlineAction : gate.allowed ? null : C.payUnavailableHint(C.gate[gate.reason].title);
  const testGateway = isTestCheckout(billing.checkout) ? billing.checkout : null;

  const reread = useCallback(async () => {
    try {
      const o = await billing.orders.getOrder(scope, order.orderId);
      onReadError(null);
      onRead(o);
    } catch (e) {
      onReadError(toBillingError(e)); // keep the server state already on screen, marked stale
    }
  }, [billing, scope, order.orderId, onRead, onReadError]);

  // Reconcile when the app comes back to the foreground (e.g. after a provider app or bank page).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reread();
    });
    return () => sub.remove();
  }, [reread]);

  const pay = async () => {
    const gateway = billing.checkout;
    if (!gateway || !gate.allowed || offline) return;
    setNote(null);
    let session;
    try {
      session = await gateway.prepare(scope, order.orderId); // E-1: server-created provider order, server amount
    } catch (e) {
      setNote({ tone: 'danger', message: toBillingError(e).message });
      return;
    }
    if (session.amountPaise !== order.totalPaise || session.currency !== 'INR') {
      setNote({ tone: 'danger', message: C.amountMismatch }); // never open checkout for an amount the order doesn't state
      return;
    }
    let result: CheckoutResult | 'timeout';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bounded: a sheet that never answers is a timeout, which is NOT a payment failure (money may have moved).
      result = await Promise.race([
        gateway.open(session),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), CHECKOUT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      result = { kind: 'failed' };
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (result === 'timeout') {
      setNote({ tone: 'warning', message: C.checkoutTimedOut });
      await reread();
      return;
    }
    const next = nextAfterCheckout(result);
    if (next.report) {
      try {
        onOrder(await billing.orders.noteClientReturn(scope, order.orderId, next.report.paymentId));
      } catch {
        setNote({ tone: 'warning', message: C.returnNotRecorded });
        await reread();
      }
      return;
    }
    setNote(next.provisional === 'failed' ? { tone: 'danger', message: C.checkoutFailedNote } : { tone: 'info', message: C.checkoutDismissedNote });
    await reread(); // the screen shows the server's state, whatever the sheet said
  };

  const cancel = async () => {
    try {
      onRead(await billing.orders.cancelOrder(scope, order.orderId));
      setNote(null);
    } catch (e) {
      setNote({ tone: 'danger', message: toBillingError(e).message });
      await reread();
    } finally {
      setConfirmCancel(false);
    }
  };

  const tone = toneColors(toneOf(view.tone), colors);
  const icon = STATE_ICON[order.state];
  return (
    <>
      <GlassSurface material="regular" borderRadius={radius.hero} contentStyle={styles.hero} testID="order-hero">
        <View style={styles.heroHead}>
          <View style={[styles.disc, { backgroundColor: tone.bg }]}>
            <Icon name={icon} size={26} color={tone.fg} />
          </View>
          <View style={styles.flex}>
            <AppText variant="section" header testID="order-state-title" accessibilityRole="header">
              {t(view.titleKey)}
            </AppText>
          </View>
        </View>
        <AppText tone="muted" testID="order-state-body">
          {t(view.bodyKey)}
        </AppText>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />
        <AppText variant="secondary" tone="muted">
          {C.amount}
        </AppText>
        <View accessible accessibilityLabel={`${C.amount}: ${money(order.totalPaise)}`} testID="order-amount">
          <Amount paise={order.totalPaise} variant="score" hidden />
        </View>
        <AppText variant="secondary" tone="muted">
          {[itemsTitle(order.lines), order.childName, order.reference].filter(Boolean).join(' · ')}
        </AppText>
      </GlassSurface>

      {readError ? <StaleNote error={readError.error} loadedAt={readError.loadedAt} testID="order-stale" /> : null}
      {view.reviewNoteKey ? <StatusNote tone="info" title="Under review" message={t(view.reviewNoteKey)} testID="order-under-review" /> : null}
      {note ? <StatusNote tone={note.tone} message={note.message} testID="order-note" /> : null}
      {polling ? <StatusNote tone="info" message={C.checking} testID="order-polling" /> : null}
      {exhausted ? <StatusNote tone="warning" message={C.stillConfirming} testID="order-still-confirming" /> : null}

      <View style={styles.actions}>
        {order.state === 'failed' ? (
          <AppText variant="secondary" tone="muted" testID="order-retry-rule">
            {C.retryRules.failed}
          </AppText>
        ) : null}
        {view.canPay ? (
          <>
            <GlassButton
              label={C.pay(money(order.totalPaise))}
              icon="card-outline"
              disabled={reason !== null}
              onPress={pay}
              accessibilityHint={reason ?? undefined}
              testID="order-pay"
            />
            {reason || testGateway ? (
              <View style={styles.why} testID="order-gate">
                <Icon name={reason ? 'lock-closed-outline' : 'flask-outline'} size={14} color={colors.inkMuted} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  {reason ?? C.testMode}
                </AppText>
              </View>
            ) : null}
          </>
        ) : null}
        {view.showInvoice ? (
          <GlassButton variant="secondary" icon="receipt-outline" label={C.viewInvoice} onPress={() => router.push(BILLING_ROUTES.invoice(order.orderId))} testID="order-view-invoice" />
        ) : null}
        {exhausted ? <GlassButton variant="secondary" icon="refresh" label={C.checkAgain} onPress={checkNow} testID="order-check-again" /> : null}
        {order.state === 'cancelled' || order.state === 'expired' ? (
          <>
            <AppText variant="secondary" tone="muted">
              {C.retryRules[order.state]}
            </AppText>
            <GlassButton variant="secondary" icon="arrow-back" label={C.startAgain} onPress={() => router.dismissTo(BILLING_ROUTES.home)} testID="order-start-again" />
          </>
        ) : null}
        {view.canCancel ? (
          // Quiet secondary action; the destructive styling is on the dialog's confirm (icon + explicit text).
          <GlassButton variant="ghost" icon="close-circle-outline" label={C.cancelOrder} disabled={offline} onPress={() => setConfirmCancel(true)} testID="order-cancel" />
        ) : null}
      </View>

      <ListGroup title={C.recorded} testID="order-timeline">
        {timeline(order).map((s) => (
          <Row key={s.label} icon={s.icon} label={s.label} value={s.at ? dayTimeOf(s.at) : undefined} />
        ))}
      </ListGroup>

      <ListGroup title={C.items} testID="order-items">
        {order.lines.map((l) => (
          <View key={l.lineNo} style={styles.line}>
            <AmountLine label={l.label} detail={l.month ? monthName(l.month) : undefined} paise={l.basePaise} />
            <AmountLine label={C.lineGst(rateLabel(l.gstRateBp))} paise={l.gstPaise} />
          </View>
        ))}
        <View style={styles.line}>
          <AmountLine label={C.total} paise={order.totalPaise} strong />
        </View>
      </ListGroup>

      <AppText variant="caption" tone="muted">
        {C.onlyServerConfirms}
      </AppText>

      <ConfirmDestructive
        visible={confirmCancel}
        title={C.cancelOrderTitle}
        message={C.cancelOrderMessage}
        keepLabel={C.keepOrder}
        confirmLabel={C.cancelOrder}
        icon="close-circle-outline"
        onKeep={() => setConfirmCancel(false)}
        onConfirm={cancel}
        testID="order-cancel-dialog"
      />
      {testGateway ? <TestCheckoutSheet gateway={testGateway} /> : null}
    </>
  );
}

const STATE_ICON: Record<OrderState, IconName> = {
  created: 'card-outline',
  awaiting_payment: 'card-outline',
  failed: 'close-circle-outline',
  awaiting_confirmation: 'hourglass-outline',
  paid: 'checkmark-circle-outline',
  partially_refunded: 'return-down-back-outline',
  refunded: 'return-down-back-outline',
  cancelled: 'remove-circle-outline',
  expired: 'time-outline',
};

/** Only events the server recorded, with the server's timestamps. */
function timeline(o: OrderWithChild): { label: string; icon: IconName; at: string | null }[] {
  const steps: { label: string; icon: IconName; at: string | null }[] = [{ label: C.stepCreated, icon: 'document-text-outline', at: o.createdAt }];
  if (o.clientReturnedAt) steps.push({ label: C.stepReturned, icon: 'phone-portrait-outline', at: o.clientReturnedAt });
  if (o.state === 'paid' || o.state === 'partially_refunded' || o.state === 'refunded') steps.push({ label: C.stepConfirmed, icon: 'shield-checkmark-outline', at: o.paidAt });
  else if (o.state === 'awaiting_confirmation') steps.push({ label: C.stepWaiting, icon: 'hourglass-outline', at: null });
  else if (o.state === 'failed') steps.push({ label: C.stepFailed, icon: 'close-circle-outline', at: null });
  else if (o.state === 'cancelled') steps.push({ label: C.stepCancelled, icon: 'remove-circle-outline', at: o.cancelledAt });
  else if (o.state === 'expired') steps.push({ label: C.stepExpired, icon: 'time-outline', at: o.expiresAt });
  for (const r of o.refunds) steps.push({ label: C.stepRefund(money(r.amountPaise)), icon: 'return-down-back-outline', at: r.appliedAt });
  return steps;
}

const styles = StyleSheet.create({
  hero: { padding: space.xl, gap: space.sm },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  disc: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  actions: { gap: space.sm },
  why: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: -space.xs },
  line: { paddingVertical: space.xs },
});
