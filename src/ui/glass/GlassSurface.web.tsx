import { useId, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius as radii, rgba, type GlassTokens } from '@/ui/tokens';

import type { GlassSurfaceProps } from './GlassSurface.types';

/** Web-only CSS properties React Native's style types don't declare (react-native-web passes them through). */
const css = (s: Record<string, string | number | undefined>): ViewStyle => s as ViewStyle;

const DECOR = { pointerEvents: 'none' as const, accessible: false, 'aria-hidden': true } as const;

/**
 * Displacement map, ported from GlassSurface.reference.jsx `generateDisplacementMap`:
 * red gradient → x shift, blue gradient → y shift, a blurred grey core keeps the
 * centre still, so only the rim refracts.
 */
const displacementMap = (w: number, h: number, r: number, ids: { red: string; blue: string; soft: string }) => {
  const borderWidth = 0.07;
  const brightness = 50;
  const opacity = 0.93;
  const blur = 11;
  const edge = Math.min(w, h) * (borderWidth * 0.5);
  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${ids.red}" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient><linearGradient id="${ids.blue}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient><filter id="${ids.soft}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><rect x="0" y="0" width="${w}" height="${h}" fill="black"/><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="url(#${ids.red})"/><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="url(#${ids.blue})" style="mix-blend-mode: difference"/><rect x="${edge}" y="${edge}" width="${w - edge * 2}" height="${h - edge * 2}" rx="${r}" fill="hsl(0 0% ${brightness}% / ${opacity})" filter="url(#${ids.soft})"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/**
 * Reconstruction of the missing GlassSurface.css, in the brand palette:
 *  .glass-surface--svg       background: frost; backdrop-filter: url(#filter) saturate();
 *                            inset rim + inner glow + layered soft outer shadows
 *  .glass-surface--fallback  background: frost; backdrop-filter: blur() saturate() brightness();
 *                            1px rim; inset top/bottom highlights
 *  .glass-surface__sheen     soft diagonal specular gradient
 *  .glass-surface__content   above all layers, never filtered
 * `--glass-frost` ↔ backgroundOpacity, `--glass-saturation` ↔ glass.webSaturate,
 * `--filter-id` ↔ the per-instance SVG filter.
 */
const surfaceShadow = (g: GlassTokens, elevated: boolean, rim: string) =>
  [
    `inset 0 0 0 1px ${rim}`,
    `inset 0 1px 0 ${rgba(g.specular, g.specularAlpha)}`,
    `inset 0 0 18px ${rgba(g.specular, g.innerHighlightAlpha)}`,
    elevated ? g.shadow : null,
  ]
    .filter(Boolean)
    .join(', ');

export function GlassSurface({
  children,
  material = 'regular',
  fill = 'glass',
  borderRadius = radii.card,
  width,
  height,
  backgroundOpacity,
  refraction = false,
  distortionScale = -180,
  displace = 0.5,
  elevated = true,
  interactive: _interactive,
  style,
  contentStyle,
  testID,
  pointerEvents = 'box-none',
  onLayout,
  ...a11y
}: GlassSurfaceProps) {
  const { glass, reduceTransparency } = useTheme();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = { filter: `bsah-glass-${uid}`, red: `bsah-red-${uid}`, blue: `bsah-blue-${uid}`, soft: `bsah-soft-${uid}` };
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const opaque = reduceTransparency || fill === 'opaque';
  const refract = refraction && !opaque && fill === 'glass' && box !== null && box.w > 0 && box.h > 0;
  const map = useMemo(
    () => (refract && box ? displacementMap(Math.round(box.w), Math.round(box.h), borderRadius, ids) : null),
    // ids derive from uid; listing it keeps the memo stable per instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refract, box?.w, box?.h, borderRadius, uid],
  );

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (refraction) setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    onLayout?.(e);
  };

  let layer: ViewStyle;
  let rim = rgba(glass.rim, glass.rimAlpha);
  if (opaque) {
    const bg = fill === 'action' ? glass.action.fill : fill === 'destructive' ? glass.destructive.fill : glass.opaque;
    layer = { backgroundColor: bg };
    rim = glass.opaqueBorder;
  } else if (fill === 'action' || fill === 'destructive') {
    const f = fill === 'action' ? glass.action : glass.destructive;
    layer = css({
      backgroundColor: rgba(f.fill, f.alpha),
      backgroundImage: `linear-gradient(180deg, ${rgba('#FFFFFF', 0.34)} 0%, ${rgba('#FFFFFF', 0)} 60%)`,
    });
    rim = rgba(f.rim, 0.55);
  } else {
    const frost = backgroundOpacity ?? glass.frostAlpha[material];
    const filters = [refract ? `url(#${ids.filter})` : null, `blur(${glass.webBlur[material]}px)`, `saturate(${glass.webSaturate})`].filter(Boolean).join(' ');
    layer = css({
      backgroundColor: rgba(glass.shade, glass.shadeAlpha[material]),
      backgroundImage: `linear-gradient(${rgba(glass.frost, frost)}, ${rgba(glass.frost, frost)}), linear-gradient(155deg, ${rgba(glass.specular, glass.innerHighlightAlpha + 0.06)} 0%, ${rgba(glass.specular, 0)} 55%)`,
      backdropFilter: filters,
      WebkitBackdropFilter: filters,
    });
  }

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      onLayout={handleLayout}
      {...a11y}
      style={[{ borderRadius, width, height }, css({ boxShadow: opaque ? `inset 0 0 0 1px ${rim}` : surfaceShadow(glass, elevated, rim) }), style]}
    >
      {map ? (
        <svg aria-hidden width={0} height={0} style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}>
          <defs>
            <filter id={ids.filter} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
              <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={distortionScale} xChannelSelector="R" yChannelSelector="G" result="dispRed" />
              <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={distortionScale + 10} xChannelSelector="R" yChannelSelector="G" result="dispGreen" />
              <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={distortionScale + 20} xChannelSelector="R" yChannelSelector="G" result="dispBlue" />
              <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue" />
              <feBlend in="red" in2="green" mode="screen" result="rg" />
              <feBlend in="rg" in2="blue" mode="screen" result="output" />
              <feGaussianBlur in="output" stdDeviation={displace} />
            </filter>
          </defs>
        </svg>
      ) : null}
      <View {...DECOR} style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }, layer]} />
      <View pointerEvents="box-none" style={[styles.content, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
});
