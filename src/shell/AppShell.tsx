import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider as NavigationThemeProvider, usePathname } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { unconnectedAccessAdapter, type AccessAdapter } from '@/core/auth/accessAdapter';
import { createConfiguredAccessAdapter, getConfiguredClient } from '@/core/auth/supabaseClient';
import { RepositoryProvider, unconnectedRepositories, type Repositories } from '@/core/data/RepositoryProvider';
import { asyncStorageStore, type KeyValueStore } from '@/core/preferences/keyValueStore';
import { AccessProvider, useAccess } from '@/features/identity/AccessProvider';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

import { rememberResume } from './resumeLink';
import { createServerRepositories } from './serverRepositories';

/**
 * Composition root. A configured backend → the Supabase adapter (G3). No backend: development builds get the
 * synthetic preview adapter and fixtures, every other build the unconnected adapter (always signed out). The
 * `__DEV__ ? require(...)` form lets the production bundler drop src/dev entirely.
 */
type Composition = { adapter: AccessAdapter; repositories: Repositories };

const defaultComposition = (): Composition => {
  // G3: a build with a backend configured (EXPO_PUBLIC_SUPABASE_URL + publishable key) always uses the real
  // adapter, in development too, so synthetic personas never run against a real backend. Repositories use the
  // same client, so every read and command carries the signed-in session (first workflow slice, G4).
  const real = createConfiguredAccessAdapter();
  if (real) {
    const client = getConfiguredClient();
    return { adapter: real, repositories: client ? createServerRepositories(client) : unconnectedRepositories };
  }
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
  const pathname = usePathname();
  const url = Linking.useURL();

  // A deep link that ARRIVES while nobody is authorized (cold start, or opened from the sign-in screen) is remembered
  // once and resumed by the boot gate. Values already seen while someone was signed in (the route they were on, the
  // link that opened the app earlier) are never re-armed for the next person.
  const seen = useRef<{ url: string | null; pathname: string | null }>({ url: null, pathname: null });
  useEffect(() => {
    const last = seen.current;
    seen.current = { url, pathname };
    if (state.phase === 'authorized' || state.phase === 'unavailable') return;
    if (pathname !== last.pathname) rememberResume(pathname);
    if (url && url !== last.url) {
      try {
        const u = Linking.parse(url);
        const path = /^https?$/.test(u.scheme ?? '') ? u.path : [u.hostname, u.path].filter(Boolean).join('/');
        rememberResume(path ? `/${path}` : null);
      } catch {
        // not a URL this app understands: nothing to resume
      }
    }
  }, [state.phase, pathname, url]);

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
