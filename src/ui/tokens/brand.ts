/**
 * The six authoritative brand colours (design/claude-liquid-glass-brief §3,
 * reference 04). Exact values; never edited for convenience. Brand swatches are
 * not automatically valid text/background pairs: components use the semantic
 * tokens in ./colors, whose pairs are contrast-tested over composited pixels.
 */
export const brand = {
  /** Warm highlight, selected accents. */
  softAmber: '#FFD9A3',
  /** Principal action tint and progress emphasis. */
  goldenHour: '#FFB45C',
  /** Energetic highlights, active details. */
  sunsetOrange: '#F28B2C',
  /** Deep image grading and warm depth. */
  burntSienna: '#C35A1A',
  /** Warm backdrop transition. */
  deepAmber: '#7A2E0B',
  /** Default background; high-contrast foreground on bright fills. */
  richEspresso: '#1A0D06',
} as const;

export type BrandColor = keyof typeof brand;
