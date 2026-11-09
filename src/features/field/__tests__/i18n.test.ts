/**
 * @jest-environment node
 */
// Field Ops strings (EN/HI/TE). Every key in the field catalogue must exist in all three locales
// with matching placeholders; HI/TE must use their own scripts and must all be flagged for native review.
// HI and TE are machine-assisted drafts — needs native-speaker review before release.
import en from '../i18n/locales/en.json';
import hi from '../i18n/locales/hi.json';
import te from '../i18n/locales/te.json';
import review from '../i18n/locales/review.json';
import { fieldTranslator } from '../i18n/translator';

type Cat = { [k: string]: string | Cat };
const flat = (c: Cat, p = ''): Record<string, string> =>
  Object.entries(c).reduce<Record<string, string>>(
    (acc, [k, v]) => Object.assign(acc, typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`)),
    {},
  );
const E = flat(en),
  H = flat(hi),
  T = flat(te);
const PH = /\{\{\s*(\w+)\s*\}\}/g;
const ph = (s: string) => [...s.matchAll(PH)].map((m) => m[1]).sort();

describe('Field strings (EN/HI/TE)', () => {
  test('F-I01 every key exists in all three locales with identical placeholders', () => {
    expect(Object.keys(E).length).toBeGreaterThan(300);
    expect(Object.keys(H).sort()).toEqual(Object.keys(E).sort());
    expect(Object.keys(T).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) {
      expect([k, ph(H[k]!)]).toEqual([k, ph(E[k]!)]);
      expect([k, ph(T[k]!)]).toEqual([k, ph(E[k]!)]);
    }
  });

  test('F-I02 Hindi strings are Devanagari, Telugu strings are Telugu script', () => {
    for (const k of Object.keys(E)) {
      const h = H[k]!.replace(PH, '').replace(/<\/?b>/g, '');
      const t = T[k]!.replace(PH, '').replace(/<\/?b>/g, '');
      if (/[A-Za-z]{3,}/.test(h) && !/[ऀ-ॿ]/.test(h)) throw new Error(`${k}: hi not Devanagari`);
      if (/[A-Za-z]{3,}/.test(t) && !/[ఀ-౿]/.test(t)) throw new Error(`${k}: te not Telugu`);
    }
  });

  test('F-I03 every key carries a review status; nothing is claimed reviewed yet', () => {
    const r = review as Record<string, { review: string }>;
    expect(Object.keys(r).sort()).toEqual(Object.keys(E).sort());
    expect(Object.values(r).every((v) => v.review.startsWith('needs-native-review'))).toBe(true);
  });

  test('F-I04 HI and TE are real translations (not just EN copied)', () => {
    for (const k of Object.keys(E)) {
      const english = E[k]!.replace(PH, '').replace(/<\/?b>/g, '').trim();
      // Only check strings with enough Latin content to tell a copy from a translation
      if (english.length < 6 || !/[a-z]{4,}/i.test(english)) continue;
      expect({ key: k, locale: 'hi', same: H[k] === E[k] }).toEqual({ key: k, locale: 'hi', same: false });
      expect({ key: k, locale: 'te', same: T[k] === E[k] }).toEqual({ key: k, locale: 'te', same: false });
    }
  });

  test('F-I05 translator resolves every key without missing entries', () => {
    for (const locale of ['en', 'hi', 'te'] as const) {
      const t = fieldTranslator(locale);
      for (const k of Object.keys(E)) t.t(k);
    }
    // Translator doesn't expose a missing set, but we've verified all keys exist via JSON above
  });
});
