import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { dateLabel } from '@/core/format/hubTime';
import { latchOperation, type OperationLatch } from '@/features/field/domain/operation';
import { AppText } from '@/ui/components/AppText';
import { EmptyState, GlassButton, ListGroup, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { AutopayRepository, BillingRepositories, MandateWithChild } from '../data/repositories';
import { mandateView } from '../domain/autopay';
import { toBillingError } from '../domain/billingErrors';
import { dayTimeOf, money } from '../format';
import { BILLING_COPY as C, t } from '../strings';
import { useFocusRefresh } from '../ui/useFocusRefresh';
import {
  BILLING_ROUTES,
  BillingLoading,
  BillingPage,
  ConfirmDestructive,
  DetailLine,
  LoadFailure,
  StaleNote,
  useBackTo,
  useBillingResource,
  useBillingScope,
} from '../ui/kit';

/**
 * BI-05 Autopay and BI-06 Cancel autopay. G7 builds no mandates (G7-D11), so every server build has no `autopay`
 * repository and this screen says autopay isn't offered. Development fixtures render the designed states as a
 * labelled preview. The provider's lifecycle is authoritative: a cancellation shows "requested" until the bank
 * confirms, a refused change leaves the mandate unchanged, and cancelling is never presented as a refund.
 */
export function AutopayScreen() {
  const billing = useRepositories().billing;
  const back = useBackTo(BILLING_ROUTES.home);
  if (!billing) {
    return (
      <BillingPage title={C.autopayTitle} onBack={back} testID="billing-autopay">
        <UnavailableState title={C.unconnectedTitle} message={C.unconnectedMessage} testID="billing-unconnected" />
      </BillingPage>
    );
  }
  if (!billing.autopay) {
    return (
      <BillingPage title={C.autopayTitle} onBack={back} source={billing.source} testID="billing-autopay">
        <UnavailableState title={C.autopayUnavailableTitle} message={C.autopayUnavailableMessage} testID="autopay-unavailable" />
      </BillingPage>
    );
  }
  return <AutopayBody billing={billing} autopay={billing.autopay} back={back} />;
}

type Note = { tone: 'info' | 'danger'; message: string };

function AutopayBody({ billing, autopay, back }: { billing: BillingRepositories; autopay: AutopayRepository; back: () => void }) {
  const { scope, key } = useBillingScope();
  const list = useBillingResource(`${key}:autopay`, () => autopay.list(scope));
  useFocusRefresh(list.refresh);
  const [cancelling, setCancelling] = useState<MandateWithChild | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const latch = useRef<OperationLatch | null>(null);
  const offline = list.status === 'ready' && list.stale?.kind === 'network';

  const requestCancel = async () => {
    const target = cancelling;
    if (!target || list.status !== 'ready') return;
    latch.current = latchOperation(latch.current, `cancel|${target.cadetId}|${target.mandateId ?? ''}`);
    try {
      const updated = await autopay.requestCancellation(scope, target.cadetId, latch.current.operationId);
      latch.current = null;
      // Shown exactly as the server answered (normally "cancellation requested"), never as cancelled by the tap.
      list.replace(list.data.map((m) => (m.cadetId === updated.cadetId ? updated : m)));
      setNotes((n) => ({ ...n, [target.cadetId]: { tone: 'info', message: C.cancelRequested } }));
    } catch (e) {
      const err = toBillingError(e);
      if (!err.retryable) latch.current = null;
      setNotes((n) => ({ ...n, [target.cadetId]: { tone: 'danger', message: `${C.cancelFailed} ${err.message}` } }));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <BillingPage title={C.autopayTitle} onBack={back} source={billing.source} testID="billing-autopay">
      {billing.source === 'synthetic-preview' ? (
        <AppText variant="secondary" tone="muted" testID="autopay-preview">
          {C.autopayPreview}
        </AppText>
      ) : null}
      {list.status === 'loading' ? (
        <BillingLoading rows={2} testID="autopay-loading" />
      ) : list.status === 'error' ? (
        <LoadFailure error={list.error} onRetry={list.retry} testID="autopay-error" />
      ) : list.data.length === 0 ? (
        <EmptyState icon="repeat-outline" title={C.autopayEmptyTitle} message={C.autopayEmptyMessage} testID="autopay-empty" />
      ) : (
        <>
          <StaleNote error={list.stale} loadedAt={list.loadedAt} testID="autopay-stale" />
          <AppText tone="muted">{C.autopayIntro}</AppText>
          {list.data.map((m) => (
            <MandateGroup
              key={m.cadetId}
              mandate={m}
              offline={offline}
              onSetUp={autopay.startSetUp ? () => autopay.startSetUp?.(scope, m.cadetId) : undefined}
              onCancel={() => setCancelling(m)}
              note={notes[m.cadetId]}
            />
          ))}
        </>
      )}
      <ConfirmDestructive
        visible={cancelling !== null}
        title={C.cancelAutopayTitle(cancelling?.childName ?? 'your child')}
        message={C.cancelAutopayMessage}
        keepLabel={C.keepAutopay}
        confirmLabel={C.cancelAutopay}
        icon="close-circle-outline"
        onKeep={() => setCancelling(null)}
        onConfirm={requestCancel}
        testID="autopay-cancel-dialog"
      />
    </BillingPage>
  );
}

/** State → amounts/schedule/terms as flat rows in one group; Set up / Cancel sit below the group (no glass-on-glass). */
function MandateGroup({
  mandate,
  offline,
  onSetUp,
  onCancel,
  note,
}: {
  mandate: MandateWithChild;
  offline: boolean;
  onSetUp?: () => Promise<void> | undefined;
  onCancel: () => void;
  note?: Note;
}) {
  const view = mandateView(mandate);
  const canSetUpNow = onSetUp !== undefined && !offline;
  return (
    <View style={styles.block} testID={`autopay-${mandate.cadetId}`}>
      <View style={styles.head}>
        <AppText variant="section" header style={styles.flex}>
          {mandate.childName ?? 'Your child'}
        </AppText>
        <StatusBadge label={t(view.titleKey)} tone={view.tone} icon={view.waitingOnBank ? 'hourglass-outline' : undefined} testID={`autopay-${mandate.cadetId}-state`} />
      </View>
      <ListGroup>
        <View style={styles.rows}>
          <AppText tone="muted" style={styles.body}>
            {t(view.bodyKey)}
          </AppText>
          {mandate.method ? <DetailLine label={C.method} value={C.methods[mandate.method]} /> : null}
          {mandate.maxAmountPaise ? <DetailLine label={C.limit} value={money(mandate.maxAmountPaise)} /> : null}
          {mandate.nextDebit ? (
            <DetailLine label={C.nextDebit} value={`${money(mandate.nextDebit.amountPaise)} on ${dateLabel(mandate.nextDebit.onDate)}`} testID={`autopay-${mandate.cadetId}-next`} />
          ) : null}
          {mandate.state !== 'none' ? <DetailLine label={C.updated} value={dayTimeOf(mandate.updatedAt)} /> : null}
        </View>
      </ListGroup>
      {note ? <StatusNote tone={note.tone} message={note.message} testID={`autopay-${mandate.cadetId}-note`} /> : null}
      {view.canSetUp ? (
        <>
          <GlassButton
            variant="secondary"
            icon="repeat-outline"
            label={C.setUp}
            disabled={!canSetUpNow}
            onPress={onSetUp}
            accessibilityHint={canSetUpNow ? undefined : offline ? C.offlineAction : C.setUpUnavailable}
            testID={`autopay-${mandate.cadetId}-setup`}
          />
          {canSetUpNow ? null : (
            <AppText variant="caption" tone="muted">
              {offline ? C.offlineAction : C.setUpUnavailable}
            </AppText>
          )}
        </>
      ) : null}
      {view.canCancel ? (
        // Opens BI-06; the destructive styling is on the dialog's confirm (icon + explicit text on both).
        <GlassButton
          variant="ghost"
          icon="close-circle-outline"
          label={C.cancelAutopay}
          disabled={offline}
          onPress={onCancel}
          accessibilityHint={offline ? C.offlineAction : undefined}
          testID={`autopay-${mandate.cadetId}-cancel`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs },
  flex: { flex: 1 },
  rows: { paddingVertical: space.sm },
  body: { paddingBottom: space.xs },
});
