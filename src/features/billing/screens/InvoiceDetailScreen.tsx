import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { AppText } from '@/ui/components/AppText';
import { EmptyState, GlassButton, GlassSurface, ListGroup, Row, StatusNote, UnavailableState } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import type { BillingRepositories, BillingScope, OrderWithChild } from '../data/repositories';
import { BillingError, toBillingError } from '../domain/billingErrors';
import { isBillingOrderId } from '../domain/orders';
import { dayOf, dayTimeOf, itemsTitle, money, monthName, rateLabel } from '../format';
import { BILLING_COPY as C } from '../strings';
import { Amount, AmountLine, BILLING_ROUTES, BillingLoading, BillingPage, LoadFailure, OrderBadge, useBackTo, useBillingResource, useBillingScope } from '../ui/kit';

/**
 * BI-03 Invoice detail. The invoice of one settled order, exactly as the server recorded it (old invoices are never
 * re-priced). The route id is the billing order id: invoice numbers contain a slash and no function reads by number.
 * PDF and Share are the boundary to a tax-invoice PDF that doesn't exist yet (G7-D07): shown, disabled and explained.
 */
export function InvoiceDetailScreen() {
  const billing = useRepositories().billing;
  const back = useBackTo(BILLING_ROUTES.invoices);
  const { invoiceId } = useLocalSearchParams<{ invoiceId?: string | string[] }>();
  const id = typeof invoiceId === 'string' ? invoiceId : '';
  if (!billing) {
    return (
      <BillingPage title={C.invoiceTitle} onBack={back} testID="billing-invoice">
        <UnavailableState title={C.unconnectedTitle} message={C.unconnectedMessage} testID="billing-unconnected" />
      </BillingPage>
    );
  }
  return <InvoiceBody billing={billing} back={back} orderId={id} />;
}

function InvoiceBody({ billing, back, orderId }: { billing: BillingRepositories; back: () => void; orderId: string }) {
  const { scope, key } = useBillingScope();
  const payer = useAuthorizedAccess().state.session.displayName;
  // A malformed id never reaches the server and reads exactly like someone else's id: not found.
  const order = useBillingResource(`${key}:order:${orderId}`, () =>
    isBillingOrderId(orderId) ? billing.orders.getOrder(scope, orderId) : Promise.reject(new BillingError('notFound', C.notFoundMessage, 'not_found', 'CLIENT-ID')),
  );
  return (
    <BillingPage title={C.invoiceTitle} onBack={back} source={billing.source} testID="billing-invoice">
      {order.status === 'loading' ? (
        <BillingLoading testID="invoice-loading" />
      ) : order.status === 'error' ? (
        <LoadFailure error={order.error} onRetry={order.retry} testID="invoice-error" />
      ) : (
        <Invoice order={order.data} billing={billing} scope={scope} payer={payer} />
      )}
    </BillingPage>
  );
}

function Invoice({ order, billing, scope, payer }: { order: OrderWithChild; billing: BillingRepositories; scope: BillingScope; payer: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [pdfError, setPdfError] = useState<string | null>(null);
  if (!order.invoice) {
    return (
      <EmptyState
        icon="document-text-outline"
        title={C.noInvoiceTitle}
        message={C.noInvoiceMessage}
        action={{ label: C.viewStatus, icon: 'arrow-forward', onPress: () => router.replace(BILLING_ROUTES.order(order.orderId)) }}
        testID="invoice-none"
      />
    );
  }
  const refunded = order.refundedPaise;
  const documents = billing.invoices;
  const pdfReady = documents !== undefined;
  /** A fresh short-lived signed URL for every action: an expired link is never reused (BI-03 "PDF expired → refetch"). */
  const withPdf = (act: (url: string) => Promise<unknown>) => async () => {
    if (!documents) return;
    setPdfError(null);
    try {
      const { url } = await documents.getPdf(scope, order.orderId);
      await act(url);
    } catch (e) {
      setPdfError(toBillingError(e).message);
    }
  };
  return (
    <>
      <GlassSurface material="regular" borderRadius={radius.hero} contentStyle={styles.hero} testID="invoice-hero">
        <View style={styles.heroHead}>
          <View style={styles.flex}>
            <AppText variant="secondary" tone="muted">
              {C.invoiceNumber}
            </AppText>
            <AppText variant="section" header selectable testID="invoice-number">
              {order.invoice.number}
            </AppText>
          </View>
          <OrderBadge state={order.state} testID="invoice-state" />
        </View>
        <View accessible accessibilityLabel={`${C.total}: ${money(order.totalPaise)}`} testID="invoice-total">
          <Amount paise={order.totalPaise} variant="score" hidden />
        </View>
        <AppText variant="secondary" tone="muted">
          {[itemsTitle(order.lines), order.childName, C.issued(dayOf(order.invoice.issuedAt))].filter(Boolean).join(' · ')}
        </AppText>
      </GlassSurface>

      <ListGroup title={C.items} testID="invoice-items">
        {order.lines.map((l) => (
          <View key={l.lineNo} style={styles.line}>
            <AmountLine label={l.label} detail={l.month ? monthName(l.month) : undefined} paise={l.basePaise} />
            <AmountLine label={C.lineGst(rateLabel(l.gstRateBp))} paise={l.gstPaise} />
          </View>
        ))}
      </ListGroup>

      <ListGroup title={C.totals} testID="invoice-totals">
        <View style={styles.line}>
          <AmountLine label={C.subtotal} paise={order.subtotalPaise} />
          <AmountLine label={C.gst} paise={order.gstPaise} />
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
          <AmountLine label={C.total} paise={order.totalPaise} strong />
          {order.refunds.map((r, i) => (
            <AmountLine key={i} label={C.refunded} detail={C.refundedOn(dayOf(r.appliedAt))} paise={r.amountPaise} prefix="− " />
          ))}
          {refunded > 0 ? <AmountLine label={C.netPaid} paise={order.totalPaise - refunded} strong testID="invoice-net" /> : null}
        </View>
      </ListGroup>

      <ListGroup title={C.payment} testID="invoice-payment">
        <Row icon="person-circle-outline" label={C.billedTo} value={payer} testID="invoice-payer" />
        {order.childName ? <Row icon="person-outline" label={C.paymentFor} value={order.childName} /> : null}
        <Row icon="pricetag-outline" label={C.paymentReference} value={order.reference} />
        {order.paidAt ? <Row icon="checkmark-done-outline" label={C.paidOn} value={dayTimeOf(order.paidAt)} /> : null}
      </ListGroup>

      <AppText variant="caption" tone="muted">
        {C.taxNote}
      </AppText>

      {pdfReady ? null : <StatusNote tone="info" title={C.pdfUnavailableTitle} message={C.pdfUnavailable} testID="invoice-pdf-unavailable" />}
      {pdfError ? <StatusNote tone="danger" message={pdfError} testID="invoice-pdf-error" /> : null}
      <View style={styles.actions}>
        <GlassButton
          variant="secondary"
          icon="download-outline"
          label={C.downloadPdf}
          disabled={!pdfReady}
          onPress={withPdf((url) => Linking.openURL(url))}
          accessibilityHint={pdfReady ? undefined : C.pdfUnavailableTitle}
          testID="invoice-download"
        />
        <GlassButton
          variant="secondary"
          icon="share-outline"
          label={C.share}
          disabled={!pdfReady}
          onPress={withPdf((url) => Share.share({ url, message: url, title: order.invoice?.number }))}
          accessibilityHint={pdfReady ? undefined : C.pdfUnavailableTitle}
          testID="invoice-share"
        />
      </View>
      <GlassButton variant="ghost" icon="pulse-outline" label={C.viewStatus} onPress={() => router.push(BILLING_ROUTES.order(order.orderId))} testID="invoice-open-status" />
    </>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space.xl, gap: space.sm },
  heroHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1 },
  line: { paddingVertical: space.xs },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  actions: { gap: space.sm },
});
