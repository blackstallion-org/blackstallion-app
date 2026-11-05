/**
 * Type roles. Brand families (Bodoni Moda, Pinyon Script, Inter — all OFL) come from ONE mapping (BRAND_FONTS);
 * components never name a font family themselves. Hindi/Telugu text falls back to the platform fonts (FONT_STACK),
 * which carry Devanagari and Telugu glyphs; the brand families do not.
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
  | 'overline'
  // Copperplate/Spencerian-style script: greetings and short hero titles ONLY
  | 'script';

export type FontWeight = '400' | '500' | '600' | '700';

/**
 * Three families (6 Nov 2026 redesign), all SIL Open Font License, bundled with expo-font:
 *  serif  — Bodoni Moda (high-contrast Didone): screen titles, section heads, editorial display
 *  script — Pinyon Script (Spencerian/Copperplate): greetings and short hero titles only
 *  sans   — Inter: everything functional (body, buttons, labels, scores, money, forms, navigation)
 */
export type FontFamilyRole = 'serif' | 'script' | 'sans';

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
  /** Default sans. */
  family?: FontFamilyRole;
};

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 56, lineHeight: 62, fontWeight: '400', letterSpacing: -0.5, maxFontSizeMultiplier: 1.2, family: 'serif' },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '500', letterSpacing: -0.3, maxFontSizeMultiplier: 1.4, family: 'serif' },
  section: { fontSize: 22, lineHeight: 28, fontWeight: '500', maxFontSizeMultiplier: 1.8, family: 'serif' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '600', maxFontSizeMultiplier: 1.8 },
  secondary: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.2, maxFontSizeMultiplier: 2 },
  score: { fontSize: 32, lineHeight: 38, fontWeight: '500', maxFontSizeMultiplier: 1.4, fontVariant: ['tabular-nums'] },
  // Aliases (pre-redesign screens). Sentence case only: no decorative all-caps.
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '500', maxFontSizeMultiplier: 1.8, family: 'serif' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  overline: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 1.6 },
  script: { fontSize: 52, lineHeight: 68, fontWeight: '400', maxFontSizeMultiplier: 1.2, family: 'script' },
};

/** Editorial display scales with the window: 44 (320 pt phones) → 64 (large phones). */
export const DISPLAY_MIN = 44;
export const DISPLAY_MAX = 64;
export const displaySize = (windowWidth: number): { fontSize: number; lineHeight: number } => {
  const fontSize = Math.round(Math.min(DISPLAY_MAX, Math.max(DISPLAY_MIN, windowWidth * 0.1436)));
  return { fontSize, lineHeight: Math.round(fontSize * (60 / 56)) };
};

export type FontPlatform = 'ios' | 'android' | 'web';

/** Loaded font names (src/ui/theme/fonts.ts loads exactly these). */
export const BRAND_FONTS: Record<FontFamilyRole, Partial<Record<FontWeight, string>>> = {
  serif: { '400': 'BodoniModa_400Regular', '500': 'BodoniModa_500Medium', '600': 'BodoniModa_600SemiBold', '700': 'BodoniModa_600SemiBold' },
  script: { '400': 'PinyonScript_400Regular', '500': 'PinyonScript_400Regular', '600': 'PinyonScript_400Regular', '700': 'PinyonScript_400Regular' },
  sans: { '400': 'Inter_400Regular', '500': 'Inter_500Medium', '600': 'Inter_600SemiBold', '700': 'Inter_600SemiBold' },
};
export const SERIF_ITALIC = 'BodoniModa_400Regular_Italic';

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
