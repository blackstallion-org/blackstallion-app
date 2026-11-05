/**
 * TEST SUPPORT ONLY (not imported by the app). Renders this workstream's REAL route files and screens with the REAL
 * shell (AppProviders, RootNavigator, the authenticated layout and the floating tab bar), and stubs only the other
 * workstreams' home screens, so shared-access tests don't depend on screens being built elsewhere.
 */
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import NotFoundRoute from '@/app/+not-found';
import AuthenticatedLayout from '@/app/(authenticated)/_layout';
import FamilyProfileRoute from '@/app/(authenticated)/family/(tabs)/profile';
import FieldProfileRoute from '@/app/(authenticated)/field/(tabs)/profile';
import DeleteAccountRoute from '@/app/(authenticated)/settings/delete-account';
import HelpRoute from '@/app/(authenticated)/settings/help';
import SettingsRoute from '@/app/(authenticated)/settings/index';
import NotificationsRoute from '@/app/(authenticated)/settings/notifications';
import IndexRoute from '@/app/index';
import SignInRoute from '@/app/sign-in';
import UnavailableRoute from '@/app/unavailable';
import UpdateRequiredRoute from '@/app/update-required';
import VerifyRoute from '@/app/verify';
import type { AccessAdapter } from '@/core/auth/accessAdapter';
import { unconnectedRepositories, type Repositories } from '@/core/data/RepositoryProvider';
import { createMemoryStore, type KeyValueStore } from '@/core/preferences/keyValueStore';
import type { AccessSnapshot } from '@/features/identity/domain/access';
import { AppProviders, RootNavigator } from '@/shell/AppShell';
import { ExperienceTabs, type TabSpec } from '@/shell/ExperienceTabs';

const tabs = (home: string, extra: TabSpec[] = []): TabSpec[] => [
  { name: 'index', title: home, icon: 'home-outline' },
  ...extra,
  { name: 'profile', title: 'Profile', icon: 'person-outline' },
];

export function renderSharedApp({
  adapter,
  repositories = unconnectedRepositories,
  store = createMemoryStore(),
  initialUrl = '/',
}: {
  adapter: AccessAdapter;
  repositories?: Repositories;
  store?: KeyValueStore;
  initialUrl?: string;
}) {
  const composition = { adapter, repositories };
  return renderRouter(
    {
      _layout: () => (
        <AppProviders composition={composition} store={store}>
          <RootNavigator />
        </AppProviders>
      ),
      index: IndexRoute,
      'sign-in': SignInRoute,
      verify: VerifyRoute,
      unavailable: UnavailableRoute,
      'update-required': UpdateRequiredRoute,
      '+not-found': NotFoundRoute,
      '(authenticated)/_layout': AuthenticatedLayout,
      '(authenticated)/family/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
      '(authenticated)/family/(tabs)/_layout': () => <ExperienceTabs tabs={tabs('Home')} />,
      '(authenticated)/family/(tabs)/index': () => <Text testID="family-home-stub">Family home (stub)</Text>,
      '(authenticated)/family/(tabs)/profile': FamilyProfileRoute,
      '(authenticated)/field/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
      '(authenticated)/field/(tabs)/_layout': () => <ExperienceTabs tabs={tabs('Today', [{ name: 'sync', title: 'Sync', icon: 'sync-outline' }])} />,
      '(authenticated)/field/(tabs)/index': () => <Text testID="field-today-stub">Field today (stub)</Text>,
      '(authenticated)/field/(tabs)/profile': FieldProfileRoute,
      '(authenticated)/field/(tabs)/sync': () => <Text testID="field-sync-stub">Sync (stub)</Text>,
      '(authenticated)/settings/index': SettingsRoute,
      '(authenticated)/settings/notifications': NotificationsRoute,
      '(authenticated)/settings/help': HelpRoute,
      '(authenticated)/settings/delete-account': DeleteAccountRoute,
      '(authenticated)/settings/gallery': () => null,
    },
    { initialUrl },
  );
}

/** A controllable access adapter: tests decide the snapshot and fire session changes like onAuthStateChange. */
export function createTestAdapter(extra: Partial<AccessAdapter> = {}) {
  const state = { snapshot: { kind: 'signedOut' } as AccessSnapshot, signOuts: 0 };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const adapter: AccessAdapter = {
    name: 'test adapter',
    load: async () => state.snapshot,
    signOut: async () => {
      state.signOuts++;
      state.snapshot = { kind: 'signedOut' };
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ...extra,
  };
  return {
    adapter,
    state,
    /** What a successful provider sign-in does: new snapshot, then the session notification. */
    signInAs: (snapshot: AccessSnapshot) => {
      state.snapshot = snapshot;
      notify();
    },
    notify,
  };
}

export const authorized = (
  subjectId: string,
  displayName: string,
  allowedExperiences: ('family' | 'field')[],
  scope?: Extract<AccessSnapshot, { kind: 'authorized' }>['scope'],
  source: 'server' | 'synthetic-preview' = 'server',
): AccessSnapshot => ({ kind: 'authorized', subjectId, displayName, allowedExperiences, source, scope });
