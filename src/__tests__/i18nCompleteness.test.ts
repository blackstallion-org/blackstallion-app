/**
 * @jest-environment node
 */
// Cross-catalogue i18n completeness: every Field Ops catalogue (field, care, fieldOps, account) must have
// matching keys in EN/HI/TE, identical placeholders, and no untranslated copies. HI and TE are machine-assisted
// drafts everywhere — needs native-speaker review before release.
import fs from 'fs';
import path from 'path';

type Cat = { [k: string]: string | Cat };
const flat = (c: Cat, p = ''): Record<string, string> =>
  Object.entries(c).reduce<Record<string, string>>(
    (acc, [k, v]) => Object.assign(acc, typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`)),
    {},
  );

const PH = /\{\{\s*(\w+)\s*\}\}/g;
const ph = (s: string) => [...s.matchAll(PH)].map((m) => m[1]).sort();

type Catalogue = {
  name: string;
  dir: string;
  en: Record<string, string>;
  hi: Record<string, string>;
  te: Record<string, string>;
  reviewFile: string | null;
};

function loadCatalogue(name: string, dir: string): Catalogue {
  const enPath = path.join(dir, 'en.json');
  const hiPath = path.join(dir, 'hi.json');
  const tePath = path.join(dir, 'te.json');
  const reviewPath = path.join(dir, 'review.json');
  return {
    name,
    dir,
    en: flat(JSON.parse(fs.readFileSync(enPath, 'utf8'))),
    hi: flat(JSON.parse(fs.readFileSync(hiPath, 'utf8'))),
    te: flat(JSON.parse(fs.readFileSync(tePath, 'utf8'))),
    reviewFile: fs.existsSync(reviewPath) ? reviewPath : null,
  };
}

const FEATURES = path.resolve(__dirname, '..', 'features');
const catalogues: Catalogue[] = [
  loadCatalogue('field', path.join(FEATURES, 'field', 'i18n', 'locales')),
  loadCatalogue('care', path.join(FEATURES, 'care', 'i18n', 'locales')),
  loadCatalogue('fieldOps', path.join(FEATURES, 'fieldOps', 'i18n', 'locales')),
  loadCatalogue('account', path.join(FEATURES, 'account', 'i18n', 'locales')),
];

describe.each(catalogues)('X-I: $name catalogue', ({ name, en, hi, te, reviewFile }) => {
  const enKeys = Object.keys(en).sort();

  test('X-I01 HI and TE have every EN key', () => {
    expect(enKeys.length).toBeGreaterThan(50);
    const hiKeys = Object.keys(hi).sort();
    const teKeys = Object.keys(te).sort();
    const missingHi = enKeys.filter((k) => !hi[k] && hi[k] !== '');
    const missingTe = enKeys.filter((k) => !te[k] && te[k] !== '');
    expect({ catalogue: name, missing_hi: missingHi }).toEqual({ catalogue: name, missing_hi: [] });
    expect({ catalogue: name, missing_te: missingTe }).toEqual({ catalogue: name, missing_te: [] });
    expect(hiKeys).toEqual(enKeys);
    expect(teKeys).toEqual(enKeys);
  });

  test('X-I02 no HI/TE value is a copy of the EN value (untranslated)', () => {
    const copies: string[] = [];
    for (const k of enKeys) {
      const english = en[k]!.replace(PH, '').replace(/<\/?b>/g, '').trim();
      // Skip short strings, numbers-only, and proper nouns (e.g. "BSAH", "Cadet Squire")
      if (english.length < 6 || !/[a-z]{4,}/.test(english)) continue;
      if (hi[k] === en[k]) copies.push(`hi:${k}`);
      if (te[k] === en[k]) copies.push(`te:${k}`);
    }
    expect({ catalogue: name, untranslated: copies }).toEqual({ catalogue: name, untranslated: [] });
  });

  test('X-I03 placeholder parity: EN placeholders match HI and TE for every key', () => {
    const mismatches: string[] = [];
    for (const k of enKeys) {
      const enPh = ph(en[k]!);
      if (ph(hi[k]!).join(',') !== enPh.join(',')) mismatches.push(`hi:${k}`);
      if (ph(te[k]!).join(',') !== enPh.join(',')) mismatches.push(`te:${k}`);
    }
    expect({ catalogue: name, placeholderMismatches: mismatches }).toEqual({
      catalogue: name,
      placeholderMismatches: [],
    });
  });

  test('X-I04 every key has a review.json entry flagged needs-native-review', () => {
    if (!reviewFile) {
      throw new Error(`${name}: no review.json — every catalogue must track native-review status`);
    }
    const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8')) as Record<string, Record<string, string>>;
    const reviewKeys = Object.keys(review).sort();
    expect(reviewKeys).toEqual(enKeys);
    for (const k of enKeys) {
      const entry = review[k]!;
      // Two formats: { review: "needs-native-review ..." } or { hi: "needs-native-review ...", te: "..." }
      const hasReviewField =
        (typeof entry.review === 'string' && entry.review.startsWith('needs-native-review')) ||
        (typeof entry.hi === 'string' &&
          entry.hi.startsWith('needs-native-review') &&
          typeof entry.te === 'string' &&
          entry.te.startsWith('needs-native-review'));
      expect({ key: k, flagged: hasReviewField }).toEqual({ key: k, flagged: true });
    }
  });
});
