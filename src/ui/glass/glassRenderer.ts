/**
 * Which material renderer a glass surface uses. Pure so it can be unit-tested
 * for every platform/OS combination without a device.
 *
 *  liquid-glass  iOS 26+ (expo-glass-effect GlassView, isLiquidGlassAvailable()).
 *  blur          iOS < 26: expo-blur BlurView + warm tint + specular edge.
 *                Android with a registered BlurTargetView behind the surface
 *                (expo-blur `blurMethod: 'dimezisBlurViewSdk31Plus'`; SDK 58
 *                requires a `blurTarget`, otherwise it would silently fall back).
 *  tint          No blur available (Android without a target, Android < 12) or a
 *                near-opaque fill (action / destructive): translucent warm tint +
 *                edge only. Cheap; no per-row native effect.
 *  css           Web preview: CSS backdrop-filter (+ optional SVG refraction).
 *  opaque        Reduce Transparency: opaque warm backing, no blur, no refraction.
 */
export type GlassRenderer = 'liquid-glass' | 'blur' | 'tint' | 'css' | 'opaque';

export type GlassFill = 'glass' | 'action' | 'destructive' | 'opaque';

export type RendererInput = {
  os: 'ios' | 'android' | 'web' | string;
  liquidGlassAvailable: boolean;
  reduceTransparency: boolean;
  hasBlurTarget: boolean;
  fill: GlassFill;
};

export function selectGlassRenderer({ os, liquidGlassAvailable, reduceTransparency, hasBlurTarget, fill }: RendererInput): GlassRenderer {
  if (reduceTransparency || fill === 'opaque') return 'opaque';
  if (os === 'web') return 'css';
  if (fill !== 'glass') return 'tint';
  if (os === 'ios') return liquidGlassAvailable ? 'liquid-glass' : 'blur';
  if (os === 'android') return hasBlurTarget ? 'blur' : 'tint';
  return 'tint';
}
