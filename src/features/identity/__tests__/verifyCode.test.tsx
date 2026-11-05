/**
 * SH-02 Verify code on the real route files and shell (sharedRouterHarness). JS-level: the provider is a mock adapter
 * with the Supabase adapter's interface; the real verifyOtp mapping is tested in core/auth/__tests__.
 */
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import type { AccessAdapter, SignInResult } from '@/core/auth/accessAdapter';
import { authorized, createTestAdapter, renderSharedApp } from '@/features/settings/testing/sharedRouterHarness';

import { MAX_WRONG_CODES, pendingVerification, RESEND_COOLDOWN_MS } from '../otp';

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
const mockBackend = { connected: true };
jest.mock('@/core/auth/supabaseClient', () => ({
  readBackendConfig: () => (mockBackend.connected ? { url: 'http://127.0.0.1:55421', publishableKey: 'test-publishable' } : null),
  createConfiguredAccessAdapter: () => null,
  getConfiguredClient: () => null,
}));

const GUARDIAN = authorized('u-g', 'Guardian (test)', ['family'], { role: 'PARENT', hubId: null, children: [{ cadetId: 'c-1', firstName: 'Child', hubId: 'h-1' }], capabilities: {} });

/** A connected adapter: one real account (`known@`), every other address unknown. Codes: 123456 for the known one. */
function connected(verifyResult?: (email: string, code: string) => SignInResult) {
  const requests: string[] = [];
  const verifies: { email: string; code: string }[] = [];
  const t = createTestAdapter();
  const extra: Partial<AccessAdapter> = {
    signInWithPassword: async () => ({ ok: false, reason: 'invalid' }),
    requestEmailCode: async (email) => {
      requests.push(email);
      return { ok: true }; // the real adapter answers the same for unknown addresses (core/auth test)
    },
    verifyEmailCode: async (email, code) => {
      verifies.push({ email, code });
      const r = verifyResult?.(email, code) ?? (email === 'known@g3.test' && code === '123456' ? { ok: true } : { ok: false, reason: 'invalid' });
      if (r.ok) t.signInAs(GUARDIAN);
      return r;
    },
  };
  Object.assign(t.adapter, extra);
  return { ...t, requests, verifies };
}

type Node = { children?: (Node | string)[] | null } | string | null;
/** Visible text of the SH-02 screen only (navigator keys and ids differ between visits). */
const verifyText = (): string => {
  const walk = (n: Node): string => (n === null ? '' : typeof n === 'string' ? `${n}|` : (n.children ?? []).map(walk).join(''));
  return walk(screen.getByTestId('verify') as unknown as Node);
};

async function toVerify(email: string, t = connected()) {
  const r = await renderSharedApp({ adapter: t.adapter });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await fireEvent.press(screen.getByTestId('use-email-code'));
  await fireEvent.changeText(screen.getByTestId('email'), email);
  await fireEvent.press(screen.getByTestId('send-email-code'));
  await waitFor(() => expect(r.getPathname()).toBe('/verify'));
  return { r, t };
}

beforeEach(() => {
  mockBackend.connected = true;
  pendingVerification.clear();
});

test('OTP errors never reveal whether an account exists: same screens and messages for a known and an unknown address', async () => {
  const { r } = await toVerify('known@g3.test');
  const sentKnown = verifyText().replaceAll('known@g3.test', 'ADDRESS');
  await fireEvent.changeText(screen.getByTestId('code'), '000111');
  const wrongKnown = (await screen.findByTestId('verify-error')).props.accessibilityLabel;

  // Same person changes the address to one with no account.
  await fireEvent.press(screen.getByTestId('change-address'));
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await fireEvent.changeText(screen.getByTestId('email'), 'nobody@g3.test');
  await fireEvent.press(screen.getByTestId('send-email-code'));
  await waitFor(() => expect(r.getPathname()).toBe('/verify'));
  expect(verifyText().replaceAll('nobody@g3.test', 'ADDRESS')).toBe(sentKnown);
  expect(sentKnown).toContain('If ADDRESS has an account');
  expect(screen.getByTestId('verify')).toHaveTextContent(/If nobody@g3.test has an account/);
  await fireEvent.changeText(screen.getByTestId('code'), '123456'); // the right code, for an account that doesn't exist
  expect((await screen.findByTestId('verify-error')).props.accessibilityLabel).toBe(wrongKnown);
  expect(wrongKnown).toMatch(/didn't work/);
  expect(wrongKnown).not.toMatch(/account|registered|exist/i);
  expect(r.getPathname()).toBe('/verify');
});

test('resend waits 0:30, then sends again, clears the field and restarts the cooldown', async () => {
  const { t } = await toVerify('known@g3.test');
  expect(screen.getByTestId('resend-code')).toBeDisabled();
  expect(screen.getByTestId('resend-code')).toHaveTextContent(/Send a new code in 0:(30|29)/);
  // Move the send time back past the cooldown (instead of waiting 30 s).
  await act(async () => pendingVerification.markResent(Date.now() - RESEND_COOLDOWN_MS - 1000));
  await waitFor(() => expect(screen.getByTestId('resend-code')).not.toBeDisabled());
  await fireEvent.changeText(screen.getByTestId('code'), '12');
  await fireEvent.press(screen.getByTestId('resend-code'));
  expect(await screen.findByTestId('verify-resent')).toBeTruthy();
  expect((t as ReturnType<typeof connected>).requests).toEqual(['known@g3.test', 'known@g3.test']);
  expect(screen.getByTestId('code').props.value).toBe('');
  expect(screen.getByTestId('resend-code')).toBeDisabled();
});

test(`after ${MAX_WRONG_CODES} wrong codes the screen asks for a new code; a new code unlocks it`, async () => {
  const { t } = await toVerify('known@g3.test');
  for (let i = 0; i < MAX_WRONG_CODES; i++) {
    await fireEvent.changeText(screen.getByTestId('code'), `00000${i}`);
    await screen.findByTestId('verify-error');
  }
  expect(screen.getByTestId('verify-error')).toHaveTextContent(/Too many attempts/);
  expect(screen.getByTestId('verify-code')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('verify-code'));
  expect((t as ReturnType<typeof connected>).verifies).toHaveLength(MAX_WRONG_CODES); // nothing more is sent
  await act(async () => pendingVerification.markResent(Date.now() - RESEND_COOLDOWN_MS - 1000));
  await fireEvent.press(screen.getByTestId('resend-code'));
  await screen.findByTestId('verify-resent');
  expect(screen.getByTestId('verify-code')).not.toBeDisabled();
});

test('offline: the code is kept and the message says so; nothing private renders', async () => {
  const t = connected(() => ({ ok: false, reason: 'network' }));
  const { r } = await toVerify('known@g3.test', t);
  await fireEvent.changeText(screen.getByTestId('code'), '123456');
  expect(await screen.findByTestId('verify-error')).toHaveTextContent(/Your code is kept/);
  expect(screen.getByTestId('code').props.value).toBe('123456');
  expect(r.getPathname()).toBe('/verify');
  expect(screen.queryByTestId('family-home-stub')).toBeNull();
});

test('"Change e-mail address" returns to SH-01 with the address this person typed', async () => {
  const { r } = await toVerify('known@g3.test');
  await fireEvent.press(screen.getByTestId('change-address'));
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  expect(screen.getByTestId('email').props.value).toBe('known@g3.test');
});

test('a deep link to /verify with no code request asks to start again', async () => {
  const t = connected();
  const r = await renderSharedApp({ adapter: t.adapter, initialUrl: '/verify' });
  expect(await screen.findByTestId('verify-restart')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('verify-restart-sign-in'));
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
});

test('/verify while signed in hands over to the boot gate (no code screen for an authorized person)', async () => {
  const s = createTestAdapter();
  s.state.snapshot = GUARDIAN;
  const r = await renderSharedApp({ adapter: s.adapter, initialUrl: '/verify' });
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  expect(screen.queryByTestId('verify')).toBeNull();
});

test('a successful code shows a neutral wait, then the boot gate routes by the server snapshot', async () => {
  const { r } = await toVerify('known@g3.test');
  await fireEvent.changeText(screen.getByTestId('code'), '123456');
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  expect(pendingVerification.get()).toBeNull();
});

describe('development preview (no backend configured)', () => {
  test('SH-01 still says sign-in is not connected; the labelled preview reaches SH-02, which sends nothing', async () => {
    mockBackend.connected = false;
    const t = createTestAdapter();
    const r = await renderSharedApp({ adapter: t.adapter });
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    await fireEvent.changeText(screen.getByTestId('mobile-number'), '9876543210');
    await fireEvent.press(screen.getByTestId('send-code'));
    expect(screen.getByTestId('sign-in-not-connected')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preview-verify'));
    await waitFor(() => expect(r.getPathname()).toBe('/verify'));
    expect(screen.getByTestId('verify-preview-banner')).toHaveTextContent(/no code was sent/);
    await fireEvent.changeText(screen.getByTestId('code'), '000000');
    expect(await screen.findByTestId('verify-error', {}, { timeout: 3000 })).toHaveTextContent(/Your code is kept/);
    await fireEvent.changeText(screen.getByTestId('code'), '123456');
    expect(await screen.findByTestId('verify-preview-accepted', {}, { timeout: 3000 })).toHaveTextContent(/no account was signed in/);
    expect(screen.getByTestId('dev-preview-panel')).toBeTruthy();
    expect(t.state.snapshot).toEqual({ kind: 'signedOut' }); // the synthetic code signed nobody in
  });
});
