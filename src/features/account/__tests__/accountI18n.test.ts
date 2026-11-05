import { createMemoryStore } from '@/core/preferences/keyValueStore';

import { createLanguagePreference, deviceLanguage, LANGUAGE_KEY, localeForExperience } from '../i18n/languagePreference';
import review from '../i18n/locales/review.json';
import { accountStrings, catalogFor, catalogKeys } from '../i18n/strings';

const placeholders = (s: string) => Array.from(s.matchAll(/\{\{\s*(\w+)\s*\}\}/g), (m) => m[1]).sort();
const value = (locale: 'en' | 'hi' | 'te', key: string) => accountStrings(locale).t(key);
const raw = (locale: 'en' | 'hi' | 'te', key: string): string | undefined => {
  let node: unknown = catalogFor(locale);
  for (const p of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[p];
  return typeof node === 'string' ? node : undefined;
};

describe('EN/HI/TE catalogue', () => {
  const keys = catalogKeys();

  test('Hindi and Telugu have every English key, the same placeholders, and non-empty text', () => {
    expect(keys.length).toBeGreaterThan(200);
    expect(catalogKeys(catalogFor('hi'))).toEqual(keys);
    expect(catalogKeys(catalogFor('te'))).toEqual(keys);
    for (const k of keys) {
      for (const l of ['hi', 'te'] as const) {
        const s = raw(l, k);
        expect(s?.trim()).toBeTruthy();
        expect(placeholders(s!)).toEqual(placeholders(raw('en', k)!));
      }
    }
  });

  test('every Hindi/Telugu string is registered as a machine draft that needs native review', () => {
    expect(Object.keys(review).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      const r = (review as Record<string, { hi: string; te: string }>)[k]!;
      expect(r.hi).toMatch(/^needs-native-review/);
      expect(r.te).toMatch(/^needs-native-review/);
    }
  });

  test('scripts are right (Devanagari for Hindi, Telugu for Telugu) and placeholders are filled', () => {
    expect(value('hi', 'settings.title')).toMatch(/[ऀ-ॿ]/);
    expect(value('te', 'settings.title')).toMatch(/[ఀ-౿]/);
    expect(accountStrings('te').t('signOut.pendingCount', { count: 2 })).toContain('2');
    expect(accountStrings('en').t('profile.roleAtHub', { role: 'Groom', hub: 'Hub Beta' })).toBe('Groom at Hub Beta');
    expect(accountStrings('en').t('no.such.key')).toBe('no.such.key'); // visible in review, never blank
  });
});

describe('language preference (SH-13, D19)', () => {
  test('Family stays English in the pilot; Field Ops and gates use the chosen language', () => {
    expect(localeForExperience('family', 'te')).toBe('en');
    expect(localeForExperience('field', 'te')).toBe('te');
    expect(localeForExperience(null, 'hi')).toBe('hi');
  });

  test('follows the phone until chosen; the choice persists and survives a restart', async () => {
    expect(deviceLanguage(['te-IN'])).toBe('te');
    expect(deviceLanguage(['fr-FR', 'hi-IN'])).toBe('hi');
    expect(deviceLanguage(['fr-FR'])).toBe('en');
    const store = createMemoryStore();
    const pref = createLanguagePreference(store, () => 'hi');
    await pref.load();
    expect(pref.get()).toMatchObject({ ready: true, stored: null, effective: 'hi' });
    await pref.set('te');
    expect(await store.get(LANGUAGE_KEY)).toBe('te');
    const restarted = createLanguagePreference(store, () => 'hi');
    await restarted.load();
    expect(restarted.get()).toMatchObject({ stored: 'te', effective: 'te', saveFailed: false });
  });

  test('a failed save keeps the choice for this session and says so', async () => {
    const store = { ...createMemoryStore(), set: async () => Promise.reject(new Error('disk full')) };
    const pref = createLanguagePreference(store, () => 'en');
    await pref.set('hi');
    expect(pref.get()).toMatchObject({ effective: 'hi', saveFailed: true });
  });
});
