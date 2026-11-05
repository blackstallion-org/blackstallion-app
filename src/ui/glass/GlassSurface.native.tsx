import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius as radii, rgba } from '@/ui/tokens';

import { useBlurTarget } from './GlassBackdrop';
import { selectGlassRenderer } from './glassRenderer';
import type { GlassSurfaceProps } from './GlassSurface.types';

let liquidGlass: boolean | undefined;
/** iOS 26+ Liquid Glass availability, read once. Never throws (tests, old binaries). */
export const liquidGlassAvailable = (): boolean => {
  if (liquidGlass === undefined) {
    try {
      liquidGlass = Platform.OS === 'ios' && isLiquidGlassAvailable();
    } catch {
      liquidGlass = false;
    }
  }
  return liquidGlass;
};

const DECOR = { pointerEvents: 'none' as const, accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true };

/**
 * Native renderer (iOS + Android). Layers, bottom → top, all decorative and
 * untouchable: material (GlassView | BlurView | none) → shade → frost →
 * specular sheen → rim → top highlight line. Children render above every
 * layer, never inside the blur.
 */
export function GlassSurface({
  children,
  material = 'regular',
  fill = 'glass',
  borderRadius = radii.card,
  width,
  height,
  backgroundOpacity,
  elevated = true,
  interactive = false,
  style,
  contentStyle,
  testID,
  pointerEvents = 'box-none',
  // Web-only refraction props are accepted for API parity and ignored natively.
  refraction: _refraction,
  distortionScale: _distortionScale,
  displace: _displace,
  ...a11y
}: GlassSurfaceProps) {
  const { glass, scheme, reduceTransparency } = useTheme();
  const blurTarget = useBlurTarget();
  const renderer = selectGlassRenderer({
    os: Platform.OS,
    liquidGlassAvailable: liquidGlassAvailable(),
    reduceTransparency,
    hasBlurTarget: blurTarget !== null,
    fill,
  });
  const clip = { borderRadius, overflow: 'hidden' as const };
  const frostAlpha = backgroundOpacity ?? glass.frostAlpha[material];

  let body: ReactNode;
  if (renderer === 'opaque') {
    body = <View {...DECOR} style={[StyleSheet.absoluteFill, clip, { backgroundColor: fill === 'action' ? glass.action.fill : fill === 'destructive' ? glass.destructive.fill : glass.opaque }]} />;
  } else if (fill === 'action' || fill === 'destructive') {
    const f = fill === 'action' ? glass.action : glass.destructive;
    body = (
      <View {...DECOR} style={[StyleSheet.absoluteFill, clip]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: rgba(f.fill, f.alpha) }]} />
        <LinearGradient
          colors={[rgba('#FFFFFF', 0.34), rgba('#FFFFFF', 0)]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  } else {
    body = (
      <View {...DECOR} style={[StyleSheet.absoluteFill, clip]}>
        {renderer === 'liquid-glass' ? (
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle={material === 'thin' ? 'clear' : 'regular'}
            tintColor={rgba(glass.shade, glass.shadeAlpha[material])}
            colorScheme={scheme}
            isInteractive={interactive}
          />
        ) : renderer === 'blur' ? (
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={glass.blurIntensity[material]}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
            blurTarget={Platform.OS === 'android' && blurTarget ? blurTarget : undefined}
          />
        ) : null}
        {renderer !== 'liquid-glass' ? (
          <>
            {/* Without blur (tint renderer) the shade must carry legibility alone: one step thicker. */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: rgba(glass.shade, renderer === 'tint' ? Math.min(0.9, glass.shadeAlpha[material] + 0.18) : glass.shadeAlpha[material]) }]} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: rgba(glass.frost, frostAlpha) }]} />
          </>
        ) : null}
        <LinearGradient
          colors={[rgba(glass.specular, glass.innerHighlightAlpha + 0.06), rgba(glass.specular, 0)]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.5, y: 0.55 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  const rimColor =
    renderer === 'opaque' ? glass.opaqueBorder : fill === 'action' ? rgba(glass.action.rim, 0.55) : fill === 'destructive' ? rgba(glass.destructive.rim, 0.5) : rgba(glass.rim, glass.rimAlpha);

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      {...a11y}
      style={[{ borderRadius, width, height }, elevated && renderer !== 'opaque' ? { boxShadow: glass.shadow } : null, style]}
    >
      {body}
      {renderer !== 'liquid-glass' ? (
        <View {...DECOR} style={[StyleSheet.absoluteFill, { borderRadius, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: rimColor }]} />
      ) : null}
      {renderer !== 'opaque' && renderer !== 'liquid-glass' ? (
        <LinearGradient
          {...DECOR}
          colors={[rgba(glass.specular, 0), rgba(glass.specular, glass.specularAlpha), rgba(glass.specular, 0)]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.topLine, { left: Math.min(borderRadius, 40) * 0.6, right: Math.min(borderRadius, 40) * 0.6 }]}
        />
      ) : null}
      <View pointerEvents="box-none" style={[styles.content, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topLine: { position: 'absolute', top: 0, height: 1 },
  content: { flexGrow: 1 },
});
