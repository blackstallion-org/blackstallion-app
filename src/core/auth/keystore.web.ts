import type { KeystoreLike } from './supabase/chunkedSecureStorage';

/**
 * Browser PREVIEW only (react-native-web, development): there is no platform keystore in a browser, so the session is
 * kept in this tab's sessionStorage and is gone when the tab closes. A non-development web bundle refuses to store a
 * session at all (the app then behaves as signed out). The app's real targets are iOS and Android (keystore.ts).
 * readBackendConfig() already limits development builds to this machine / the local network and never the live project.
 */
const available = (): Storage | null => {
  if (!__DEV__) return null;
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const unavailable = () => Promise.reject(new Error('No session storage in this browser build'));

export const keystore: KeystoreLike = {
  getItemAsync: async (k) => {
    const s = available();
    return s ? s.getItem(k) : unavailable();
  },
  setItemAsync: async (k, v) => {
    const s = available();
    if (!s) return unavailable();
    s.setItem(k, v);
  },
  deleteItemAsync: async (k) => {
    const s = available();
    if (!s) return unavailable();
    s.removeItem(k);
  },
};
