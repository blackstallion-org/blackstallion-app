/**
 * G3: sign-in on the real route tree when a backend IS configured. The composition root is given a mockState connected
 * adapter (same interface as the Supabase adapter), so this is a JS-level check of the app's behaviour; real
 * server enforcement is in foundations/client-auth/integration (local Supabase stack).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import path from 'path';
import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';

import type { AccessAdapter, ResetResult, SignInResult } from '@/core/auth/accessAdapter';
import type { AccessSnapshot } from '@/features/identity/domain/access';

const mockState = {
  snapshot: { kind: 'signedOut' } as AccessSnapshot,
  listeners: new Set<() => void>(),
  attempts: [] as { email: string; password: string }[],
  result: { ok: true } as SignInResult,
  signedOut: 0,
  /** simulate a connected adapter that offers no password method (e.g. a future code-only build) */
  noPasswordMethod: false,
  codeRequests: [] as string[],
  resetRequests: [] as string[],
  goodCode: '123456',
  resetResult: { ok: true } as ResetResult,
  resets: [] as { email: string; code: string; pw: string }[],
};
const mockSignInAsGuardian = () => {
  mockState.snapshot = guardian;
  mockState.listeners.forEach((l) => l());
};
const guardian: AccessSnapshot = {
  kind: 'authorized', subjectId: 'u-guardian', displayName: 'Guardian (test)', allowedExperiences: ['family'], source: 'server',
  scope: { role: 'PARENT', hubId: null, children: [{ cadetId: 'c-1', firstName: 'Child', hubId: 'h-1' }], capabilities: {} },
};
const mockAdapter: AccessAdapter = {
  name: 'supabase',
  load: async () => mockState.snapshot,
  signOut: async () => {
    mockState.signedOut++;
    mockState.snapshot = { kind: 'signedOut' };
  },
  subscribe: (l) => {
    mockState.listeners.add(l);
    return () => mockState.listeners.delete(l);
  },
  signInWithPassword: async (email, password) => {
    mockState.attempts.push({ email, password });
    if (mockState.result.ok) {
      mockState.snapshot = guardian;
      mockState.listeners.forEach((l) => l()); // what onAuthStateChange(SIGNED_IN) does in the real adapter
    }
    return mockState.result;
  },
  requestEmailCode: async (email) => {
    mockState.codeRequests.push(email);
    return { ok: true };
  },
  verifyEmailCode: async (_email, code) => {
    if (code !== mockState.goodCode) return { ok: false, reason: 'invalid' };
    mockSignInAsGuardian();
    return { ok: true };
  },
  requestPasswordReset: async (email) => {
    mockState.resetRequests.push(email);
    return { ok: true };
  },
  completePasswordReset: async (email, code, pw) => {
    mockState.resets.push({ email, code, pw });
    if (code !== mockState.goodCode) return { ok: false, reason: 'invalid' };
    if (!mockState.resetResult.ok) return mockState.resetResult;
    mockSignInAsGuardian();
    return { ok: true };
  },
};

jest.mock('@/core/auth/supabaseClient', () => ({
  createConfiguredAccessAdapter: () => {
    if (!mockState.noPasswordMethod) return mockAdapter;
    const { signInWithPassword: _omit, ...rest } = mockAdapter;
    return rest;
  },
  getConfiguredClient: () => null,
  readBackendConfig: () => ({ url: 'http://127.0.0.1:55421', publishableKey: 'test-publishable' }),
}));

const APP_DIR = path.resolve(__dirname, '../../../app');
const boot = async () => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  return r;
};

beforeEach(async () => {
  mockState.snapshot = { kind: 'signedOut' };
  mockState.attempts = [];
  mockState.result = { ok: true };
  mockState.signedOut = 0;
  mockState.noPasswordMethod = false;
  mockState.codeRequests = [];
  mockState.resetRequests = [];
  mockState.resets = [];
  mockState.resetResult = { ok: true };
  await AsyncStorage.clear();
});

test('connected build: e-mail + password form, no synthetic persona panel', async () => {
  await boot();
  expect(screen.getByTestId('email')).toBeTruthy();
  expect(screen.getByTestId('password')).toBeTruthy();
  expect(screen.queryByTestId('dev-preview-panel')).toBeNull();
  expect(screen.queryByTestId('mobile-number')).toBeNull();
});

test('wrong credentials: generic message, stays on sign-in, nothing private rendered', async () => {
  mockState.result = { ok: false, reason: 'invalid' };
  const r = await boot();
  await fireEvent.changeText(screen.getByTestId('email'), 'guardian@g3.test');
  await fireEvent.changeText(screen.getByTestId('password'), 'wrong');
  await fireEvent.press(screen.getByTestId('sign-in-submit'));
  expect(await screen.findByTestId('sign-in-error')).toHaveTextContent(/don't match/);
  expect(r.getPathname()).toBe('/sign-in');
  expect(screen.getByTestId('password')).toBeTruthy();
  expect(screen.queryByTestId('tab-profile')).toBeNull(); // no authorized tree mounted
});

test('incomplete form is refused before any request', async () => {
  await boot();
  await fireEvent.press(screen.getByTestId('sign-in-submit'));
  expect(await screen.findByTestId('sign-in-error')).toHaveTextContent(/Enter your e-mail/);
  expect(mockState.attempts).toHaveLength(0);
});

test('successful sign-in reloads the server snapshot and lands on the authorized home', async () => {
  const r = await boot();
  await fireEvent.changeText(screen.getByTestId('email'), ' guardian@g3.test ');
  await fireEvent.changeText(screen.getByTestId('password'), 'correct horse');
  await fireEvent.press(screen.getByTestId('sign-in-submit'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  expect(mockState.attempts).toEqual([{ email: ' guardian@g3.test ', password: 'correct horse' }]);
});

test('a family-only user cannot reach Field Ops by deep link after real sign-in', async () => {
  const r = await boot();
  await fireEvent.changeText(screen.getByTestId('email'), 'guardian@g3.test');
  await fireEvent.changeText(screen.getByTestId('password'), 'pw');
  await fireEvent.press(screen.getByTestId('sign-in-submit'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await act(async () => {
    try {
      await testRouter.push('/field');
    } catch {
      // testRouter asserts it arrived; the guard redirected instead, which is what this test expects
    }
  });
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
});

test('connected build never shows the persona panel, even on the phone layout (route-level guard)', async () => {
  mockState.noPasswordMethod = true;
  await boot();
  expect(screen.getByTestId('mobile-number')).toBeTruthy(); // phone layout, which normally carries the dev panel
  expect(screen.queryByTestId('dev-preview-panel')).toBeNull();
});

test('e-mail code: generic "if an account exists" message, wrong code refused, right code signs in', async () => {
  const r = await boot();
  await fireEvent.press(screen.getByTestId('use-email-code'));
  await fireEvent.press(screen.getByTestId('send-email-code'));
  expect(await screen.findByTestId('sign-in-error')).toHaveTextContent(/Enter your e-mail/);
  await fireEvent.changeText(screen.getByTestId('email'), 'someone@g3.test');
  await fireEvent.press(screen.getByTestId('send-email-code'));
  expect(await screen.findByTestId('code-sent')).toHaveTextContent(/If someone@g3.test has an account/);
  expect(mockState.codeRequests).toEqual(['someone@g3.test']);
  await fireEvent.changeText(screen.getByTestId('code'), '999999');
  await fireEvent.press(screen.getByTestId('verify-code'));
  expect(await screen.findByTestId('sign-in-error')).toHaveTextContent(/didn't work/);
  expect(r.getPathname()).toBe('/sign-in');
  await fireEvent.changeText(screen.getByTestId('code'), '12a34-56');
  expect(screen.getByTestId('code').props.value).toBe('123456'); // digits only
  await fireEvent.press(screen.getByTestId('verify-code'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
});

test('reset by code: checks before spending the code, then signs in with the new password', async () => {
  const r = await boot();
  await fireEvent.press(screen.getByTestId('forgot-password'));
  await fireEvent.changeText(screen.getByTestId('email'), 'guardian@g3.test');
  await fireEvent.press(screen.getByTestId('send-reset-code'));
  expect(await screen.findByTestId('reset-sent')).toHaveTextContent(/If guardian@g3.test has an account/);
  await fireEvent.changeText(screen.getByTestId('code'), '123456');
  await fireEvent.changeText(screen.getByTestId('new-password'), 'short');
  await fireEvent.changeText(screen.getByTestId('confirm-password'), 'short');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  expect(await screen.findByTestId('reset-error')).toHaveTextContent(/at least 8/);
  await fireEvent.changeText(screen.getByTestId('new-password'), 'a long new password');
  await fireEvent.changeText(screen.getByTestId('confirm-password'), 'a different one');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  expect(await screen.findByTestId('reset-error')).toHaveTextContent(/don't match/);
  expect(mockState.resets).toHaveLength(0); // no code spent on input mistakes
  await fireEvent.changeText(screen.getByTestId('confirm-password'), 'a long new password');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  expect(mockState.resets).toEqual([{ email: 'guardian@g3.test', code: '123456', pw: 'a long new password' }]);
});

test('reset refused by the server: explains, and starts again from a new code', async () => {
  mockState.resetResult = { ok: false, reason: 'weakPassword' };
  const r = await boot();
  await fireEvent.press(screen.getByTestId('forgot-password'));
  await fireEvent.changeText(screen.getByTestId('email'), 'guardian@g3.test');
  await fireEvent.press(screen.getByTestId('send-reset-code'));
  await screen.findByTestId('reset-sent');
  await fireEvent.changeText(screen.getByTestId('code'), '123456');
  await fireEvent.changeText(screen.getByTestId('new-password'), 'a long new password');
  await fireEvent.changeText(screen.getByTestId('confirm-password'), 'a long new password');
  await fireEvent.press(screen.getByTestId('reset-submit'));
  expect(await screen.findByTestId('reset-error')).toHaveTextContent(/ask for a new one/);
  expect(screen.getByTestId('send-reset-code')).toBeTruthy(); // back at the request step
  expect(r.getPathname()).toBe('/sign-in');
});
