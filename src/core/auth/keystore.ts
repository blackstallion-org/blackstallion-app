import * as SecureStore from 'expo-secure-store';

import type { KeystoreLike } from './supabase/chunkedSecureStorage';

/**
 * Phones: tokens live only in the platform keystore. WHEN_UNLOCKED_THIS_DEVICE_ONLY: readable only while the device is
 * unlocked and never migrated to another device by a backup restore. (Browser preview: keystore.web.ts.)
 */
export const keystore: KeystoreLike = {
  getItemAsync: (k) => SecureStore.getItemAsync(k, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: (k) => SecureStore.deleteItemAsync(k, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
};
