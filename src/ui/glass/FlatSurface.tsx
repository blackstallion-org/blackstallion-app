import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius as radii } from '@/ui/tokens';

import type { GlassSurfaceProps } from './GlassSurface.types';
import { WaterGlass } from './WaterGlass';

/** Restraint: no surface is rounder than this (editorial blocks, not pills). */
export const MAX_SURFACE_RADIUS = radii.card;

/**
 * Flat editorial surface (6 Nov 2026 redesign) with the Waterline rim (7 Nov 2026, see WaterGlass) behind the historic GlassSurface API, on every platform:
 * an opaque fill from the current screen tone and a hairline rule. No blur, translucency, sheen, refraction or
 * shadow; only a lit rim and, on action/destructive fills, a gloss band — `material`, `elevated`, `refraction` and `backgroundOpacity` are accepted for compatibility and ignored.
 *  glass   → `thin`: no fill, hairline only; `regular`/`thick`: tone surface + hairline
 *  action  → primary fill (copper on white, white on dark tones)
 *  destructive → destructive fill
 *  opaque  → tone surface + hairline
 */
export function GlassSurface({
  children,
  material = 'regular',
  fill = 'glass',
  borderRadius = radii.card,
  width,
  height,
  style,
  contentStyle,
  testID,
  pointerEvents = 'box-none',
  onLayout,
  backgroundOpacity: _o,
  refraction: _r,
  distortionScale: _d,
  displace: _x,
  elevated: _e,
  interactive: _i,
  ...a11y
}: GlassSurfaceProps) {
  const { colors } = useTheme();
  const r = Math.min(borderRadius, MAX_SURFACE_RADIUS);
  const look =
    fill === 'action'
      ? { backgroundColor: colors.primaryFill, borderColor: colors.primaryFill }
      : fill === 'destructive'
        ? { backgroundColor: colors.destructiveFill, borderColor: colors.destructiveFill }
        : fill === 'glass' && material === 'thin'
          ? { backgroundColor: 'transparent', borderColor: colors.border }
          : { backgroundColor: colors.surface, borderColor: colors.border };
  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      onLayout={onLayout}
      {...a11y}
      style={[styles.box, look, { borderRadius: r, width, height }, style]}
    >
      <WaterGlass radius={r} level={fill === 'action' || fill === 'destructive' ? 'gloss' : 'rim'} />
      <View pointerEvents="box-none" style={[styles.content, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  content: { flexGrow: 1 },
});
