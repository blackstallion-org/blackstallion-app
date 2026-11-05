/**
 * SH-03, SH-08, SH-09, SH-10, SH-11, SH-12, SH-13 behaviour on the real route files and shell (sharedRouterHarness),
 * with the synthetic account fixtures (src/dev/fixtures/account.ts) or the real account server over a fake client.
 * JS-level (jest-expo): no device, no live server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { unconnectedRepositories, type Repositories } from '@/core/data/RepositoryProvider';
import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { createAccountFixtures } from '@/dev/fixtures/account';
import { readAccountConfig } from '@/features/account/config';
import type { AccountRepositories } from '@/features/account/data/repositories';
import { createAccountServer } from '@/features/account/data/server';
import { languagePreference } from '@/features/account/i18n/languagePreference';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { installedVersion } from '@/features/identity/updateGate';
import { createFakeSupabase, pgError } from '@/testing/fakeSupabase';

import { authorized, createTestAdapter, renderSharedApp } from '../testing/sharedRouterHarness';

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' } } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/core/auth/supabaseClient', () => ({
  readBackendConfig: () => ({ url: 'http://127.0.0.1:55421', publishableKey: 'test-publishable' }),
  createConfiguredAccessAdapter: () => null,
  getConfiguredClient: () => null,
}));

const syn = (id: string, name: string, exp: ('family' | 'field')[]) => authorized(id, name, exp, undefined, 'synthetic-preview');
const INSTRUCTOR = syn('syn-instructor', 'Ravi (sample)', ['field']);
const GUARDIAN_A = syn('syn-guardian-a', 'Priya (sample)', ['family']);
const GUARDIAN_B = syn('syn-guardian-b', 'Kiran (sample)', ['family']);
const GUARDIAN_ERR = syn('syn-guardian-err', 'Neha (sample)', ['family']);
const DUAL = syn('syn-dual', 'Anil (sample)', ['family', 'field']);

const repos = (account: AccountRepositories | undefined = createAccountFixtures({ latencyMs: 0 })): Repositories => ({ ...unconnectedRepositories, account });

async function signedIn(snapshot: ReturnType<typeof syn>, opts: { account?: AccountRepositories; initialUrl?: string; store?: ReturnType<typeof createMemoryStore> } = {}) {
  const t = createTestAdapter();
  t.state.snapshot = snapshot;
  const r = await renderSharedApp({ adapter: t.adapter, repositories: repos(opts.account), store: opts.store, initialUrl: opts.initialUrl ?? '/' });
  await waitFor(() => expect(r.getPathname()).not.toBe('/'));
  return { r, t };
}
const go = async (r: { getPathname(): string }, path: string) => {
  await act(async () => router.push(path));
  await waitFor(() => expect(r.getPathname()).toBe(path.split('?')[0]));
};

afterEach(async () => {
  await languagePreference.set('en');
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('SH-13 Settings', () => {
  test('appearance and language apply at once and are persisted; Field Ops switches to Hindi', async () => {
    const store = createMemoryStore();
    const { r } = await signedIn(INSTRUCTOR, { store });
    await go(r, '/settings');
    expect(screen.getByTestId('appearance-dark')).toBeChecked(); // espresso default
    await fireEvent.press(screen.getByTestId('appearance-light'));
    await waitFor(() => expect(screen.getByTestId('appearance-light')).toBeChecked());
    expect(await store.get('bsah.pref.appearance.v1')).toBe('light');

    await fireEvent.press(screen.getByTestId('language-hi'));
    expect(await screen.findByText('सेटिंग्स')).toBeTruthy();
    expect(await AsyncStorage.getItem('bsah.pref.language.v1')).toBe('hi');
    expect(screen.getByText(/पहला ड्राफ़्ट/)).toBeTruthy(); // draft status is stated on screen
  });

  test('Family stays English in the pilot even when Hindi is chosen; guardian-only rows are shown to guardians', async () => {
    await languagePreference.set('hi');
    const { r } = await signedIn(GUARDIAN_A);
    await go(r, '/settings');
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Family screens stay in English during the pilot.')).toBeTruthy();
    expect(screen.getByTestId('open-consents')).toBeTruthy();
    expect(screen.queryByTestId('experience-options')).toBeNull();
  });

  test('Field staff get no Privacy & consents row (hidden, not disabled)', async () => {
    const { r } = await signedIn(INSTRUCTOR);
    await go(r, '/settings');
    expect(screen.queryByTestId('open-consents')).toBeNull();
    expect(screen.getByTestId('open-delete-account')).toBeTruthy();
  });
});

describe('SH-08 Notification preferences', () => {
  test('categories come from the account (family + field for a dual role); "Saved" appears only after acknowledgement', async () => {
    const { r } = await signedIn(DUAL);
    await go(r, '/settings/notifications');
    expect(await screen.findByTestId('notifications-group-family')).toBeTruthy();
    expect(screen.getByTestId('notifications-group-field')).toBeTruthy();
    expect(screen.getByTestId('notification-events-toggle-on')).toBeChecked();
    await fireEvent.press(screen.getByTestId('notification-events-toggle-off'));
    expect(await screen.findByTestId('notification-events-saved')).toBeTruthy();
    expect(screen.getByTestId('notification-events-toggle-off')).toBeChecked();
    expect(screen.getByTestId('notifications-not-live')).toHaveTextContent(/aren't being sent during the pilot/);
  });

  test('a failed save reverts with a message; retrying the same choice reuses its operation id', async () => {
    const base = createAccountFixtures({ latencyMs: 0 });
    const ops: string[] = [];
    let fail = true;
    const account: AccountRepositories = {
      ...base,
      notifications: {
        list: base.notifications.list,
        set: async (s, req) => {
          ops.push(req.operationId);
          if (fail) {
            fail = false;
            throw new FieldCommandError('network', 'offline', 'HTTP-0');
          }
          return base.notifications.set(s, req);
        },
      },
    };
    const { r } = await signedIn(GUARDIAN_A, { account });
    await go(r, '/settings/notifications');
    await fireEvent.press(await screen.findByTestId('notification-check_in-toggle-off'));
    expect(await screen.findByTestId('notification-check_in-error')).toHaveTextContent(/Not saved — check your connection/);
    expect(screen.getByTestId('notification-check_in-toggle-on')).toBeChecked(); // reverted
    await fireEvent.press(screen.getByTestId('notification-check_in-toggle-off'));
    expect(await screen.findByTestId('notification-check_in-saved')).toBeTruthy();
    expect(ops).toHaveLength(2);
    expect(ops[1]).toBe(ops[0]);
  });

  test('an account offered no categories (guardian with no linked child) gets a meaningful empty state', async () => {
    const { r } = await signedIn(GUARDIAN_B);
    await go(r, '/settings/notifications');
    expect(await screen.findByTestId('notifications-empty')).toHaveTextContent(/no notification types for your account/);
  });

  test('load error offers Retry with a reference', async () => {
    const { r } = await signedIn(GUARDIAN_ERR);
    await go(r, '/settings/notifications');
    expect(await screen.findByTestId('notifications-error')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  test('a 42501 from the server shows permission denied, never a retry loop', async () => {
    const fake = createFakeSupabase({ rpc: { app_notification_preferences: () => pgError('42501', 'no profile for this account', 403) } });
    const account = createAccountServer(fake.client, { timeoutMs: 100, config: readAccountConfig({}) });
    const { r } = await signedIn(authorized('u-x', 'X Person', ['field'], { role: 'GROOM', hubId: 'h-1', children: [], capabilities: {} }), { account });
    await go(r, '/settings/notifications');
    expect(await screen.findByTestId('notifications-denied')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  test('the OS permission is never guessed: this build says it can’t check, and offers the phone settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { r } = await signedIn(INSTRUCTOR);
    await go(r, '/settings/notifications');
    expect(await screen.findByTestId('notifications-os-unknown')).toHaveTextContent(/Can't check/);
    await fireEvent.press(screen.getByTestId('notifications-open-settings'));
    expect(open).toHaveBeenCalled();
  });
});

describe('SH-10 Delete account', () => {
  test('consequences, deliberate typed confirmation, replay-safe submit, then the received status with a reference', async () => {
    const base = createAccountFixtures({ latencyMs: 0 });
    const ops: string[] = [];
    let fail = true;
    const account: AccountRepositories = {
      ...base,
      deletion: {
        ...base.deletion,
        request: async (s, req) => {
          ops.push(req.operationId);
          if (fail) {
            fail = false;
            throw new FieldCommandError('network', 'offline', 'HTTP-0');
          }
          return base.deletion.request(s, req);
        },
      },
    };
    const { r } = await signedIn(GUARDIAN_A, { account });
    await go(r, '/settings/delete-account');
    expect(await screen.findByTestId('deletion-consequences')).toHaveTextContent(/Children's records stay/);
    expect(screen.getByTestId('deletion-submit')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('deletion-confirm'), 'delet');
    expect(screen.getByTestId('deletion-submit')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('deletion-reason'), 'Moving city');
    await fireEvent.changeText(screen.getByTestId('deletion-confirm'), 'delete');
    expect(screen.getByTestId('deletion-submit')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('deletion-submit'));
    expect(await screen.findByTestId('deletion-submit-error')).toHaveTextContent(/won't send it twice/);
    await fireEvent.press(screen.getByTestId('deletion-submit'));
    expect(await screen.findByTestId('deletion-status-requested')).toHaveTextContent(/Received/);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toBe(ops[0]);
    expect(screen.getByTestId('deletion-reference')).toHaveTextContent(/[0-9A-F]{8}/);
    expect(screen.getByTestId('deletion-sign-out')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('deletion-cancel'));
    await fireEvent.press(await screen.findByTestId('deletion-cancel-dialog-confirm'));
    expect(await screen.findByTestId('deletion-status-cancelled')).toHaveTextContent(/Cancelled/);
    expect(screen.getByTestId('deletion-new')).toBeTruthy();
  });

  test('an earlier request is shown on load (survives reinstall: it is read from the server)', async () => {
    const { r } = await signedIn(GUARDIAN_B);
    await go(r, '/settings/delete-account');
    expect(await screen.findByTestId('deletion-status-requested')).toBeTruthy();
    expect(screen.getByTestId('deletion-reference')).toHaveTextContent(/5A3E0C1D/);
  });

  test('a request that moved on (in review) cannot be cancelled: the latest status is shown, nothing guessed', async () => {
    const base = createAccountFixtures({ latencyMs: 0 });
    const inReview = { requestId: '5a3e0c1d-7b2f-4c8e-9d10-2f6a8b4c0e11', status: 'in_review' as const, reason: null, requestedAt: '2026-11-03T03:42:00Z', statusChangedAt: '2026-11-04T03:42:00Z', statusNote: null, version: 2, canCancel: false };
    let calls = 0;
    const account: AccountRepositories = {
      ...base,
      deletion: {
        ...base.deletion,
        status: async (s) => (calls++ === 0 ? base.deletion.status(s) : inReview),
        cancel: async () => {
          throw new FieldCommandError('conflict', 'the request is in_review', 'PT409');
        },
      },
    };
    const { r } = await signedIn(GUARDIAN_B, { account });
    await go(r, '/settings/delete-account');
    await fireEvent.press(await screen.findByTestId('deletion-cancel'));
    await fireEvent.press(await screen.findByTestId('deletion-cancel-dialog-confirm'));
    expect(await screen.findByTestId('deletion-status-in_review')).toBeTruthy();
    expect(screen.getByTestId('deletion-notice')).toHaveTextContent(/changed in the meantime/);
    expect(screen.queryByTestId('deletion-cancel')).toBeNull();
  });
});

describe('SH-09 Help & support', () => {
  test('the copied diagnostic text has the ID and no personal data; a safe error reference rides along', async () => {
    const Clipboard = jest.requireMock('expo-clipboard') as { setStringAsync: jest.Mock };
    const { r } = await signedIn(INSTRUCTOR);
    await go(r, '/settings/help?ref=PT404');
    expect(await screen.findByTestId('help-reference')).toHaveTextContent(/PT404/);
    const id = String(screen.getByTestId('help-diagnostic-id').props.children);
    await fireEvent.press(screen.getByTestId('help-copy'));
    expect(await screen.findByTestId('help-copied')).toBeTruthy();
    const text = Clipboard.setStringAsync.mock.calls.at(-1)?.[0] as string;
    expect(text).toContain(`Diagnostic ID: ${id}`);
    expect(text).toContain('Reference: PT404');
    expect(text).not.toMatch(/Ravi|syn-instructor|Demo Hub/);
  });

  test('a link carrying personal data as the reference is ignored; sample contacts are never dialled', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { r } = await signedIn(INSTRUCTOR);
    await go(r, '/settings/help?ref=priya@example.com');
    await screen.findByTestId('help-contact');
    expect(screen.queryByTestId('help-reference')).toBeNull();
    expect(screen.getByTestId('help-sample')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('help-call'));
    expect(openURL).not.toHaveBeenCalled();
  });

  test('with no contact configured it says so (nothing invented)', async () => {
    const base = createAccountFixtures({ latencyMs: 0 });
    const account: AccountRepositories = { ...base, support: { contact: async () => readAccountConfig({}).support, updateDestinations: async () => ({ ios: null, android: null }) } };
    const { r } = await signedIn(INSTRUCTOR, { account });
    await go(r, '/settings/help');
    expect(await screen.findByTestId('help-not-configured')).toBeTruthy();
  });
});

describe('SH-03 Account status, SH-11 Not found', () => {
  test('one reason, no identity, help and retry; retry re-runs the boot check', async () => {
    const t = createTestAdapter();
    t.state.snapshot = { kind: 'unavailable', reason: 'disabled' };
    let loads = 0;
    const load = t.adapter.load;
    t.adapter.load = async () => (loads++, load());
    const r = await renderSharedApp({ adapter: t.adapter, repositories: repos() });
    await waitFor(() => expect(r.getPathname()).toBe('/unavailable'));
    expect(screen.getByTestId('unavailable-disabled')).toHaveTextContent(/Access is paused/);
    await fireEvent.press(screen.getByTestId('unavailable-help'));
    expect(await screen.findByTestId('help-sheet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('help-sheet-close'));
    const before = loads;
    await fireEvent.press(screen.getByTestId('retry'));
    await waitFor(() => expect(loads).toBe(before + 1));
  });

  test('an unknown link signed in: neutral page, "Go to Home" lands on the current experience home', async () => {
    const { r } = await signedIn(INSTRUCTOR);
    await act(async () => router.push('/family/sessions/someone-elses-id'));
    expect(await screen.findByTestId('not-found')).toHaveTextContent(/isn't available to this account/);
    await fireEvent.press(screen.getByTestId('not-found-home'));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
  });

  test('signed out, the same page offers sign-in', async () => {
    const t = createTestAdapter();
    const r = await renderSharedApp({ adapter: t.adapter, repositories: repos(), initialUrl: '/no/such/page' });
    expect(await screen.findByTestId('not-found-home')).toHaveTextContent(/Go to sign-in/);
    await fireEvent.press(screen.getByTestId('not-found-home'));
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  });
});

describe('SH-12 Update required', () => {
  const withPolicy = (minimumVersion: string | null, links = { ios: 'https://apps.apple.com/in/app/bsah/id1', android: 'https://play.google.com/store/apps/details?id=x' }) => {
    const base = createAccountFixtures({ latencyMs: 0 });
    return {
      ...base,
      versionPolicy: { get: async () => ({ minimumVersion, source: 'server' as const }) },
      support: { ...base.support, updateDestinations: async () => links },
      pendingWork: { count: async () => 2 },
    } satisfies AccountRepositories;
  };

  test('below the minimum: blocking, unsent work counted and kept, only the configured store link', async () => {
    expect(installedVersion()).toBe('0.1.0');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { r } = await signedIn(INSTRUCTOR, { account: withPolicy('9.0.0') });
    await go(r, '/update-required');
    expect(await screen.findByTestId('update-required')).toHaveTextContent(/version of BSAH \(0.1.0\) is no longer supported/);
    expect(await screen.findByTestId('update-pending')).toHaveTextContent(/Items waiting to send: 2/);
    expect(screen.queryByTestId('header-back')).toBeNull();
    await fireEvent.press(screen.getByTestId('update-open-store'));
    expect(openURL).toHaveBeenCalledWith('https://apps.apple.com/in/app/bsah/id1');
  });

  test('no configured link: says so instead of inventing one', async () => {
    const { r } = await signedIn(INSTRUCTOR, { account: withPolicy('9.0.0', { ios: null as unknown as string, android: null as unknown as string }) });
    await go(r, '/update-required');
    expect(await screen.findByTestId('update-not-configured')).toBeTruthy();
    expect(screen.queryByTestId('update-open-store')).toBeNull();
  });

  test('a supported build reached by a stale link continues home; no policy fails open', async () => {
    const { r } = await signedIn(INSTRUCTOR, { account: withPolicy('0.0.1') });
    await go(r, '/update-required');
    await fireEvent.press(await screen.findByTestId('update-continue'));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
  });

  test('no policy published: "couldn’t check", the person may continue (fail open)', async () => {
    const base = createAccountFixtures({ latencyMs: 0 });
    const { r } = await signedIn(INSTRUCTOR, { account: { ...base, versionPolicy: undefined } });
    await go(r, '/update-required');
    expect(await screen.findByTestId('update-unknown')).toBeTruthy();
  });

  test('the development preview is labelled and only exists with ?preview=required', async () => {
    const { r } = await signedIn(INSTRUCTOR);
    await go(r, '/update-required?preview=required');
    expect(await screen.findByTestId('update-preview-banner')).toBeTruthy();
  });
});
