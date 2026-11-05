import type { ReactNode } from 'react';
import type { DimensionValue, StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { GlassMaterial } from '@/ui/tokens';

import type { GlassFill } from './glassRenderer';

/**
 * Shared interface of the platform renderers (GlassSurface.native.tsx,
 * GlassSurface.web.tsx). GlassSurface is a VISUAL layer only: it never carries
 * button semantics; GlassButton & co. wrap it in a Pressable. All decorative
 * layers are pointerEvents="none" and hidden from assistive technology; the
 * children (foreground text) are never inside a blur/refraction layer.
 */
export type GlassSurfaceProps = Pick<
  ViewProps,
  'accessible' | 'accessibilityLabel' | 'accessibilityRole' | 'accessibilityHint' | 'accessibilityState' | 'onLayout' | 'pointerEvents'
> & {
  children?: ReactNode;
  /** Blur depth / tint strength. `thick` is safe over any photo pixel (contrast-tested). */
  material?: GlassMaterial;
  /** glass (default), action (golden-hour fill), destructive, opaque. */
  fill?: GlassFill;
  /** Corner radius. Pills: height / 2. */
  borderRadius?: number;
  width?: DimensionValue;
  height?: DimensionValue;
  /** Reference API: replaces the frost alpha (0–1). */
  backgroundOpacity?: number;
  /** Web only: SVG displacement refraction (Chromium). Ignored by native renderers (see IMPLEMENTATION_NOTES). */
  refraction?: boolean;
  /** Web refraction strength (reference default −180). */
  distortionScale?: number;
  /** Web: blur applied after displacement (reference `displace`). */
  displace?: number;
  /** Outer shadow. Default true. */
  elevated?: boolean;
  /** iOS 26 GlassView interactive highlight (only for surfaces that are themselves pressable). */
  interactive?: boolean;
  /** Outer box: layout, margins, size. */
  style?: StyleProp<ViewStyle>;
  /** Content box (padding, alignment). */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The showcase recipe supplied with the brief, kept as a named preset (not a
 * fixed size for every screen): `<GlassSurface {...GLASS_SHOWCASE_PRESET}>`.
 */
export const GLASS_SHOWCASE_PRESET = {
  width: 320,
  height: 76,
  borderRadius: 38,
  distortionScale: -180,
  displace: 0.5,
  backgroundOpacity: 0.1,
  refraction: true,
} as const satisfies Partial<GlassSurfaceProps>;
