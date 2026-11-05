import { Stack } from 'expo-router';

import { FamilyProvider } from '@/features/family/FamilyContext';
import { useAccess } from '@/features/identity/AccessProvider';
import { useTheme } from '@/ui/theme/ThemeProvider';

/**
 * Family experience: the tab navigator plus screens that sit ABOVE the tabs. In expo-router SDK 58 a route hidden
 * from Tabs (`href: null`) redirects to the first tab, so non-tab screens live here:
 *   spark (full-screen modal, FA-06) · sessions/[recordId] (FA-03) · passport (FA-05) · horse/stall-cam (FA-08) ·
 *   events/[eventId] (FA-10 + FA-11 dialog) · compare (FA-13) · consents (FA-12, linked from Settings).
 * billing/* (BI-01..BI-05) belongs to the billing workstream. FamilyProvider holds the selected child for all of them;
 * it is remounted per person/experience (contextKey).
 */
export default function FamilyLayout() {
  const { state, contextKey } = useAccess();
  const { colors, reduceMotion } = useTheme();
  // Never render family routes outside the family context (no cross-context flash).
  if (state.phase !== 'authorized' || state.experience !== 'family') return null;
  const push = { animation: reduceMotion ? ('fade' as const) : ('default' as const) };
  return (
    <FamilyProvider key={contextKey ?? 'family'}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="spark" options={{ presentation: 'fullScreenModal', animation: reduceMotion ? 'fade' : 'slide_from_bottom' }} />
        <Stack.Screen name="sessions/[recordId]" options={push} />
        <Stack.Screen name="passport" options={push} />
        <Stack.Screen name="horse/stall-cam" options={push} />
        <Stack.Screen name="events/[eventId]" options={push} />
        <Stack.Screen name="compare" options={push} />
        <Stack.Screen name="consents" options={push} />
        {/* BI-01..BI-05 (billing workstream) keep their own nested stack under family/billing. */}
        <Stack.Screen name="billing" options={push} />
      </Stack>
    </FamilyProvider>
  );
}
