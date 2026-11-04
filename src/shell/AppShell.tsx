import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { unconnectedAccessAdapter, type AccessAdapter } from '@/core/auth/accessAdapter';
import { RepositoryProvider, unconnectedRepositories, type Repositories } from '@/core/data/RepositoryProvider';
import { asyncStorageStore, type KeyValueStore } from '@/core/preferences/keyValueStore';
import { AccessProvider, useAccess } from '@/features/identity/AccessProvider';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

/**
 * Composition root. Development builds get the synthetic preview adapter and
 * fixtures; every other build gets the unconnected adapter (always signed out)
 * until G3 supplies real authentication. The `__DEV__ ? require(...)` form
 * lets the production bundler drop src/dev entirely.
 */
type Composition = { adapter: AccessAdapter; repositories: Repositories };

const defaultComposition = (): Composition => {
  if (__DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dev = require('@/dev/preview') as typeof import('@/dev/preview');
    return { adapter: dev.devAccessAdapter, repositories: dev.devRepositories };
  }
  return { adapter: unconnectedAccessAdapter, repositories: unconnectedRepositories };
};

export function AppProviders({
  composition,
  store = asyncStorageStore,
  children,
}: {
  composition?: Composition;
  store?: KeyValueStore;
  children: ReactNode;
}) {
  const c = useMemo(() => composition ?? defaultComposition(), [composition]);
  return (
    <SafeAreaProvider>
      <ThemeProvider store={store}>
        <AccessProvider adapter={c.adapter} store={store}>
          <RepositoryProvider value={c.repositories}>{children}</RepositoryProvider>
        </AccessProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export function RootNavigator() {
  const { ready, scheme, colors } = useTheme();
  const { state } = useAccess();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.canvas).catch(() => undefined);
  }, [colors.canvas]);

  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.ink,
        background: colors.canvas,
        card: colors.surface,
        text: colors.ink,
        border: colors.border,
        notification: colors.dangerText,
      },
    };
  }, [scheme, colors]);

  // Keep the splash screen up until the stored appearance is known, so a
  // dark-preference user never sees a white flash of themed UI.
  if (!ready) return null;

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        {/* index is the anchor: it shows the neutral boot screen while loading and redirects by state. */}
        <Stack.Screen name="index" />
        <Stack.Protected guard={state.phase === 'signedOut'}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === 'unavailable'}>
          <Stack.Screen name="unavailable" />
        </Stack.Protected>
        {/* UX guard only — server authorization (G3) controls every action. */}
        <Stack.Protected guard={state.phase === 'authorized'}>
          <Stack.Screen name="(authenticated)" />
        </Stack.Protected>
      </Stack>
    </NavigationThemeProvider>
  );
}
