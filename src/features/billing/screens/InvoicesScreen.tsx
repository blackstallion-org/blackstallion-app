import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { EmptyState, GlassButton, ListGroup, Row, SegmentedControl, StatusNote, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { BillingRepositories, OrderPage, OrderWithChild } from '../data/repositories';
import { dayOf, itemsTitle, money, monthName, monthOfIso } from '../format';
import { BILLING_COPY as C } from '../strings';
import { useFocusRefresh } from '../ui/useFocusRefresh';
import { Amount, BILLING_ROUTES, BillingLoading, BillingPage, LoadFailure, ORDER_BADGE, OrderBadge, StaleNote, useBackTo, useBillingResource, useBillingScope } from '../ui/kit';

type Filter = 'all' | 'invoices';
const SETTLED = new Set(['paid', 'partially_refunded', 'refunded']);

/**
 * BI-02 Invoices and payments: the payer's own orders, newest first, grouped by month (`billing_list_orders`, keyset).
 * Settled rows open the invoice (BI-03); every other row opens its payment status (BI-04).
 */
export function InvoicesScreen() {
  const billing = useRepositories().billing;
  const back = useBackTo(BILLING_ROUTES.home);
  if (!billing) {
    return (
      <BillingPage title={C.invoicesTitle} onBack={back} testID="billing-invoices">
        <UnavailableState title={C.unconnectedTitle} message={C.unconnectedMessage} testID="billing-unconnected" />
      </BillingPage>
    );
  }
  return <InvoicesBody billing={billing} back={back} />;
}

function InvoicesBody({ billing, back }: { billing: BillingRepositories; back: () => void }) {
  const router = useRouter();
  const { scope, key } = useBillingScope();
  const first = useBillingResource(`${key}:orders`, () => billing.orders.listOrders(scope, null));
  useFocusRefresh(first.refresh);
  const [filter, setFilter] = useState<Filter>('all');
  const [older, setOlder] = useState<{ after: OrderPage; orders: OrderWithChild[]; next: string | null } | null>(null);
  const [olderFailed, setOlderFailed] = useState(false);

  let body;
  if (first.status === 'loading') body = <BillingLoading rows={4} testID="invoices-loading" />;
  else if (first.status === 'error') body = <LoadFailure error={first.error} onRetry={first.retry} testID="invoices-error" />;
  else {
    // Older pages belong to the first page they were loaded after; a refreshed first page starts over.
    const extra = older && older.after === first.data ? older : null;
    const all = [...first.data.orders, ...(extra?.orders ?? [])].filter((o, i, a) => a.findIndex((x) => x.orderId === o.orderId) === i);
    const next = extra ? extra.next : first.data.nextBefore;
    const shown = filter === 'invoices' ? all.filter((o) => o.invoice !== null) : all;
    const groups = groupByMonth(shown);
    const loadOlder = async () => {
      if (!next) return;
      setOlderFailed(false);
      try {
        const page = await billing.orders.listOrders(scope, next);
        setOlder({ after: first.data, orders: [...(extra?.orders ?? []), ...page.orders], next: page.nextBefore });
      } catch {
        setOlderFailed(true);
      }
    };

    body = (
      <>
        <StaleNote error={first.stale} loadedAt={first.loadedAt} testID="invoices-stale" />
        <SegmentedControl<Filter>
          label={C.filterLabel}
          segments={[
            { value: 'all', label: C.filterAll },
            { value: 'invoices', label: C.filterInvoices },
          ]}
          value={filter}
          onChange={setFilter}
          testID="invoices-filter"
        />
        {groups.length === 0 ? (
          filter === 'invoices' ? (
            <EmptyState icon="receipt-outline" title={C.noInvoicesTitle} message={C.noInvoicesMessage} testID="invoices-empty" />
          ) : (
            <EmptyState icon="receipt-outline" title={C.noRecordsTitle} message={C.noRecordsMessage} testID="invoices-empty" />
          )
        ) : (
          groups.map(([month, orders]) => (
            <ListGroup key={month} title={monthName(month)} testID={`invoices-month-${month}`}>
              {orders.map((o) => (
                <Row
                  key={o.orderId}
                  label={o.invoice ? o.invoice.number : itemsTitle(o.lines)}
                  value={[o.invoice ? itemsTitle(o.lines) : null, o.childName, dayOf(o.createdAt)].filter(Boolean).join(' · ')}
                  trailing={
                    <View style={styles.trailing} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                      <Amount paise={o.totalPaise} />
                      <OrderBadge state={o.state} />
                    </View>
                  }
                  accessibilityLabel={[o.invoice ? `Invoice ${o.invoice.number}` : null, itemsTitle(o.lines), o.childName, dayOf(o.createdAt), money(o.totalPaise), ORDER_BADGE[o.state]]
                    .filter(Boolean)
                    .join(', ')}
                  accessibilityHint={SETTLED.has(o.state) ? 'Opens the invoice' : 'Opens the payment status'}
                  onPress={() => router.push(SETTLED.has(o.state) ? BILLING_ROUTES.invoice(o.orderId) : BILLING_ROUTES.order(o.orderId))}
                  testID={`invoice-row-${o.orderId}`}
                />
              ))}
            </ListGroup>
          ))
        )}
        {olderFailed ? <StatusNote tone="warning" message={C.olderFailed} testID="invoices-older-error" /> : null}
        {next ? <GlassButton variant="secondary" icon="time-outline" label={C.showOlder} onPress={loadOlder} testID="invoices-older" /> : null}
      </>
    );
  }

  return (
    <BillingPage title={C.invoicesTitle} onBack={back} source={billing.source} testID="billing-invoices">
      {body}
    </BillingPage>
  );
}

/** Newest month first, keeping the server's newest-first order inside each month. */
function groupByMonth(orders: readonly OrderWithChild[]): [string, OrderWithChild[]][] {
  const out = new Map<string, OrderWithChild[]>();
  for (const o of orders) {
    const m = monthOfIso(o.createdAt);
    out.set(m, [...(out.get(m) ?? []), o]);
  }
  return [...out.entries()];
}

const styles = StyleSheet.create({
  trailing: { alignItems: 'flex-end', gap: space.xs, paddingVertical: space.sm },
});
