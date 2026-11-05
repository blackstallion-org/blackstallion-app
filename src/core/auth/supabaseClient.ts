import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, type AppStateStatus } from 'react-native';

import type { AccessAdapter } from './accessAdapter';
import { createChunkedSecureStorage, type KeystoreLike } from './supabase/chunkedSecureStorage';
import { createSupabaseAccessAdapter } from './supabase/supabaseAccessAdapter';

/**
 * Backend configuration comes only from public build-time variables: the project URL and the PUBLISHABLE key.
 * No service-role key or other secret ever belongs in the app (EXPO_PUBLIC_* values are readable in the bundle).
 * Development points at the local stack (backend-local/, D33); the live project is never a development target.
 */
export type BackendConfig = { url: string; publishableKey: string };

/** The live project the website uses (16 §2). Development builds must never point at it (D33). */
const LIVE_PROJECT_REF = 'tgwadczrfbljnepoaqtb';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** True for keys that must never ship in an app: new-style secret keys and legacy service-role JWTs. */
export function isSecretKey(key: string): boolean {
  if (/^sb_secret_/i.test(key)) return true;
  const part = key.split('.')[1];
  if (!part) return false;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return json?.role === 'service_role';
  } catch {
    return false;
  }
}

export function readBackendConfig(
  env: Record<string, string | undefined> = {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  dev: boolean = __DEV__,
): BackendConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  const m = /^(https?):\/\/([^\s/:]+)(:\d+)?\/?$/.exec(url);
  if (!m) return null;
  const [, scheme, host] = m;
  // Cleartext only in development builds and only to this machine or the local network (the local stack).
  if (scheme === 'http' && !(dev && LOCAL_HOST.test(host ?? ''))) return null;
  if (isSecretKey(publishableKey)) return null;
  if (dev && host?.toLowerCase().includes(LIVE_PROJECT_REF)) return null;
  return { url: url.replace(/\/$/, ''), publishableKey };
}

/**
 * Tokens live only in the platform keystore. WHEN_UNLOCKED_THIS_DEVICE_ONLY: readable only while the device is
 * unlocked and never migrated to another device by a backup restore.
 */
const keystore: KeystoreLike = {
  getItemAsync: (k) => SecureStore.getItemAsync(k, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: (k) => SecureStore.deleteItemAsync(k, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
};

export function createAppSupabaseClient(config: BackendConfig): SupabaseClient {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      storage: createChunkedSecureStorage(keystore),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  // Refresh only while the app is in the foreground; the next foreground resumes it.
  const onAppState = (s: AppStateStatus) => {
    if (s === 'active') void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  };
  AppState.addEventListener('change', onAppState);
  return client;
}

let sharedClient: SupabaseClient | null = null;

/** The app's single Supabase client (publishable key only), or null when no backend is configured. */
export function getConfiguredClient(): SupabaseClient | null {
  if (sharedClient) return sharedClient;
  const config = readBackendConfig();
  if (!config) return null;
  sharedClient = createAppSupabaseClient(config);
  return sharedClient;
}

/** The real adapter, or null when this build has no backend configured. */
export function createConfiguredAccessAdapter(): AccessAdapter | null {
  const client = getConfiguredClient();
  if (!client) return null;
  // Cleanup hooks get push-token deletion and query/image cache eviction when those exist (G4/G5).
  return createSupabaseAccessAdapter(client);
}
