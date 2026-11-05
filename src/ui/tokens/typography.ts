/**
 * Type roles (liquid-glass brief §3). Exact font identities from the reference
 * screenshots cannot be established, so the app uses the platform system
 * sans-serif through ONE explicit mapping (FONT_STACK below). If licensed font
 * files are supplied later, replace the mapping here; components never name a
 * font family themselves. No Apple fonts are bundled for Android or web.
 *
 * Sizes are base sizes; the OS text-size setting scales them (allowFontScaling
 * stays on). Display and title cap their growth so a hero never overflows;
 * body copy grows without limit.
 */
export type TextVariant =
  // Brief roles
  | 'display'
  | 'title'
  | 'section'
  | 'body'
  | 'button'
  | 'secondary'
  | 'caption'
  | 'score'
  // Compatibility aliases kept for existing screens
  | 'headline'
  | 'bodyStrong'
  | 'label'
  | 'overline';

export type FontWeight = '400' | '500' | '600' | '700';

export type TypeStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  /** Latin only: removed for Devanagari/Telugu (see adjustForScript). */
  letterSpacing?: number;
  /** Upper bound for OS scaling; undefined = unlimited (body copy). */
  maxFontSizeMultiplier?: number;
  /** Tabular numerals where the platform font supports them. */
  fontVariant?: 'tabular-nums'[];
};

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 56, lineHeight: 60, fontWeight: '600', letterSpacing: -1.2, maxFontSizeMultiplier: 1.2 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '600', letterSpacing: -0.5, maxFontSizeMultiplier: 1.4 },
  section: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.2, maxFontSizeMultiplier: 1.8 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '600', maxFontSizeMultiplier: 1.8 },
  secondary: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', maxFontSizeMultiplier: 2 },
  score: { fontSize: 32, lineHeight: 38, fontWeight: '600', maxFontSizeMultiplier: 1.4, fontVariant: ['tabular-nums'] },
  // Aliases (pre-glass screens). Sentence case only: no decorative all-caps.
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.2, maxFontSizeMultiplier: 1.8 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  overline: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
};

/** Editorial display scales with the window: 44 (320 pt phones) → 64 (large phones). */
export const DISPLAY_MIN = 44;
export const DISPLAY_MAX = 64;
export const displaySize = (windowWidth: number): { fontSize: number; lineHeight: number } => {
  const fontSize = Math.round(Math.min(DISPLAY_MAX, Math.max(DISPLAY_MIN, windowWidth * 0.1436)));
  return { fontSize, lineHeight: Math.round(fontSize * (60 / 56)) };
};

export type FontPlatform = 'ios' | 'android' | 'web';

/**
 * Central font mapping. iOS: the system font (SF Pro) by weight. Android: the
 * system sans-serif families, using sans-serif-medium for 500/600 so weights
 * are real rather than synthesised. Web preview: the visitor's system UI font.
 */
export const FONT_STACK: Record<FontPlatform, (weight: FontWeight) => { fontFamily?: string; fontWeight: FontWeight }> = {
  ios: (weight) => ({ fontFamily: 'System', fontWeight: weight }),
  android: (weight) =>
    weight === '400'
      ? { fontFamily: 'sans-serif', fontWeight: '400' }
      : weight === '700'
        ? { fontFamily: 'sans-serif', fontWeight: '700' }
        : { fontFamily: 'sans-serif-medium', fontWeight: '400' },
  web: (weight) => ({
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Telugu", system-ui, sans-serif',
    fontWeight: weight,
  }),
};

const NON_LATIN = /[ऀ-ॿఀ-౿]/; // Devanagari, Telugu

export const isIndicScript = (text: string): boolean => NON_LATIN.test(text);

/**
 * Hindi/Telugu need natural spacing and taller lines for matras and
 * conjuncts: drop tight tracking and give at least 1.5× line height.
 */
export const adjustForScript = <T extends { fontSize: number; lineHeight: number; letterSpacing?: number }>(style: T, text: string): T => {
  if (!isIndicScript(text)) return style;
  return { ...style, letterSpacing: 0, lineHeight: Math.max(style.lineHeight, Math.round(style.fontSize * 1.5)) };
};
