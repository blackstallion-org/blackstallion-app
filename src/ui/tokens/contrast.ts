/**
 * WCAG 2.x contrast for #RRGGBB colours, plus alpha compositing so contrast can
 * be checked over the colour a person actually sees (glass tint over a photo,
 * scrim over a photo), not only over token values. Pure: no React or platform.
 */
export type Rgb = readonly [number, number, number];

export const parseHex = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) throw new Error(`Unsupported colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Source-over compositing of `top` at `alpha` (0–1) onto an opaque `bottom`. */
export const compositeOver = (top: string, alpha: number, bottom: string): string => {
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex([0, 1, 2].map((i) => t[i]! * alpha + b[i]! * (1 - alpha)) as unknown as Rgb);
};

/** Layers listed bottom → top, each `{ color, alpha }`, over an opaque base. */
export const compositeStack = (base: string, layers: readonly { color: string; alpha: number }[]): string =>
  layers.reduce((acc, l) => compositeOver(l.color, l.alpha, acc), base);

/** `#RRGGBB` + alpha → `rgba(r, g, b, a)` for style props. */
export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
