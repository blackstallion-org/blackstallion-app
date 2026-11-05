import { Stack } from 'expo-router';

import { useTheme } from '@/ui/theme/ThemeProvider';

/**
 * Billing (BI-01..BI-05), above the Family tabs: reached from Family → Profile → Billing. The Family layout already
 * renders nothing outside the authorized Family experience; these guards are UX only, the server answers PT404 for
 * anyone who is not the payer. BI-06 is a dialog inside BI-05, not a route.
 */
export default function BillingLayout() {
  const { colors, reduceMotion } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas }, animation: reduceMotion ? 'fade' : 'default' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="invoices/index" />
      <Stack.Screen name="invoices/[invoiceId]" />
      <Stack.Screen name="orders/[orderId]" />
      <Stack.Screen name="autopay" />
    </Stack>
  );
}
