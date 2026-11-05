/**
 * The BSAH palette (owner-supplied Pantone-inspired reference, 6 Nov 2026). Exact values; never edited for
 * convenience. Swatches are not automatically valid text/background pairs: components use the semantic tokens in
 * ./colors, whose pairs are contrast-tested (tokens/__tests__/contrast.test.ts).
 */
export const palette = {
  /** Flat White — primary app canvas. */
  white: '#FFFFFF',
  /** Mother of Pearl (12-1006 TCX, #E9D4C3 in the reference) — secondary surfaces, rules, muted text on dark. */
  pearl: '#E8D4C3',
  /** Copper Skillet (20-0058 TPM) — editorial accents and the primary action on white. */
  copper: '#B35727',
  /** 4625 C — primary dark surfaces and body text on light. */
  brown: '#4B2C20',
  /** Pesto (18-0228 TCX) — Field Ops. */
  olive: '#60613D',
  /** Douglas Fir (19-0220 TCX, #36492E) — training, horse care, progress. */
  fir: '#36492E',
  /** Deep burgundy (the reference's "Aura Orange" card as printed) — heritage and audio surfaces. */
  burgundy: '#742321',
} as const;

export type PaletteColor = keyof typeof palette;

/** @deprecated kept for imports that predate the 6 Nov palette; maps to the new colours. */
export const brand = {
  softAmber: palette.pearl,
  goldenHour: palette.copper,
  sunsetOrange: palette.copper,
  burntSienna: palette.copper,
  deepAmber: palette.burgundy,
  richEspresso: palette.brown,
} as const;

export type BrandColor = keyof typeof brand;
