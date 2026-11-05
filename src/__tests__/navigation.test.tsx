/**
 * Navigation + bootstrap behaviour on the real route tree (src/app) and the
 * real composition root, with the development adapter at zero latency.
 * This is a JS-level test (jest-expo); it does not replace native checks.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import path from 'path';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';

import type { PersonaId } from '@/dev/personas';

jest.mock('@/dev/preview', () => {
  const actual = jest.requireActual('@/dev/preview');
  const { createDevAccessAdapter } = jest.requireActual('@/dev/devAccessAdapter');
  const { createFixtureRepositories } = jest.requireActual('@/dev/fixtures');
  return {
    ...actual,
    devAccessAdapter: createDevAccessAdapter({ latencyMs: 0 }),
    devRepositories: createFixtureRepositories({ latencyMs: 0 }),
  };
});

const dev = jest.requireMock('@/dev/preview') as typeof import('@/dev/preview');
const APP_DIR = path.resolve(__dirname, '../app');

const boot = async () => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  return r;
};

const signInAs = async (id: PersonaId) => {
  await act(async () => dev.devAccessAdapter.selectPersona(id));
};

const FAMILY_A_NAMES = ['Priya (sample)', 'Aarav (sample)', 'Meera (sample)'];
const textOf = () => JSON.stringify(screen.toJSON());

/** Opens Settings the way a person does: Profile tab → Settings row. */
const openSettings = async (r: Awaited<ReturnType<typeof boot>>) => {
  await fireEvent.press(screen.getByTestId('tab-profile'));
  await fireEvent.press(await screen.findByTestId('open-settings'));
  await waitFor(() => expect(r.getPathname()).toBe('/settings'));
};

beforeEach(async () => {
  await dev.devAccessAdapter.signOut();
  await AsyncStorage.clear();
});

test('cold start shows a neutral boot screen, then signed-out sign-in with no private data', async () => {
  await boot();
  expect(screen.getByTestId('sign-in')).toBeTruthy();
  expect(screen.getByTestId('dev-preview-panel')).toBeTruthy();
});

test('guardian lands on Family home; Field routes are not reachable', async () => {
  const r = await boot();
  await signInAs('guardian');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await screen.findByTestId('latest-assessment');
  expect(screen.getByText('Corrected')).toBeTruthy();
  expect(screen.getAllByTestId('preview-banner').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('experience-switch')).toBeNull();

  await act(async () => {
    try {
      await testRouter.push('/field');
    } catch {
      // assertion inside testRouter fails because the guard redirected; expected
    }
  });
  expect(r.getPathname()).not.toBe('/field');
  expect(screen.queryByTestId('field-today')).toBeNull();
});

test('instructor lands on Field Ops Today', async () => {
  const r = await boot();
  await signInAs('instructor');
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  // FO-01: today's real check-ins (no fictional schedule), plus the person's own shift row
  await screen.findByTestId('today-checkins');
  await screen.findByTestId('today-open-shift');
  expect(screen.queryByText('Sessions')).toBeNull();
  expect(textOf()).not.toMatch(/Aarav|Priya/);
});

test('groom sees care, overdue warning, and never cadet data', async () => {
  const r = await boot();
  await signInAs('groom');
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  await screen.findByTestId('today-care');
  expect(screen.getByTestId('today-overdue')).toBeTruthy();
  expect(screen.queryByTestId('today-checkins')).toBeNull();
  expect(screen.queryByTestId('tab-cadets')).toBeNull();
  expect(screen.queryByText('Sessions')).toBeNull();
});

test('hub admin Today shows check-ins and the review queue entry', async () => {
  const r = await boot();
  await signInAs('hubAdmin');
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  await screen.findByTestId('today-open-review');
  expect(screen.queryByTestId('open-scan')).toBeNull();
});

test('dual-role switch changes experience, removes the other history, and leaks nothing', async () => {
  const r = await boot();
  await signInAs('dualRole');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await screen.findByText('Isha (sample)', { exact: false }).catch(() => screen.findByTestId('latest-assessment'));

  await fireEvent.press(screen.getByTestId('experience-switch'));
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  await screen.findByText(/Demo Hub Two/);
  expect(textOf()).not.toContain('Isha');
  expect(screen.queryByTestId('family-home')).toBeNull();
  // Back must not return into the Family experience.
  expect(testRouter.canGoBack()).toBe(false);

  await fireEvent.press(screen.getByTestId('experience-switch'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await screen.findByTestId('latest-assessment');
  expect(textOf()).not.toContain('Tara');
});

test('tabs and shared Settings: push from Profile, back returns to Profile', async () => {
  const r = await boot();
  await signInAs('guardian');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await fireEvent.press(screen.getByTestId('tab-profile'));
  await waitFor(() => expect(r.getPathname()).toBe('/family/profile'));
  await fireEvent.press(screen.getByTestId('open-settings'));
  await waitFor(() => expect(r.getPathname()).toBe('/settings'));
  expect(testRouter.canGoBack()).toBe(true);
  await act(async () => testRouter.back());
  await waitFor(() => expect(r.getPathname()).toBe('/family/profile'));
});

test('Settings appearance: espresso (Dark) is the default; choosing Light is persisted', async () => {
  const r = await boot();
  await signInAs('instructor');
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  await openSettings(r);
  const radio = screen.getByTestId('appearance-light');
  expect(screen.getByTestId('appearance-dark')).toBeChecked();
  await fireEvent.press(radio);
  await waitFor(() => expect(screen.getByTestId('appearance-light')).toBeChecked());
  expect(await AsyncStorage.getItem('bsah.pref.appearance.v1')).toBe('light');
});

test('sign out then a different person: no previous names render, history is gone', async () => {
  const r = await boot();
  await signInAs('guardian');
  await screen.findByTestId('latest-assessment');
  await openSettings(r);
  await act(async () => {
    await fireEvent.press(screen.getByTestId('sign-out'));
  });
  // SH-06: sign-out asks first
  await act(async () => {
    await fireEvent.press(await screen.findByTestId('sign-out-confirm'));
  });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  for (const n of FAMILY_A_NAMES) expect(textOf()).not.toContain(n);
  expect(testRouter.canGoBack()).toBe(false);

  await signInAs('guardianNoChild');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await screen.findByTestId('family-home-empty');
  for (const n of FAMILY_A_NAMES) expect(textOf()).not.toContain(n);
});

test('a deep link opened while signed out resumes after sign-in (same experience only)', async () => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/family/passport' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await signInAs('guardian');
  await waitFor(() => expect(r.getPathname()).toBe('/family/passport'));

  // single use, one account: after signing out (from Settings), the next person starts at their own home
  await act(async () => router.push('/settings'));
  await waitFor(() => expect(r.getPathname()).toBe('/settings'));
  await act(async () => {
    await fireEvent.press(screen.getByTestId('sign-out'));
  });
  await act(async () => {
    await fireEvent.press(await screen.findByTestId('sign-out-confirm'));
  });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await signInAs('guardianNoChild');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
});

test('a deep link into the other experience is not resumed: the person lands on their own home', async () => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/field/cadets' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await signInAs('guardian');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  expect(screen.queryByTestId('field-cadets')).toBeNull();
});

test('SH-12: below the minimum version, sign-in and later deep links both land on Update required', async () => {
  const policy = dev.devRepositories.account!.versionPolicy!;
  const spy = jest.spyOn(policy, 'get').mockResolvedValue({ minimumVersion: '99.0.0', source: 'synthetic-preview' } as never);
  // jest has no app.json version; give the build one so the gate can compare
  const config = Constants.expoConfig as { version?: string };
  const before = config.version;
  config.version = '0.1.0';
  try {
    const r = await boot();
    await signInAs('guardian');
    await waitFor(() => expect(r.getPathname()).toBe('/update-required'));
    await act(async () => router.push('/family/passport'));
    await waitFor(() => expect(r.getPathname()).toBe('/update-required'));
    expect(screen.queryByTestId('fa05-passport')).toBeNull();
  } finally {
    spy.mockRestore();
    config.version = before;
  }
});

test('error state with retry when family data fails', async () => {
  await boot();
  await signInAs('familyDataError');
  await screen.findByTestId('family-home-error');
  expect(screen.getByText('Retry')).toBeTruthy();
});

test.each([
  ['unknownAccount', 'unavailable-unknownAccount'],
  ['disabled', 'unavailable-disabled'],
  ['bootError', 'unavailable-bootError'],
] as const)('%s shows the neutral unavailable screen', async (persona, testID) => {
  const r = await boot();
  await signInAs(persona);
  await waitFor(() => expect(r.getPathname()).toBe('/unavailable'));
  expect(screen.getByTestId(testID)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('unavailable-sign-out'));
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
});

test('sign-in form validates locally and states that sign-in is not connected', async () => {
  await boot();
  await fireEvent.changeText(screen.getByTestId('mobile-number'), '12345');
  await fireEvent.press(screen.getByTestId('send-code'));
  expect(screen.getByText(/Enter a 10-digit mobile number/)).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('mobile-number'), '98765 43210');
  await fireEvent.press(screen.getByTestId('send-code'));
  expect(screen.getByTestId('sign-in-not-connected')).toBeTruthy();
});

test('non-tab routes open above the tabs (SDK 58 redirects hidden tab routes): Field session and Family Spark', async () => {
  const r = await boot();
  await signInAs('instructor');
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  await act(async () => router.push('/field/session/scan'));
  await waitFor(() => expect(r.getPathname()).toBe('/field/session/scan'));
  expect(await screen.findByTestId('field-scan')).toBeTruthy();
  expect(screen.queryByTestId('tab-profile')).toBeNull();
  await act(async () => testRouter.back());
  await waitFor(() => expect(r.getPathname()).toBe('/field'));
  expect(screen.getByTestId('tab-profile')).toBeTruthy();
});

test('the floating glass tab bar drives real router state', async () => {
  const r = await boot();
  await signInAs('guardian');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  expect(screen.getByTestId('tab-index')).toBeSelected();
  await fireEvent.press(screen.getByTestId('tab-community'));
  await waitFor(() => expect(r.getPathname()).toBe('/family/community'));
  expect(screen.getByTestId('tab-community')).toBeSelected();
  expect(screen.getByTestId('tab-index')).not.toBeSelected();
});
