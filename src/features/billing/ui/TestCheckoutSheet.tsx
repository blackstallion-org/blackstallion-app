import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { GlassBottomSheet, GlassButton, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { TestCheckoutGateway } from '../data/testCheckout';
import { money } from '../format';
import { BILLING_COPY as C } from '../strings';
import { Amount } from './kit';

/**
 * The labelled LOCAL TEST CHECKOUT sheet (development / test builds only, wherever a `mode: 'test'` gateway is
 * supplied). It stands in for the provider-owned checkout UI, says plainly that no money moves, and offers the three
 * outcomes a provider can return. Its result goes through the same hint-only rules as a real provider.
 */
export function TestCheckoutSheet({ gateway }: { gateway: TestCheckoutGateway }) {
  const session = useSyncExternalStore(gateway.subscribe, gateway.pending, gateway.pending);
  return (
    <GlassBottomSheet
      visible={session !== null}
      onClose={() => gateway.choose('dismiss')}
      title={C.testCheckoutTitle}
      closeLabel={C.testCheckoutClose}
      testID="test-checkout"
      actions={
        <>
          <GlassButton label={C.testCheckoutSuccess} icon="checkmark-circle-outline" onPress={() => gateway.choose('success')} testID="test-checkout-success" />
          <GlassButton variant="secondary" label={C.testCheckoutFailure} icon="close-circle-outline" onPress={() => gateway.choose('failure')} testID="test-checkout-failure" />
          <GlassButton variant="ghost" label={C.testCheckoutClose} onPress={() => gateway.choose('dismiss')} testID="test-checkout-dismiss" />
        </>
      }
    >
      <StatusNote tone="warning" message={C.testCheckoutBanner} testID="test-checkout-banner" />
      {session ? (
        <View style={styles.summary} accessible accessibilityLabel={`${money(session.amountPaise)}, ${session.reference}`}>
          <Amount paise={session.amountPaise} variant="score" hidden />
          <AppText variant="secondary" tone="muted">
            {session.reference}
          </AppText>
        </View>
      ) : null}
    </GlassBottomSheet>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.xs, paddingVertical: space.sm },
});
