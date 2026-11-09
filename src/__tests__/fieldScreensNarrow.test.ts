/**
 * @jest-environment node
 */
// Narrow-screen (320px) Hindi/Telugu string length audit: flags Field Ops strings that are likely
// to clip or overflow at 320px width. Hindi and Telugu text is typically 20-40% longer than English;
// this test catches strings that exceed safe thresholds and verifies the typography system's
// script adjustments work correctly.
//
// This is a heuristic, NOT a pixel-accurate rendering check. Actual rendering on a 320px device
// has NOT been done — label "untested on device". All HI/TE translations are machine-assisted
// drafts that need native-speaker review before release.
import fs from 'fs';
import path from 'path';

type Cat = { [k: string]: string | Cat };
const flat = (c: Cat, p = ''): Record<string, string> =>
  Object.entries(c).reduce<Record<string, string>>(
    (acc, [k, v]) => Object.assign(acc, typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`)),
    {},
  );

const FEATURES = path.resolve(__dirname, '..', 'features');

function loadLocales(subdir: string) {
  const dir = path.join(FEATURES, subdir);
  return {
    en: flat(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'))),
    hi: flat(JSON.parse(fs.readFileSync(path.join(dir, 'hi.json'), 'utf8'))),
    te: flat(JSON.parse(fs.readFileSync(path.join(dir, 'te.json'), 'utf8'))),
  };
}

const catalogues = [
  { name: 'field', ...loadLocales('field/i18n/locales') },
  { name: 'care', ...loadLocales('care/i18n/locales') },
  { name: 'fieldOps', ...loadLocales('fieldOps/i18n/locales') },
];

// At 320px with 20px screenInset on each side, the usable width is 280px.
// At 16px body fontSize, that's roughly 35 English characters.
// Button labels (16px, 600wt) with padding: ~25 characters.
// Section headers (22px, serif): ~20 characters.
// Only match keys that ARE button labels: end with a button-like word AND are not inside
// error/body/hint/consequence/subtitle namespaces (which contain explanatory text, not labels).
const isButton = (k: string): boolean => {
  if (/\.(action|submit|save|send|publish|retry|cancel|scan|void|correct|record|open|allow|close|back)$/i.test(k)) {
    return !/errors?\.|Body|Hint|consequence|subtitle|Desc/i.test(k);
  }
  return false;
};
const isHeader = (k: string): boolean => /\.(title|eyebrow)$/i.test(k) && !/errors?\./i.test(k);

// Character-count limits at 320px (approximate, generous to avoid false positives).
// Hindi/Telugu characters are roughly 1.0-1.2x the width of Latin characters at the same font size,
// but the strings themselves tend to have more characters.
const BODY_CHAR_LIMIT = 160; // multiline body text, per string (not per line)
const BUTTON_CHAR_LIMIT = 40; // single-line button label
const HEADER_CHAR_LIMIT = 50; // section header

function charCount(s: string): number {
  // Strip placeholders — they'll be filled with short values
  return s.replace(/\{\{\s*\w+\s*\}\}/g, '____').length;
}

describe.each(catalogues)('N: $name at 320px', ({ name, en, hi, te }) => {
  const keys = Object.keys(en);

  test('N-01 button labels fit at 320px in HI and TE', () => {
    const tooLong: string[] = [];
    for (const k of keys) {
      if (!isButton(k)) continue;
      for (const [locale, cat] of [['hi', hi], ['te', te]] as const) {
        const len = charCount(cat[k]!);
        if (len > BUTTON_CHAR_LIMIT) {
          tooLong.push(`${locale}:${k} (${len} chars, limit ${BUTTON_CHAR_LIMIT}): "${cat[k]}"`);
        }
      }
    }
    expect({ catalogue: name, longButtons: tooLong }).toEqual({ catalogue: name, longButtons: [] });
  });

  test('N-02 headers fit at 320px in HI and TE', () => {
    const tooLong: string[] = [];
    for (const k of keys) {
      if (!isHeader(k)) continue;
      for (const [locale, cat] of [['hi', hi], ['te', te]] as const) {
        const len = charCount(cat[k]!);
        if (len > HEADER_CHAR_LIMIT) {
          tooLong.push(`${locale}:${k} (${len} chars, limit ${HEADER_CHAR_LIMIT}): "${cat[k]}"`);
        }
      }
    }
    expect({ catalogue: name, longHeaders: tooLong }).toEqual({ catalogue: name, longHeaders: [] });
  });

  test('N-03 body text stays within reasonable bounds in HI and TE', () => {
    const tooLong: string[] = [];
    for (const k of keys) {
      // Skip button and header keys (checked above)
      if (isButton(k) || isHeader(k)) continue;
      for (const [locale, cat] of [['hi', hi], ['te', te]] as const) {
        const len = charCount(cat[k]!);
        if (len > BODY_CHAR_LIMIT) {
          tooLong.push(`${locale}:${k} (${len} chars, limit ${BODY_CHAR_LIMIT}): "${cat[k]!.slice(0, 60)}…"`);
        }
      }
    }
    // These are warnings, not hard failures — long body text wraps.
    // We record them but only fail if a dramatic outlier exists (>2x the limit).
    const dramatic = tooLong.filter((s) => {
      const m = s.match(/\((\d+) chars/);
      return m && parseInt(m[1]!, 10) > BODY_CHAR_LIMIT * 2;
    });
    expect({ catalogue: name, dramaticOverflow: dramatic }).toEqual({ catalogue: name, dramaticOverflow: [] });
  });
});

describe('Typography script adjustment', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { adjustForScript, typography } = require('../ui/tokens/typography') as {
    adjustForScript: <T extends { fontSize: number; lineHeight: number; letterSpacing?: number }>(
      style: T,
      text: string,
    ) => T;
    typography: Record<string, { fontSize: number; lineHeight: number; letterSpacing?: number; maxFontSizeMultiplier?: number }>;
  };

  test('N-04 adjustForScript removes letterSpacing and widens lineHeight for Devanagari', () => {
    const base = { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 };
    const adjusted = adjustForScript(base, 'आज का काम');
    expect(adjusted.letterSpacing).toBe(0);
    expect(adjusted.lineHeight).toBeGreaterThanOrEqual(Math.round(22 * 1.5));
  });

  test('N-05 adjustForScript removes letterSpacing and widens lineHeight for Telugu', () => {
    const base = { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 };
    const adjusted = adjustForScript(base, 'నేటి పని');
    expect(adjusted.letterSpacing).toBe(0);
    expect(adjusted.lineHeight).toBeGreaterThanOrEqual(Math.round(22 * 1.5));
  });

  test('N-06 adjustForScript leaves Latin text unchanged', () => {
    const base = { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 };
    const adjusted = adjustForScript(base, 'Today');
    expect(adjusted).toEqual(base);
  });

  test('N-07 body text maxFontSizeMultiplier is uncapped (unlimited OS scaling)', () => {
    expect(typography.body!.maxFontSizeMultiplier).toBeUndefined();
    expect(typography.secondary!.maxFontSizeMultiplier).toBeUndefined();
  });

  test('N-08 display and title cap scaling to prevent hero overflow at 200%', () => {
    expect(typography.display!.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
    expect(typography.title!.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
  });
});
