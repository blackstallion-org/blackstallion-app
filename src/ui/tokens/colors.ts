/**
 * Semantic colour tokens. Screens use semantic names only; raw palette values never appear in components.
 * 6 Nov 2026 redesign: flat editorial colour blocking on a white canvas (see TONE_COLORS below). The "glass" types are
 * kept so existing components compile, but every material now resolves to a flat, opaque surface.
 *
 * Every text pair is asserted in __tests__/contrast.test.ts, including over
 * COMPOSITED colours: glass tint over espresso and over pixels sampled from the
 * editorial photographs.
 */
import { palette } from './brand';
import { compositeOver } from './contrast';

export type ColorSchemeName = 'light' | 'dark';

export type ColorTokens = {
  /** Ambient base behind everything. */
  canvas: string;
  /** Warm light added to the top of the canvas (gradient colour, used translucent). */
  canvasGlow: string;
  /** Opaque raised surface (skeletons, opaque fallbacks). */
  surface: string;
  surfaceMuted: string;
  ink: string;
  inkMuted: string;
  border: string;
  /** Input borders and other non-text boundaries (≥ 3:1). */
  borderStrong: string;
  /** Decorative accent: rules, icons, large display only. */
  accent: string;
  /** Accent tone that meets 4.5:1 as small text. */
  accentText: string;
  /** Principal action fill (glass "action" material, near-opaque). */
  primaryFill: string;
  onPrimary: string;
  /** Secondary action: glass; the text colour on it. */
  secondaryFill: string;
  onSecondary: string;
  destructiveFill: string;
  onDestructive: string;
  focus: string;
  infoBg: string;
  infoText: string;
  successBg: string;
  successText: string;
  warningBg: string;
  warningText: string;
  dangerBg: string;
  dangerText: string;
  skeleton: string;
  devBannerBg: string;
  devBannerText: string;
  /** Scrim colour laid over photographs (always espresso). */
  scrim: string;
  /** Text directly on a scrimmed photograph. */
  onPhoto: string;
  onPhotoMuted: string;
};

export type GlassMaterial = 'thin' | 'regular' | 'thick';

/**
 * One glass recipe per scheme. Layers, bottom → top: backdrop (blurred), shade
 * (darkens/lightens toward the scheme), frost (warm milky lift), rim + specular
 * edge, inner highlight. Alphas are numbers so tests can composite them.
 */
export type GlassTokens = {
  shade: string;
  shadeAlpha: Record<GlassMaterial, number>;
  frost: string;
  frostAlpha: Record<GlassMaterial, number>;
  /** Reduce Transparency / no-blur backing: opaque warm colour. */
  opaque: string;
  opaqueBorder: string;
  /** expo-blur intensity (1–100) and web blur radius (px) per material. */
  blurIntensity: Record<GlassMaterial, number>;
  webBlur: Record<GlassMaterial, number>;
  webSaturate: number;
  rim: string;
  rimAlpha: number;
  specular: string;
  specularAlpha: number;
  innerHighlightAlpha: number;
  /** CSS box-shadow string (RN 0.76+ and web). */
  shadow: string;
  /** iOS 26 GlassView tint (rgba string). */
  liquidTint: string;
  action: { fill: string; alpha: number; text: string; rim: string };
  destructive: { fill: string; alpha: number; text: string; rim: string };
};

/**
 * Screen tones (6 Nov 2026 redesign): ONE flat, fully opaque background per screen, one text colour, at most one
 * restrained accent. No gradients, glows, fades or translucent layers. Light tones carry dark-brown text; dark tones
 * carry white text. Pairings are WCAG-tested in __tests__/contrast.test.ts.
 */
export type Tone = 'white' | 'pearl' | 'copper' | 'brown' | 'olive' | 'fir' | 'burgundy' | 'night';
export const TONES: readonly Tone[] = ['white', 'pearl', 'copper', 'brown', 'olive', 'fir', 'burgundy', 'night'];
export const LIGHT_TONES: readonly Tone[] = ['white', 'pearl'];

/** Deep brown used for the white/pearl tones when the person chooses Dark appearance. */
const NIGHT = '#24150F';

const mix = (fg: string, alpha: number, bg: string) => compositeOver(fg, alpha, bg);

const lightTone = (canvas: string, o: Partial<ColorTokens> = {}): ColorTokens => ({
  canvas,
  canvasGlow: canvas,
  surface: canvas,
  surfaceMuted: mix(palette.pearl, 0.35, canvas),
  ink: palette.brown,
  inkMuted: '#6A4A3B',
  border: palette.pearl,
  borderStrong: '#8C6C5B',
  accent: palette.copper,
  accentText: palette.copper,
  primaryFill: palette.copper,
  onPrimary: palette.white,
  secondaryFill: canvas,
  onSecondary: palette.brown,
  destructiveFill: palette.burgundy,
  onDestructive: palette.white,
  focus: palette.copper,
  infoBg: mix(palette.pearl, 0.35, canvas),
  infoText: palette.brown,
  successBg: mix(palette.fir, 0.08, canvas),
  successText: palette.fir,
  warningBg: mix(palette.copper, 0.1, canvas),
  warningText: '#8A3F18',
  dangerBg: mix(palette.burgundy, 0.08, canvas),
  dangerText: palette.burgundy,
  skeleton: mix(palette.pearl, 0.45, canvas),
  devBannerBg: mix(palette.pearl, 0.35, canvas),
  devBannerText: palette.brown,
  scrim: palette.brown,
  onPhoto: palette.white,
  onPhotoMuted: palette.pearl,
  ...o,
});

const darkTone = (canvas: string, o: Partial<ColorTokens> = {}): ColorTokens => ({
  canvas,
  canvasGlow: canvas,
  surface: canvas,
  surfaceMuted: mix(palette.white, 0.08, canvas),
  ink: palette.white,
  inkMuted: palette.pearl,
  border: mix(palette.white, 0.22, canvas),
  borderStrong: palette.pearl,
  accent: palette.pearl,
  accentText: palette.pearl,
  primaryFill: palette.white,
  onPrimary: canvas,
  secondaryFill: canvas,
  onSecondary: palette.white,
  destructiveFill: palette.white,
  onDestructive: palette.burgundy,
  focus: palette.white,
  infoBg: mix(palette.white, 0.08, canvas),
  infoText: palette.white,
  successBg: mix(palette.white, 0.08, canvas),
  successText: '#DCE8D3',
  warningBg: mix(palette.white, 0.08, canvas),
  warningText: '#F8DCC8',
  dangerBg: mix(palette.white, 0.08, canvas),
  dangerText: '#F9D4CF',
  skeleton: mix(palette.white, 0.12, canvas),
  devBannerBg: mix(palette.white, 0.08, canvas),
  devBannerText: palette.white,
  scrim: canvas,
  onPhoto: palette.white,
  onPhotoMuted: palette.pearl,
  ...o,
});

/** White-on-copper is 4.87:1, so copper keeps every text white (no muted pearl, which is only 3.4:1). */
const onCopper = '#FFF7F2';

export const TONE_COLORS: Record<Tone, ColorTokens> = {
  white: lightTone(palette.white),
  pearl: lightTone(palette.pearl, {
    surfaceMuted: mix(palette.white, 0.35, palette.pearl),
    inkMuted: '#5A3B2E',
    border: '#CDB3A0',
    borderStrong: '#7E5F4F',
    accent: palette.burgundy,
    accentText: palette.burgundy,
    primaryFill: palette.brown,
    warningText: '#7A3412',
    infoBg: mix(palette.white, 0.35, palette.pearl),
    successBg: mix(palette.white, 0.35, palette.pearl),
    warningBg: mix(palette.white, 0.35, palette.pearl),
    dangerBg: mix(palette.white, 0.35, palette.pearl),
    skeleton: mix(palette.white, 0.4, palette.pearl),
    devBannerBg: mix(palette.white, 0.35, palette.pearl),
  }),
  copper: darkTone(palette.copper, {
    // Raised/status panels on copper go slightly DARKER (brown mixed in), never lighter: white needs ≥ 4.5:1.
    surfaceMuted: mix(palette.brown, 0.15, palette.copper),
    infoBg: mix(palette.brown, 0.15, palette.copper),
    successBg: mix(palette.brown, 0.15, palette.copper),
    warningBg: mix(palette.brown, 0.15, palette.copper),
    dangerBg: mix(palette.brown, 0.15, palette.copper),
    devBannerBg: mix(palette.brown, 0.15, palette.copper),
    skeleton: mix(palette.brown, 0.2, palette.copper),
    inkMuted: onCopper,
    accent: palette.white,
    accentText: palette.white,
    borderStrong: palette.white,
    successText: palette.white,
    warningText: palette.white,
    dangerText: palette.white,
    onPhotoMuted: palette.white,
  }),
  brown: darkTone(palette.brown),
  olive: darkTone(palette.olive, {
    inkMuted: '#F6EEE7',
    accent: palette.white,
    accentText: palette.white,
    borderStrong: palette.white,
    successText: palette.white,
    warningText: palette.white,
    dangerText: palette.white,
    onPhotoMuted: '#F6EEE7',
  }),
  fir: darkTone(palette.fir),
  burgundy: darkTone(palette.burgundy, { onDestructive: palette.burgundy }),
  night: darkTone(NIGHT, { accent: palette.copper, accentText: '#E7A57F', primaryFill: palette.copper, onPrimary: palette.white }),
};

/** The tone in effect: in Dark appearance the white/pearl tones become the deep-brown night tone. */
export const resolveTone = (tone: Tone, scheme: ColorSchemeName): Tone => (scheme === 'dark' && (tone === 'white' || tone === 'pearl') ? 'night' : tone);
export const isLightTone = (tone: Tone): boolean => LIGHT_TONES.includes(tone);

export const lightColors: ColorTokens = TONE_COLORS.white;
export const darkColors: ColorTokens = TONE_COLORS.night;

/** Flat "glass": every material is the opaque tone surface with a hairline; no blur, no shadow, no sheen. */
const flatGlass = (c: ColorTokens): GlassTokens => ({
  shade: c.surface,
  shadeAlpha: { thin: 1, regular: 1, thick: 1 },
  frost: c.surface,
  frostAlpha: { thin: 0, regular: 0, thick: 0 },
  opaque: c.surface,
  opaqueBorder: c.border,
  blurIntensity: { thin: 0, regular: 0, thick: 0 },
  webBlur: { thin: 0, regular: 0, thick: 0 },
  webSaturate: 1,
  rim: c.border,
  rimAlpha: 1,
  specular: c.surface,
  specularAlpha: 0,
  innerHighlightAlpha: 0,
  shadow: 'none',
  liquidTint: 'transparent',
  action: { fill: c.primaryFill, alpha: 1, text: c.onPrimary, rim: c.primaryFill },
  destructive: { fill: c.destructiveFill, alpha: 1, text: c.onDestructive, rim: c.destructiveFill },
});

export const lightGlass: GlassTokens = flatGlass(lightColors);
export const darkGlass: GlassTokens = flatGlass(darkColors);
export const glassForColors = flatGlass;

/**
 * Espresso scrims for photographs, as gradient stops (offset 0–1, alpha).
 * Contract (contrast tests): wherever text or glass sits on a photo, the scrim
 * alpha there is ≥ PHOTO_TEXT_MIN_SCRIM.
 */
export const PHOTO_TEXT_MIN_SCRIM = 0.6;

export type ScrimStop = readonly [offset: number, alpha: number];
export const scrims = {
  /** Sign-in: status-bar shade at top, deep fade under the form. */
  auth: [
    [0, 0.62],
    [0.16, 0.18],
    [0.36, 0.08],
    [0.54, 0.6],
    [0.7, 0.86],
    [1, 0.97],
  ],
  /** Photo cards: quiet top band for chips, deep bottom for copy. */
  card: [
    [0, 0.6],
    [0.2, 0.12],
    [0.45, 0.1],
    [0.66, 0.62],
    [1, 0.9],
  ],
  /** Spark: amber glow stays at the top; title and transport sit on ≥ 0.6. */
  spark: [
    [0, 0.28],
    [0.22, 0.06],
    [0.36, 0.36],
    [0.44, 0.6],
    [0.7, 0.8],
    [1, 0.94],
  ],
  /** Image fading into the CANVAS colour (not espresso): light-theme sign-in, page heads. */
  fade: [
    [0, 0.45],
    [0.2, 0.05],
    [0.55, 0.35],
    [0.8, 0.92],
    [1, 1],
  ],
} as const satisfies Record<string, readonly ScrimStop[]>;

export type ScrimName = keyof typeof scrims;

/**
 * Where each scrim promises text-safe darkness (offset range, 0 = top). Screens
 * place photo text and glass only inside these zones (or use thick glass).
 */
export const SCRIM_TEXT_ZONES: Record<ScrimName, readonly [from: number, to: number]> = {
  auth: [0.54, 1],
  card: [0.66, 1],
  spark: [0.44, 1],
  fade: [0.8, 1],
};

/** Scrim alpha at an offset (linear between stops). */
export const scrimAlphaAt = (stops: readonly ScrimStop[], offset: number): number => {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (offset <= first[0]) return first[1];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (offset <= b[0]) return a[1] + ((offset - a[0]) / (b[0] - a[0] || 1)) * (b[1] - a[1]);
  }
  return last[1];
};

export const colorsFor = (scheme: ColorSchemeName, tone: Tone = 'white'): ColorTokens => TONE_COLORS[resolveTone(tone, scheme)];
export const glassFor = (scheme: ColorSchemeName, tone: Tone = 'white'): GlassTokens => flatGlass(colorsFor(scheme, tone));

/** The opaque colour a glass material resolves to over an opaque backdrop (for tests and fallbacks). */
export const glassComposite = (g: GlassTokens, material: GlassMaterial, backdrop: string): string =>
  compositeOver(g.frost, g.frostAlpha[material], compositeOver(g.shade, g.shadeAlpha[material], backdrop));
