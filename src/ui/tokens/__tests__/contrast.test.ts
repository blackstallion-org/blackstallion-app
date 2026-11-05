import { SCREEN_TONES } from '@/ui/screenTones';

import { colorsFor, contrastRatio, glassFor, isLightTone, palette, resolveTone, TONE_COLORS, TONES, type ColorTokens } from '..';

/**
 * 6 Nov 2026 redesign: flat colour blocking. Every screen has ONE dominant tone (ui/screenTones.ts); editorial image
 * cards join a picture to one flat block. Text never sits on a photograph, so every pair below is a flat colour on a
 * flat colour and can be checked exactly. The pairing table in MOBILE_APP_PLANNING/VISUAL_REDESIGN.md lists
 * the same numbers.
 */
type Pair = [fg: keyof ColorTokens, bg: keyof ColorTokens];

// Text pairs: WCAG AA 4.5:1 for normal-size text.
const TEXT: Pair[] = [
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['ink', 'surfaceMuted'],
  ['inkMuted', 'canvas'],
  ['inkMuted', 'surface'],
  ['inkMuted', 'surfaceMuted'],
  ['accentText', 'canvas'],
  ['accentText', 'surface'],
  ['onPrimary', 'primaryFill'],
  ['onSecondary', 'secondaryFill'],
  ['onDestructive', 'destructiveFill'],
  ['infoText', 'infoBg'],
  ['successText', 'successBg'],
  ['successText', 'canvas'],
  ['warningText', 'warningBg'],
  ['warningText', 'canvas'],
  ['dangerText', 'dangerBg'],
  ['dangerText', 'canvas'],
  ['devBannerText', 'devBannerBg'],
];

// Non-text UI boundaries (input borders, focus ring, primary button edge): WCAG 1.4.11 3:1.
const UI: Pair[] = [
  ['borderStrong', 'canvas'],
  ['focus', 'canvas'],
  ['primaryFill', 'canvas'],
  ['accent', 'canvas'],
];

describe.each(TONES.map((t) => [t, TONE_COLORS[t]] as const))('%s tone', (_tone, colors) => {
  test.each(TEXT)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });
  test.each(UI)('ui %s on %s ≥ 3:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });
  // `onPhoto` text is only used inside dark colour blocks (image cards); on light tones it is never used.
  if (!isLightTone(_tone)) {
    test('block text onPhoto and onPhotoMuted on canvas ≥ 4.5:1', () => {
      expect(contrastRatio(colors.onPhoto, colors.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.onPhotoMuted, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test('the palette is exact (owner reference board)', () => {
  expect(palette).toEqual({
    white: '#FFFFFF',
    pearl: '#E8D4C3',
    copper: '#B35727',
    brown: '#4B2C20',
    olive: '#60613D',
    fir: '#36492E',
    burgundy: '#742321',
  });
});

test('every tone uses its palette colour as the one dominant background', () => {
  expect(TONE_COLORS.white.canvas).toBe(palette.white);
  expect(TONE_COLORS.pearl.canvas).toBe(palette.pearl);
  expect(TONE_COLORS.copper.canvas).toBe(palette.copper);
  expect(TONE_COLORS.brown.canvas).toBe(palette.brown);
  expect(TONE_COLORS.olive.canvas).toBe(palette.olive);
  expect(TONE_COLORS.fir.canvas).toBe(palette.fir);
  expect(TONE_COLORS.burgundy.canvas).toBe(palette.burgundy);
});

test('pairings that fail are not used (why some accents differ per tone)', () => {
  // Copper text on pearl is 3.4:1 → pearl uses burgundy accents.
  expect(contrastRatio(palette.copper, palette.pearl)).toBeLessThan(4.5);
  expect(TONE_COLORS.pearl.accentText).toBe(palette.burgundy);
  // Pearl text on copper is 3.4:1 → copper keeps every text white.
  expect(contrastRatio(palette.pearl, palette.copper)).toBeLessThan(4.5);
  expect(TONE_COLORS.copper.inkMuted).not.toBe(palette.pearl);
  // Pearl on olive is 4.45:1 (just under) → olive's muted text is a lighter pearl.
  expect(contrastRatio(palette.pearl, palette.olive)).toBeLessThan(4.5);
  // Copper/fir/burgundy fills next to dark tones fail 3:1 → primary buttons on dark tones are white.
  expect(contrastRatio(palette.copper, palette.brown)).toBeLessThan(3);
  for (const t of ['brown', 'olive', 'fir', 'burgundy'] as const) expect(TONE_COLORS[t].primaryFill).toBe(palette.white);
});

test('surfaces are flat: every glass material is opaque with no blur and no shadow', () => {
  for (const t of TONES) {
    const g = glassFor('light', t);
    expect(g.shadeAlpha).toEqual({ thin: 1, regular: 1, thick: 1 });
    expect(g.blurIntensity).toEqual({ thin: 0, regular: 0, thick: 0 });
    expect(g.shadow).toBe('none');
    expect(g.specularAlpha).toBe(0);
  }
});

test('Dark appearance turns only the white/pearl tones into the deep-brown night tone', () => {
  expect(resolveTone('white', 'dark')).toBe('night');
  expect(resolveTone('pearl', 'dark')).toBe('night');
  expect(resolveTone('fir', 'dark')).toBe('fir');
  expect(colorsFor('dark').canvas).toBe(TONE_COLORS.night.canvas);
  expect(colorsFor('light').canvas).toBe(palette.white);
});

test('screen-to-colour assignments use real tones; copper is never a whole-screen tone', () => {
  const values = Object.values(SCREEN_TONES);
  for (const t of values) expect(TONES).toContain(t);
  expect(values).not.toContain('copper');
  expect(values).not.toContain('night');
  // The white default dominates: at most a dozen screens carry a strong colour.
  expect(values.filter((t) => !isLightTone(t)).length).toBeLessThanOrEqual(12);
});
