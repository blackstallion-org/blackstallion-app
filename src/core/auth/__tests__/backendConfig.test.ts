import { isSecretKey, readBackendConfig } from '../supabaseClient';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

test('no backend configured → null (dev preview or unconnected build)', () => {
  expect(readBackendConfig({})).toBeNull();
  expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55421' })).toBeNull();
});
test('URL + publishable key → config; trailing slash removed', () => {
  expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55421/', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' k ' }, true))
    .toEqual({ url: 'http://127.0.0.1:55421', publishableKey: 'k' });
});
test('malformed URLs are refused', () => {
  for (const u of ['127.0.0.1:55421', 'http://host/path', 'javascript:alert(1)', 'http://a b']) {
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: u, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBeNull();
  }
});

const jwt = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;
test('cleartext http only in dev and only to this machine or the LAN', () => {
  const k = { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' };
  expect(readBackendConfig({ ...k, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55421' }, true)).not.toBeNull();
  expect(readBackendConfig({ ...k, EXPO_PUBLIC_SUPABASE_URL: 'http://192.168.1.20:55421' }, true)).not.toBeNull();
  expect(readBackendConfig({ ...k, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55421' }, false)).toBeNull();
  expect(readBackendConfig({ ...k, EXPO_PUBLIC_SUPABASE_URL: 'http://example.com' }, true)).toBeNull();
  expect(readBackendConfig({ ...k, EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }, false)).not.toBeNull();
});
test('secret and service-role keys are refused', () => {
  expect(isSecretKey('sb_secret_abc')).toBe(true);
  expect(isSecretKey(jwt({ role: 'service_role' }))).toBe(true);
  expect(isSecretKey(jwt({ role: 'anon' }))).toBe(false);
  expect(isSecretKey('sb_publishable_abc')).toBe(false);
  expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) }, false)).toBeNull();
});
test('development builds refuse the live project (D33)', () => {
  const live = { EXPO_PUBLIC_SUPABASE_URL: 'https://tgwadczrfbljnepoaqtb.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' };
  expect(readBackendConfig(live, true)).toBeNull();
});
