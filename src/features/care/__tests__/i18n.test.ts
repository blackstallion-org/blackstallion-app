/**
 * @jest-environment node
 */
import en from '../i18n/locales/en.json';
import hi from '../i18n/locales/hi.json';
import te from '../i18n/locales/te.json';
import review from '../i18n/locales/review.json';
import { createTranslator, resolveLocale } from '../i18n/i18n';

type Cat = { [k: string]: string | Cat };
const flat = (c: Cat, p = ''): Record<string, string> =>
  Object.entries(c).reduce<Record<string, string>>((acc, [k, v]) => Object.assign(acc, typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`)), {});
const E = flat(en), H = flat(hi), T = flat(te);
const PH = /\{\{\s*(\w+)\s*\}\}/g;
const ph = (s: string) => [...s.matchAll(PH)].map((m) => m[1]).sort();

describe('Field Ops localisation (EN/HI/TE)', () => {
  test('L01 every key exists in all three locales with identical placeholders', () => {
    expect(Object.keys(H).sort()).toEqual(Object.keys(E).sort());
    expect(Object.keys(T).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) {
      expect([k, ph(H[k]!)]).toEqual([k, ph(E[k]!)]);
      expect([k, ph(T[k]!)]).toEqual([k, ph(E[k]!)]);
    }
  });

  test('L02 Hindi strings are Devanagari, Telugu strings are Telugu script', () => {
    for (const k of Object.keys(E)) {
      const h = H[k]!.replace(PH, '').replace(/<\/?b>/g, '');
      const t = T[k]!.replace(PH, '').replace(/<\/?b>/g, '');
      if (/[A-Za-z]{3,}/.test(h) && !/[ऀ-ॿ]/.test(h)) throw new Error(`${k}: hi not Devanagari`);
      if (/[A-Za-z]{3,}/.test(t) && !/[ఀ-౿]/.test(t)) throw new Error(`${k}: te not Telugu`);
    }
  });

  test('L03 every key carries a review status; nothing is claimed reviewed yet', () => {
    const r = review as Record<string, { review: string }>;
    expect(Object.keys(r).sort()).toEqual(Object.keys(E).sort());
    expect(Object.values(r).every((v) => v.review.startsWith('needs-native-review'))).toBe(true);
  });

  test('L04 labels, errors and statuses render in each language with interpolation', () => {
    const tt = { en: createTranslator('en'), hi: createTranslator('hi'), te: createTranslator('te') };
    expect(tt.en.t('care.capture.weakLocation', { accuracy: '±120 m' })).toBe('Location is weak (±120 m). You can submit; a supervisor will review it.');
    expect(tt.hi.t('care.capture.weakLocation', { accuracy: '±120 m' })).toContain('±120 m');
    expect(tt.te.t('sync.state.blocked')).toMatch(/[ఀ-౿]/);
    expect(tt.hi.t('care.evidence.reviewRequired')).toMatch(/[ऀ-ॿ]/);
    expect(tt.te.missing.size + tt.hi.missing.size).toBe(0);
  });

  test('L05 dates and times format in the hub timezone, per locale (IST day boundary)', () => {
    const at = Date.parse('2026-11-04T18:45:00Z'); // 00:15 on 5 Nov in IST
    const en = createTranslator('en');
    expect(en.time(at, 'Asia/Kolkata')).toMatch(/12:15\s?am/i);
    expect(en.date(at, 'Asia/Kolkata')).toMatch(/5 Nov/);
    expect(createTranslator('hi').date(at, 'Asia/Kolkata')).toMatch(/5/);
    expect(createTranslator('hi').date(at, 'Asia/Kolkata')).toMatch(/[ऀ-ॿ]/);
    expect(createTranslator('te').date(at, 'Asia/Kolkata')).toMatch(/[ఀ-౿]/);
    expect(createTranslator('te').time(at, 'Asia/Kolkata')).toMatch(/12:15/);
  });

  test('L06 unknown keys fall back to English and are reported; device locale resolution', () => {
    const t = createTranslator('te');
    expect(t.t('no.such.key')).toBe('no.such.key');
    expect(t.missing.has('no.such.key')).toBe(true);
    expect(resolveLocale(['te-IN', 'en-US'])).toBe('te');
    expect(resolveLocale(['hi_IN'])).toBe('hi');
    expect(resolveLocale(['fr-FR'])).toBe('en');
  });
});
