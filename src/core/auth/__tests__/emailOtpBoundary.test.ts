/**
 * SH-02 real OTP boundary: the Supabase adapter's e-mail code methods (D07). Checks the provider calls and that every
 * outcome maps to a result that never reveals whether an account exists. JS-level with a fake auth client; the real
 * provider behaviour is covered by foundations/client-auth/integration on the local stack.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { registeredSignOutCleanupCount, registerSignOutCleanup, runSignOutCleanups } from '../signOutCleanup';
import { createSupabaseAccessAdapter } from '../supabase/supabaseAccessAdapter';

type AuthErr = { status?: number; code?: string; message?: string } | null;

function fakeClient(answers: { otp?: AuthErr | Error; verify?: AuthErr | Error }) {
  const calls: { fn: string; args: unknown }[] = [];
  const answer = (a: AuthErr | Error | undefined) => (a instanceof Error ? Promise.reject(a) : Promise.resolve({ data: {}, error: a ?? null }));
  const auth = {
    signInWithOtp: (args: unknown) => (calls.push({ fn: 'signInWithOtp', args }), answer(answers.otp)),
    verifyOtp: (args: unknown) => (calls.push({ fn: 'verifyOtp', args }), answer(answers.verify)),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    signOut: async () => ({ error: null }),
  };
  return { client: { auth } as unknown as SupabaseClient, calls };
}

describe('e-mail code request', () => {
  test('never creates an account and trims the address', async () => {
    const { client, calls } = fakeClient({});
    expect(await createSupabaseAccessAdapter(client).requestEmailCode(' a@b.test ')).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: 'signInWithOtp', args: { email: 'a@b.test', options: { shouldCreateUser: false } } }]);
  });

  test('an unknown address answers exactly like a known one (no enumeration)', async () => {
    // What the provider says for an address with no account when sign-ups are off for codes.
    const unknown = fakeClient({ otp: { status: 422, code: 'otp_disabled', message: 'Signups not allowed for otp' } });
    const known = fakeClient({});
    expect(await createSupabaseAccessAdapter(unknown.client).requestEmailCode('nobody@b.test')).toEqual(
      await createSupabaseAccessAdapter(known.client).requestEmailCode('someone@b.test'),
    );
  });

  test('rate limits and outages are "unavailable"; a dropped connection is "network"', async () => {
    expect(await createSupabaseAccessAdapter(fakeClient({ otp: { status: 429, message: 'rate limit' } }).client).requestEmailCode('a@b.test')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await createSupabaseAccessAdapter(fakeClient({ otp: { status: 503, message: 'down' } }).client).requestEmailCode('a@b.test')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await createSupabaseAccessAdapter(fakeClient({ otp: new TypeError('Network request failed') }).client).requestEmailCode('a@b.test')).toEqual({ ok: false, reason: 'network' });
  });
});

describe('e-mail code verification (auth.verifyOtp)', () => {
  test('calls verifyOtp with type "email" and the trimmed code', async () => {
    const { client, calls } = fakeClient({});
    expect(await createSupabaseAccessAdapter(client).verifyEmailCode('a@b.test ', ' 123456 ')).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: 'verifyOtp', args: { email: 'a@b.test', token: '123456', type: 'email' } }]);
  });

  test('wrong, expired and unknown-account codes all come back as the same "invalid"', async () => {
    const outcomes = await Promise.all(
      [
        { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
        { status: 400, code: 'validation_failed', message: 'Invalid token' },
        { status: 404, code: 'user_not_found', message: 'User not found' },
      ].map((e) => createSupabaseAccessAdapter(fakeClient({ verify: e }).client).verifyEmailCode('x@b.test', '000000')),
    );
    expect(new Set(outcomes.map((o) => JSON.stringify(o)))).toEqual(new Set([JSON.stringify({ ok: false, reason: 'invalid' })]));
  });

  test('provider lock (429) is "unavailable", a dropped connection is "network"', async () => {
    expect(await createSupabaseAccessAdapter(fakeClient({ verify: { status: 429, message: 'too many' } }).client).verifyEmailCode('a@b.test', '123456')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await createSupabaseAccessAdapter(fakeClient({ verify: new TypeError('Failed to fetch') }).client).verifyEmailCode('a@b.test', '123456')).toEqual({ ok: false, reason: 'network' });
  });
});

describe('sign-out cleanup registry (additive)', () => {
  test('runs every cleanup once; a failing one does not stop the others', async () => {
    const before = registeredSignOutCleanupCount();
    const ran: string[] = [];
    const offA = registerSignOutCleanup(() => void ran.push('a'));
    const offB = registerSignOutCleanup(() => {
      throw new Error('boom');
    });
    const offC = registerSignOutCleanup(async () => void ran.push('c'));
    await expect(runSignOutCleanups()).resolves.toBeUndefined();
    expect(ran.sort()).toEqual(['a', 'c']);
    offA();
    offB();
    offC();
    expect(registeredSignOutCleanupCount()).toBe(before);
  });
});
