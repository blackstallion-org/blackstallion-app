/**
 * System sans for all utility text (DESIGN_SYSTEM.md). The licensed editorial
 * serif is reserved for passport headings and is not part of G2.
 * Sizes are base sizes; the OS text-size setting scales them (allowFontScaling).
 */
export type TextVariant =
  | 'display'
  | 'title'
  | 'headline'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'overline';

export type TypeStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
  /** Upper bound for OS scaling; undefined = unlimited (body copy). */
  maxFontSizeMultiplier?: number;
  textTransform?: 'uppercase';
};

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.4, maxFontSizeMultiplier: 1.6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.3, maxFontSizeMultiplier: 1.7 },
  headline: { fontSize: 20, lineHeight: 26, fontWeight: '600', maxFontSizeMultiplier: 2 },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
};
