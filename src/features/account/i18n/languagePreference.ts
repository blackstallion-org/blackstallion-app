/**
 * SH-13 language preference (EN/HI/TE, D19 PROPOSED). Device-local and non-sensitive (06 §4), so it lives in the
 * key-value store, not the keystore, and survives sign-out (a device setting, not account data).
 *
 * `stored` is the explicit choice; until there is one, the app follows the phone's language (`effective`).
 * D19: Field Ops screens use it; Family screens stay English in the pilot (see `localeForExperience`).
 * Other workstreams read it with `useLanguagePreference().effective` (e.g. to feed a FieldLocaleProvider).
 */
import { useSyncExternalStore } from 'react';

import { asyncStorageStore, type KeyValueStore } from '@/core/preferences/keyValueStore';

export type AppLanguage = 'en' | 'hi' | 'te';
export const APP_LANGUAGES: readonly AppLanguage[] = ['en', 'hi', 'te'];
export const LANGUAGE_KEY = 'bsah.pref.language.v1';

export const parseLanguage = (raw: string | null | undefined): AppLanguage | null =>
  raw === 'en' || raw === 'hi' || raw === 'te' ? raw : null;

/** First supported language among the phone's preferred locales; English otherwise. */
export function deviceLanguage(tags: readonly (string | null | undefined)[] = deviceLocaleTags()): AppLanguage {
  for (const tag of tags) {
    const base = parseLanguage((tag ?? '').toLowerCase().split(/[-_]/)[0]);
    if (base) return base;
  }
  return 'en';
}

function deviceLocaleTags(): string[] {
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

export type LanguageSnapshot = {
  /** False until the stored choice has been read. */
  ready: boolean;
  stored: AppLanguage | null;
  effective: AppLanguage;
  /** True when the last save failed: the choice applies until the app closes. */
  saveFailed: boolean;
};

export function createLanguagePreference(store: KeyValueStore, device: () => AppLanguage = () => deviceLanguage()) {
  let snap: LanguageSnapshot = { ready: false, stored: null, effective: device(), saveFailed: false };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: Partial<LanguageSnapshot>) => {
    snap = { ...snap, ...next };
    snap.effective = snap.stored ?? device();
    listeners.forEach((l) => l());
  };
  const load = () => {
    loading ??= store
      .get(LANGUAGE_KEY)
      .then((raw) => emit({ ready: true, stored: parseLanguage(raw) }))
      .catch(() => emit({ ready: true }));
    return loading;
  };
  return {
    load,
    get: (): LanguageSnapshot => snap,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      void load();
      return () => listeners.delete(l);
    },
    async set(next: AppLanguage): Promise<void> {
      emit({ stored: next });
      try {
        await store.set(LANGUAGE_KEY, next);
        emit({ saveFailed: false });
      } catch {
        emit({ saveFailed: true });
      }
    },
  };
}

export type LanguagePreference = ReturnType<typeof createLanguagePreference>;

/** The app's single instance (AsyncStorage). Tests may build their own with a memory store. */
export const languagePreference: LanguagePreference = createLanguagePreference(asyncStorageStore);

export function useLanguagePreference(pref: LanguagePreference = languagePreference) {
  const snap = useSyncExternalStore(pref.subscribe, pref.get, pref.get);
  return { ...snap, setLanguage: pref.set };
}

/** D19: Family stays English in the pilot; Field Ops (and pre-experience gates) use the chosen language. */
export const localeForExperience = (experience: 'family' | 'field' | null, effective: AppLanguage): AppLanguage =>
  experience === 'family' ? 'en' : effective;
