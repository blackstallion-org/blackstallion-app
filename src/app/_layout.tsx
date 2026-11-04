import { SplashScreen } from 'expo-router';

import { AppProviders, RootNavigator } from '@/shell/AppShell';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
