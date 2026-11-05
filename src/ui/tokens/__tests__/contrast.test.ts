import {
  brand,
  compositeOver,
  contrastRatio,
  darkColors,
  darkGlass,
  glassComposite,
  lightColors,
  lightGlass,
  PHOTO_TEXT_MIN_SCRIM,
  SCRIM_TEXT_ZONES,
  scrimAlphaAt,
  scrims,
  type ColorTokens,
  type GlassMaterial,
  type ScrimName,
} from '..';

type Pair = [fg: keyof ColorTokens, bg: keyof ColorTokens];

/**
 * Pixel samples from mobile/assets/editorial/*.jpg (the actual derivatives in the
 * repo), measured with PIL: `Image.resize((w // 72, h // 72), Image.BOX)` gives
 * the mean of each 72×72 px patch, which approximates what a blurred glass
 * layer sits on. `xy` is the patch's top-left in the derivative. Brightest and
 * darkest patches were taken over the whole image and over the region where UI
 * sits on each screen. Re-measure if an image is replaced.
 */
const SAMPLES = {
  authBrightest: { hex: '#FCF4E3', file: 'auth-hero.jpg', xy: [216, 144], note: 'sunset sky, top-left' },
  authFormBright: { hex: '#7C4C2B', file: 'auth-hero.jpg', xy: [648, 1008], note: 'brightest patch in lower 45% (form area)' },
  authDarkest: { hex: '#120A07', file: 'auth-hero.jpg', xy: [1008, 1800], note: 'lower right' },
  familyBrightest: { hex: '#FDF7E7', file: 'family-hero.jpg', xy: [1008, 0], note: 'sun, top-right' },
  familyCopyBright: { hex: '#A66D41', file: 'family-hero.jpg', xy: [1008, 936], note: 'brightest patch in lower 35% (hero copy)' },
  familyDarkest: { hex: '#140D08', file: 'family-hero.jpg', xy: [0, 1224], note: 'arena shadow, lower-left' },
  sparkBrightest: { hex: '#FDEDBC', file: 'spark-cover.jpg', xy: [288, 0], note: 'backlight haze, top' },
  sparkTitleBright: { hex: '#F7A23B', file: 'spark-cover.jpg', xy: [360, 648], note: 'brightest patch in 35–60% band (title)' },
  sparkControlsBright: { hex: '#F09633', file: 'spark-cover.jpg', xy: [360, 720], note: 'brightest patch in lower 60% (transport)' },
  sparkDarkest: { hex: '#090200', file: 'spark-cover.jpg', xy: [1008, 1800], note: 'bottom-right' },
  horseBrightest: { hex: '#FAE7B9', file: 'horse-portrait.jpg', xy: [216, 216], note: 'window light' },
  horseDarkest: { hex: '#060301', file: 'horse-portrait.jpg', xy: [288, 1224], note: 'stable floor' },
  communityBrightest: { hex: '#FDF6D7', file: 'community-event.jpg', xy: [1368, 72], note: 'sky' },
  passportBrightest: { hex: '#915C34', file: 'passport-art.jpg', xy: [0, 864], note: 'lit walnut' },
} as const;

const ALL_SAMPLES = Object.entries(SAMPLES);

// Text pairs on opaque tokens: WCAG AA 4.5:1 for normal-size text.
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
  ['warningText', 'warningBg'],
  ['dangerText', 'dangerBg'],
  ['dangerText', 'surface'],
  ['devBannerText', 'devBannerBg'],
];

// Non-text UI boundaries (input borders, focus ring, primary button edge): WCAG 1.4.11 3:1.
const UI: Pair[] = [
  ['borderStrong', 'canvas'],
  ['borderStrong', 'surface'],
  ['focus', 'surface'],
  ['focus', 'canvas'],
  ['primaryFill', 'canvas'],
];

describe.each([
  ['dark (default espresso)', darkColors],
  ['light (warm paper)', lightColors],
])('%s theme: opaque token pairs', (_name, colors) => {
  test.each(TEXT)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });
  test.each(UI)('ui %s on %s ≥ 3:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });
});

const MATERIALS: GlassMaterial[] = ['thin', 'regular', 'thick'];

describe.each([
  ['dark', darkColors, darkGlass],
  ['light', lightColors, lightGlass],
])('%s theme: glass composited over its own canvas', (_n, colors, glass) => {
  test.each(MATERIALS)('%s glass: ink, muted and accent text ≥ 4.5:1', (material) => {
    const bg = glassComposite(glass, material, colors.canvas);
    expect(contrastRatio(colors.ink, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.inkMuted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.accentText, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test.each(MATERIALS)('%s glass over the opaque surface: ink and muted ≥ 4.5:1', (material) => {
    const bg = glassComposite(glass, material, colors.surface);
    expect(contrastRatio(colors.ink, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.inkMuted, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('action glass: label ≥ 4.5:1 over canvas and over the brightest and darkest photo pixels', () => {
    for (const backdrop of [colors.canvas, SAMPLES.familyBrightest.hex, SAMPLES.sparkDarkest.hex]) {
      const fill = compositeOver(glass.action.fill, glass.action.alpha, backdrop);
      expect(contrastRatio(glass.action.text, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
  test('destructive glass: label ≥ 4.5:1 over canvas and photo extremes', () => {
    for (const backdrop of [colors.canvas, SAMPLES.familyBrightest.hex, SAMPLES.sparkDarkest.hex]) {
      const fill = compositeOver(glass.destructive.fill, glass.destructive.alpha, backdrop);
      expect(contrastRatio(glass.destructive.text, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
  test('reduced-transparency backing is opaque and readable', () => {
    expect(contrastRatio(colors.ink, glass.opaque)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.inkMuted, glass.opaque)).toBeGreaterThanOrEqual(4.5);
  });
});

/** Photo regions are always rendered in the dark (espresso) scope, in both themes. */
describe('photographs (dark scope, both themes)', () => {
  const scrimmed = (hex: string, alpha = PHOTO_TEXT_MIN_SCRIM) => compositeOver(darkColors.scrim, alpha, hex);

  test.each(ALL_SAMPLES)('thick glass is safe anywhere, even unscrimmed: ink on %s ≥ 4.5:1', (_k, s) => {
    expect(contrastRatio(darkColors.ink, glassComposite(darkGlass, 'thick', s.hex))).toBeGreaterThanOrEqual(4.5);
  });

  test.each(ALL_SAMPLES)('regular glass inside a text zone (scrim ≥ min): ink and muted on %s ≥ 4.5:1', (_k, s) => {
    const bg = glassComposite(darkGlass, 'regular', scrimmed(s.hex));
    expect(contrastRatio(darkColors.ink, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkColors.inkMuted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(ALL_SAMPLES)('photo text inside a text zone: onPhoto on %s ≥ 4.5:1', (_k, s) => {
    expect(contrastRatio(darkColors.onPhoto, scrimmed(s.hex))).toBeGreaterThanOrEqual(4.5);
  });

  test.each(ALL_SAMPLES)('muted photo text needs scrim ≥ 0.75: onPhotoMuted on %s ≥ 4.5:1', (_k, s) => {
    expect(contrastRatio(darkColors.onPhotoMuted, scrimmed(s.hex, 0.75))).toBeGreaterThanOrEqual(4.5);
  });

  test('without a scrim, white text on the bright photo regions fails — scrims are required, not decoration', () => {
    expect(contrastRatio(darkColors.onPhoto, SAMPLES.sparkTitleBright.hex)).toBeLessThan(3);
    expect(contrastRatio(darkColors.onPhoto, glassComposite(darkGlass, 'thin', SAMPLES.familyBrightest.hex))).toBeLessThan(4.5);
  });

  test.each(['auth', 'card', 'spark'] as const)('%s scrim stays ≥ the minimum across its text zone', (name: ScrimName) => {
    const [from, to] = SCRIM_TEXT_ZONES[name];
    for (let o = from; o <= to + 1e-9; o += 0.02) {
      expect(scrimAlphaAt(scrims[name], o)).toBeGreaterThanOrEqual(PHOTO_TEXT_MIN_SCRIM - 1e-9);
    }
  });

  test.each([
    ['dark', darkColors],
    ['light', lightColors],
  ] as const)('fade scrim (canvas-coloured) gives readable %s ink across its text zone', (_n, colors) => {
    const [from, to] = SCRIM_TEXT_ZONES.fade;
    for (let o = from; o <= to + 1e-9; o += 0.05) {
      const a = scrimAlphaAt(scrims.fade, o);
      for (const s of [SAMPLES.authBrightest.hex, SAMPLES.authDarkest.hex, SAMPLES.authFormBright.hex]) {
        const bg = compositeOver(colors.canvas, a, s);
        expect(contrastRatio(colors.ink, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.inkMuted, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('display title on the Spark title band (scrim at zone start) passes large-text 3:1', () => {
    const a = scrimAlphaAt(scrims.spark, SCRIM_TEXT_ZONES.spark[0]);
    expect(contrastRatio(darkColors.onPhoto, compositeOver(darkColors.scrim, a, SAMPLES.sparkTitleBright.hex))).toBeGreaterThanOrEqual(3);
  });
});

test('brand palette is exact (reference 04)', () => {
  expect(brand).toEqual({
    softAmber: '#FFD9A3',
    goldenHour: '#FFB45C',
    sunsetOrange: '#F28B2C',
    burntSienna: '#C35A1A',
    deepAmber: '#7A2E0B',
    richEspresso: '#1A0D06',
  });
});

test('default (dark) canvas is rich espresso and the principal action is golden hour', () => {
  expect(darkColors.canvas).toBe(brand.richEspresso);
  expect(darkColors.primaryFill).toBe(brand.goldenHour);
  expect(darkColors.onPrimary).toBe(brand.richEspresso);
});

test('raw brand swatches are not automatically text colours', () => {
  // Burnt sienna is decorative on warm paper; components use accentText (deep amber) for text.
  expect(contrastRatio(lightColors.accent, lightColors.canvas)).toBeLessThan(4.5);
  expect(contrastRatio(lightColors.accentText, lightColors.canvas)).toBeGreaterThanOrEqual(4.5);
  // Sunset orange fails as small text on espresso-dark glass over bright photos.
  expect(contrastRatio(brand.sunsetOrange, SAMPLES.sparkControlsBright.hex)).toBeLessThan(3);
});
