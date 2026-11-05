import { Stack } from 'expo-router';

import { SettingsScreen } from '@/features/settings/SettingsScreen';

/** SH-13 `/settings`. The screen draws its own glass header with Back, so the native header is hidden. */
export default function SettingsRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SettingsScreen />
    </>
  );
}
