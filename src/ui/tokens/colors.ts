/**
 * Semantic colour and glass-material tokens (DESIGN_SYSTEM.md, liquid-glass
 * brief §3). Screens use semantic names only; raw brand values never appear in
 * components. Default theme is espresso/amber ("dark"); "light" is a designed
 * warm-paper variant, not the old white theme.
 *
 * Every text pair is asserted in __tests__/contrast.test.ts, including over
 * COMPOSITED colours: glass tint over espresso and over pixels sampled from the
 * editorial photographs.
 */
import { brand } from './brand';
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

/** Espresso / amber: the default theme. */
export const darkColors: ColorTokens = {
  canvas: brand.richEspresso,
  canvasGlow: brand.deepAmber,
  surface: '#2A170C',
  surfaceMuted: '#341E11',
  ink: '#FFF6EC',
  inkMuted: '#E2CDBA',
  border: '#4A3122',
  borderStrong: '#A8866C',
  accent: brand.goldenHour,
  accentText: brand.softAmber,
  primaryFill: brand.goldenHour,
  onPrimary: brand.richEspresso,
  secondaryFill: '#33231A',
  onSecondary: '#FFF6EC',
  destructiveFill: '#7C1D10',
  onDestructive: '#FFE6DD',
  focus: brand.softAmber,
  infoBg: '#18222F',
  infoText: '#BCD5F3',
  successBg: '#15291B',
  successText: '#AEE0B7',
  warningBg: '#3A250E',
  warningText: '#FFD596',
  dangerBg: '#3E1710',
  dangerText: '#FFB8A8',
  skeleton: '#3A2517',
  devBannerBg: '#3B2B0D',
  devBannerText: '#FFE3A8',
  scrim: brand.richEspresso,
  onPhoto: '#FFF6EC',
  onPhotoMuted: '#EAD8C6',
};

/** Warm paper: the deliberately designed light variant. */
export const lightColors: ColorTokens = {
  canvas: '#FBF1E4',
  canvasGlow: brand.softAmber,
  surface: '#FFF9F1',
  surfaceMuted: '#F3E3CF',
  ink: brand.richEspresso,
  inkMuted: '#6B4631',
  border: '#E6D0B8',
  borderStrong: '#9A7253',
  accent: brand.burntSienna,
  accentText: brand.deepAmber,
  primaryFill: brand.deepAmber,
  onPrimary: '#FFE9CC',
  secondaryFill: '#FFF7EC',
  onSecondary: brand.richEspresso,
  destructiveFill: '#9A2A1E',
  onDestructive: '#FFF3EF',
  focus: brand.deepAmber,
  infoBg: '#E6EEF8',
  infoText: '#1F477C',
  successBg: '#E3F0E4',
  successText: '#1D5A2B',
  warningBg: '#FBE9D0',
  warningText: '#744405',
  dangerBg: '#FBE4DE',
  dangerText: '#962A1D',
  skeleton: '#EEDCC6',
  devBannerBg: '#FFF0CC',
  devBannerText: '#5C3D00',
  scrim: brand.richEspresso,
  onPhoto: '#FFF6EC',
  onPhotoMuted: '#EAD8C6',
};

export const darkGlass: GlassTokens = {
  shade: brand.richEspresso,
  shadeAlpha: { thin: 0.2, regular: 0.42, thick: 0.7 },
  frost: '#FFECD6',
  frostAlpha: { thin: 0.08, regular: 0.08, thick: 0.07 },
  opaque: '#2E1A0E',
  opaqueBorder: '#5A3C28',
  blurIntensity: { thin: 30, regular: 45, thick: 70 },
  webBlur: { thin: 14, regular: 22, thick: 30 },
  webSaturate: 1.35,
  rim: '#FFE9D2',
  rimAlpha: 0.2,
  specular: '#FFF4E6',
  specularAlpha: 0.38,
  innerHighlightAlpha: 0.07,
  shadow: '0px 12px 32px rgba(8, 3, 1, 0.42)',
  liquidTint: 'rgba(42, 22, 10, 0.35)',
  action: { fill: brand.goldenHour, alpha: 0.96, text: brand.richEspresso, rim: '#FFE7C2' },
  destructive: { fill: '#7C1D10', alpha: 0.9, text: '#FFE6DD', rim: '#FFB8A8' },
};

export const lightGlass: GlassTokens = {
  shade: '#FFFAF3',
  shadeAlpha: { thin: 0.4, regular: 0.6, thick: 0.8 },
  frost: '#FFFFFF',
  frostAlpha: { thin: 0.1, regular: 0.12, thick: 0.12 },
  opaque: '#FFF8EF',
  opaqueBorder: '#D9BFA4',
  blurIntensity: { thin: 30, regular: 50, thick: 75 },
  webBlur: { thin: 14, regular: 22, thick: 30 },
  webSaturate: 1.2,
  rim: brand.deepAmber,
  rimAlpha: 0.14,
  specular: '#FFFFFF',
  specularAlpha: 0.9,
  innerHighlightAlpha: 0.5,
  shadow: '0px 10px 28px rgba(122, 46, 11, 0.12)',
  liquidTint: 'rgba(255, 246, 234, 0.4)',
  action: { fill: brand.deepAmber, alpha: 0.97, text: '#FFE9CC', rim: '#C35A1A' },
  destructive: { fill: '#9A2A1E', alpha: 0.96, text: '#FFF3EF', rim: '#C9584A' },
};

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

export const colorsFor = (scheme: ColorSchemeName): ColorTokens => (scheme === 'dark' ? darkColors : lightColors);
export const glassFor = (scheme: ColorSchemeName): GlassTokens => (scheme === 'dark' ? darkGlass : lightGlass);

/** The opaque colour a glass material resolves to over an opaque backdrop (for tests and fallbacks). */
export const glassComposite = (g: GlassTokens, material: GlassMaterial, backdrop: string): string =>
  compositeOver(g.frost, g.frostAlpha[material], compositeOver(g.shade, g.shadeAlpha[material], backdrop));
