import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { localeForExperience, useLanguagePreference } from '@/features/account/i18n/languagePreference';
import { cancelAllCaptures } from '@/features/capture/contract';
import { forgetDrafts } from '@/features/field/assessDrafts';
import { forgetAssessTargets } from '@/features/field/assessHandoff';
import { FieldLocaleProvider } from '@/features/field/i18n';
import { FieldOpsLocaleProvider } from '@/features/fieldOps/i18n/i18n';
import { useAccess } from '@/features/identity/AccessProvider';
import { useTheme } from '@/ui/theme/ThemeProvider';

/**
 * Field Ops experience: the tab navigator plus the screens above it (FO-02 scan and FO-04 capture as full-screen
 * modals; FO-06, FO-03, FO-07 and the other workstreams' Field screens as pushed screens). In expo-router SDK 58 a
 * route hidden from Tabs redirects to the first tab, so these live in this Stack, not in the tabs. Leaving the
 * experience (sign-out, switch) drops in-memory hand-offs, unsent drafts and open capture requests.
 */
export default function FieldLayout() {
  const { state } = useAccess();
  const { colors, reduceMotion } = useTheme();
  // SH-13 language choice (or the phone's language until one is chosen) drives every Field string catalogue (D19).
  const locale = localeForExperience('field', useLanguagePreference().effective);
  useEffect(
    () => () => {
      forgetAssessTargets();
      forgetDrafts();
      cancelAllCaptures();
    },
    [],
  );
  if (state.phase !== 'authorized' || state.experience !== 'field') return null;
  const modal = { presentation: 'fullScreenModal' as const, animation: reduceMotion ? ('fade' as const) : ('slide_from_bottom' as const), gestureEnabled: false };
  return (
    <FieldLocaleProvider locale={locale}>
      <FieldOpsLocaleProvider locale={locale}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas }, animation: reduceMotion ? 'fade' : 'default' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="session" />
          <Stack.Screen name="scan" options={modal} />
          <Stack.Screen name="capture" options={modal} />
        </Stack>
      </FieldOpsLocaleProvider>
    </FieldLocaleProvider>
  );
}
