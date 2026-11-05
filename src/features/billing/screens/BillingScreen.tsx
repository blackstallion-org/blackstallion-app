import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { latchOperation, type OperationLatch } from '@/features/field/domain/operation';
import { AppText } from '@/ui/components/AppText';
import { Icon } from '@/ui/components/Icon';
import { EmptyState, GlassButton, GlassSurface, ListGroup, PermissionDeniedState, Row, StatusBadge, StatusNote, UnavailableState, type StatusTone } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import type { BillingOverview, BillingRepositories, BillingScope, ChildMonth } from '../data/repositories';
import { isTestCheckout } from '../data/testCheckout';
import { toBillingError, type BillingError } from '../domain/billingErrors';
import { payGate, payKey, type PayItem } from '../domain/orders';
import { dayOf, itemsTitle, money, monthName, rateLabel } from '../format';
import { BILLING_COPY as C } from '../strings';
import { useFocusRefresh } from '../ui/useFocusRefresh';
import {
  Amount,
  AmountLine,
  BILLING_ROUTES,
  BillingLoading,
  BillingPage,
  LoadFailure,
  ORDER_BADGE,
  OrderBadge,
  StaleNote,
  useBackTo,
  useBillingResource,
  useBillingScope,
} from '../ui/kit';

/**
 * BI-01 Billing (Family → Profile → Billing, payer only). Amount due this month from the server's quote, each child's
 * plan/tax lines as flat rows, one Pay per due child, recent records, autopay and permitted add-ons.
 * Pay = `billing_create_order` with a replay-safe operation id, then BI-04. It is enabled only when the server switch
 * is on (G7-D15: off for the pilot), a checkout adapter exists, and the last read did not fail offline.
 */
export function BillingScreen() {
  const billing = useRepositories().billing;
  const back = useBackTo(BILLING_ROUTES.profile);
  if (!billing) {
    return (
      <BillingPage title={C.billing} onBack={back} testID="billing-home">
        <UnavailableState title={C.unconnectedTitle} message={C.unconnectedMessage} testID="billing-unconnected" />
      </BillingPage>
    );
  }
  return <BillingHome billing={billing} back={back} />;
}

function BillingHome({ billing, back }: { billing: BillingRepositories; back: () => void }) {
  const { scope, key } = useBillingScope();
  const overview = useBillingResource(`${key}:overview`, () => billing.orders.getOverview(scope));
  useFocusRefresh(overview.refresh);
  return (
    <BillingPage title={C.billing} onBack={back} source={billing.source} testID="billing-home">
      {overview.status === 'loading' ? (
        <BillingLoading testID="billing-loading" />
      ) : overview.status === 'error' ? (
        <LoadFailure error={overview.error} onRetry={overview.retry} />
      ) : (
        <>
          <StaleNote error={overview.stale} loadedAt={overview.loadedAt} />
          <Overview data={overview.data} billing={billing} scope={scope} offline={overview.stale !== null} />
        </>
      )}
    </BillingPage>
  );
}

/** Pay = create (or replay) the server order, then open BI-04. One operation id per pay request until it succeeds. */
function usePay(billing: BillingRepositories, scope: BillingScope) {
  const router = useRouter();
  const latch = useRef<OperationLatch | null>(null);
  const [failure, setFailure] = useState<{ cadetId: string; error: BillingError } | null>(null);
  const pay = useCallback(
    async (cadetId: string, items: PayItem[]) => {
      latch.current = latchOperation(latch.current, payKey(cadetId, items));
      setFailure(null);
      try {
        const res = await billing.orders.createOrder(scope, { cadetId, items, operationId: latch.current.operationId });
        latch.current = null;
        router.push(BILLING_ROUTES.order(res.order.orderId));
      } catch (e) {
        const error = toBillingError(e);
        if (!error.retryable) latch.current = null; // a network failure keeps the id: the retry is a replay, not a second order
        setFailure({ cadetId, error });
      }
    },
    [billing, scope, router],
  );
  return { pay, failure };
}

const CHILD_TONE: Record<ChildMonth['kind'], StatusTone> = { due: 'warning', settled: 'success', confirming: 'info', open: 'danger', blocked: 'neutral' };

function Overview({ data, billing, scope, offline }: { data: BillingOverview; billing: BillingRepositories; scope: BillingScope; offline: boolean }) {
  const router = useRouter();
  const { pay, failure } = usePay(billing, scope);
  const gate = payGate({ checkoutEnabled: data.checkout.enabled, providerConnected: billing.checkout !== undefined });
  const canPay = gate.allowed && !offline;
  const reason = offline ? C.offlineAction : gate.allowed ? null : C.payUnavailableHint(C.gate[gate.reason].title);
  const testMode = gate.allowed && isTestCheckout(billing.checkout);
  const month = monthName(data.month);

  if (data.children.length === 0 && data.otherInProgress.length === 0) {
    return (
      <>
        <EmptyState icon="people-outline" title={C.noChildrenTitle} message={C.noChildrenMessage} testID="billing-no-children" />
        <Records data={data} billing={billing} />
      </>
    );
  }
  if (data.children.length > 0 && data.children.every((c) => c.kind === 'blocked' && c.reason === 'notPayer')) {
    return <PermissionDeniedState title={C.deniedTitle} message={C.blocked.notPayer} testID="billing-not-payer" />;
  }

  const due = data.children.filter((c): c is Extract<ChildMonth, { kind: 'due' }> => c.kind === 'due');
  const total = due.reduce((s, c) => s + c.quote.totalPaise, 0); // a sum of server totals for display; nothing is priced here

  return (
    <>
      {/* Amount due: the one material plane at the top; no controls inside it. */}
      <GlassSurface material="regular" borderRadius={radius.hero} contentStyle={styles.hero} testID="billing-hero">
        {due.length > 0 ? (
          <>
            <AppText variant="secondary" tone="muted">
              {C.dueFor(month)}
            </AppText>
            <View accessible accessibilityLabel={`${C.dueFor(month)}: ${money(total)}`} testID="billing-amount-due">
              <Amount paise={total} variant="score" hidden />
            </View>
          </>
        ) : (
          <AppText variant="section" header testID="billing-nothing-due">
            {C.nothingDueFor(month)}
          </AppText>
        )}
        <AppText variant="secondary" tone="muted">
          {C.dueSummary(due.length, data.children.length)}
        </AppText>
      </GlassSurface>

      {data.children.map((child) => (
        <ChildMonthGroup
          key={child.cadetId}
          child={child}
          canPay={canPay}
          reason={reason}
          testMode={testMode}
          onPay={() => pay(child.cadetId, [{ type: 'tuition', month: child.month }])}
          failure={failure?.cadetId === child.cadetId ? failure.error : null}
          onOpen={(path) => router.push(path)}
        />
      ))}

      {data.otherInProgress.length > 0 ? (
        <ListGroup title={C.otherInProgress} testID="billing-other-in-progress">
          {data.otherInProgress.map((o) => (
            <Row
              key={o.orderId}
              label={itemsTitle(o.lines)}
              value={[o.childName, dayOf(o.createdAt)].filter(Boolean).join(' · ')}
              trailing={<OrderBadge state={o.state} />}
              accessibilityLabel={`${itemsTitle(o.lines)}, ${o.childName ?? ''}, ${money(o.totalPaise)}, ${ORDER_BADGE[o.state]}`}
              onPress={() => router.push(BILLING_ROUTES.order(o.orderId))}
              testID={`billing-order-${o.orderId}`}
            />
          ))}
        </ListGroup>
      ) : null}

      <Records data={data} billing={billing} />

      {data.addOns.length > 0 ? (
        <View style={styles.block}>
          <ListGroup title={C.addOnsTitle} testID="billing-add-ons">
            {data.addOns.map((a) => (
              <AmountLine key={a.cadetId} label={a.quote.lines[0]?.label ?? C.kitName} detail={a.name} paise={a.quote.totalPaise} />
            ))}
          </ListGroup>
          {data.addOns.map((a) => (
            <GlassButton
              key={a.cadetId}
              variant="secondary"
              icon="bag-handle-outline"
              label={C.buyAddOn(`${C.kitName} for ${a.name}`, money(a.quote.totalPaise))}
              disabled={!canPay}
              onPress={() => pay(a.cadetId, [{ type: 'kit' }])}
              accessibilityHint={reason ?? undefined}
              testID={`billing-buy-kit-${a.cadetId}`}
            />
          ))}
        </View>
      ) : null}

      <AppText variant="caption" tone="muted">
        {C.footnote}
      </AppText>
    </>
  );
}

function Records({ data, billing }: { data: BillingOverview; billing: BillingRepositories }) {
  const router = useRouter();
  const settled = new Set(['paid', 'partially_refunded', 'refunded']);
  // Orders already shown above (a child's month, other payments in progress) are not repeated here.
  const shown = new Set([...data.children.flatMap((c) => ('order' in c ? [c.order.orderId] : [])), ...data.otherInProgress.map((o) => o.orderId)]);
  const recent = data.recent.filter((o) => !shown.has(o.orderId));
  return (
    <>
      <ListGroup title={C.recent} testID="billing-recent">
        {recent.map((o) => (
          <Row
            key={o.orderId}
            label={o.invoice ? o.invoice.number : itemsTitle(o.lines)}
            value={[o.invoice ? itemsTitle(o.lines) : null, o.childName, dayOf(o.createdAt)].filter(Boolean).join(' · ')}
            trailing={<OrderBadge state={o.state} />}
            accessibilityLabel={[o.invoice ? `Invoice ${o.invoice.number}` : itemsTitle(o.lines), o.childName, money(o.totalPaise), ORDER_BADGE[o.state]].filter(Boolean).join(', ')}
            onPress={() => router.push(settled.has(o.state) ? BILLING_ROUTES.invoice(o.orderId) : BILLING_ROUTES.order(o.orderId))}
            testID={`billing-recent-${o.orderId}`}
          />
        ))}
        <Row
          icon="receipt-outline"
          label={C.allRecords}
          value={C.invoicesEntryValue(data.historyCount, data.historyHasMore)}
          onPress={() => router.push(BILLING_ROUTES.invoices)}
          testID="open-invoices"
        />
      </ListGroup>
      <ListGroup title={C.autopayEntry} testID="billing-autopay-entry">
        <Row
          icon="repeat-outline"
          label={C.autopayEntry}
          value={billing.autopay ? C.autopayEntryPreview : C.autopayEntryUnavailable}
          onPress={() => router.push(BILLING_ROUTES.autopay)}
          testID="open-autopay"
        />
      </ListGroup>
    </>
  );
}

/** One child's month: flat plan/tax rows in one glass group; the action sits below the group (no glass-on-glass). */
function ChildMonthGroup({
  child,
  canPay,
  reason,
  testMode,
  onPay,
  failure,
  onOpen,
}: {
  child: ChildMonth;
  canPay: boolean;
  reason: string | null;
  testMode: boolean;
  onPay: () => Promise<void>;
  failure: BillingError | null;
  onOpen: (path: string) => void;
}) {
  const { colors } = useTheme();
  const month = monthName(child.month);
  const badge = child.kind === 'open' ? ORDER_BADGE[child.order.state] : C.childStatus[child.kind];
  const status = <StatusBadge label={badge} tone={CHILD_TONE[child.kind]} icon={child.kind === 'confirming' ? 'hourglass-outline' : undefined} testID={`billing-child-${child.cadetId}-status`} />;
  return (
    <View style={styles.block} testID={`billing-child-${child.cadetId}`}>
      <View style={styles.groupHead}>
        <AppText variant="section" header style={styles.flex}>
          {child.name}
        </AppText>
        {status}
      </View>
      {child.kind === 'due' ? (
        <>
          <ListGroup>
            {child.quote.lines.map((l) => (
              <View key={l.lineNo} style={styles.lines}>
                <AmountLine label={l.label} detail={l.month ? monthName(l.month) : undefined} paise={l.basePaise} />
                <AmountLine label={C.lineGst(rateLabel(l.gstRateBp))} paise={l.gstPaise} />
              </View>
            ))}
            <View style={styles.lines}>
              <AmountLine label={C.total} paise={child.quote.totalPaise} strong testID={`billing-child-${child.cadetId}-total`} />
            </View>
          </ListGroup>
          <GlassButton
            label={C.pay(money(child.quote.totalPaise))}
            icon="card-outline"
            disabled={!canPay}
            onPress={onPay}
            accessibilityHint={canPay ? C.payHint : (reason ?? undefined)}
            testID={`billing-pay-${child.cadetId}`}
          />
          {reason || testMode ? (
            <View style={styles.why} testID={`billing-pay-why-${child.cadetId}`}>
              <Icon name={reason ? 'lock-closed-outline' : 'flask-outline'} size={14} color={colors.inkMuted} />
              <AppText variant="caption" tone="muted" style={styles.flex}>
                {reason ?? C.testMode}
              </AppText>
            </View>
          ) : null}
          {failure ? <StatusNote tone={failure.retryable ? 'warning' : 'danger'} message={failure.message} testID={`billing-pay-error-${child.cadetId}`} /> : null}
        </>
      ) : child.kind === 'blocked' ? (
        <ListGroup>
          <View style={styles.lines}>
            <AppText tone="muted" testID={`billing-child-${child.cadetId}-blocked`}>
              {C.blocked[child.reason]}
            </AppText>
          </View>
        </ListGroup>
      ) : (
        <ListGroup>
          <Row
            label={child.kind === 'settled' ? C.settledBody(month) : child.kind === 'confirming' ? C.confirmingBody(month) : C.openBody(month)}
            value={`${child.order.reference} · ${money(child.order.totalPaise)}`}
            accessibilityHint={child.kind === 'settled' ? C.viewInvoice : C.viewStatus}
            onPress={() => onOpen(child.kind === 'settled' ? BILLING_ROUTES.invoice(child.order.orderId) : BILLING_ROUTES.order(child.order.orderId))}
            testID={`billing-child-${child.cadetId}-open`}
          />
        </ListGroup>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space.xl, gap: space.sm },
  block: { gap: space.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs },
  flex: { flex: 1 },
  lines: { paddingVertical: space.xs },
  why: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: -space.xs },
});
