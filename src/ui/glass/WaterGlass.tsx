import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { rgba, type Tone } from '@/ui/tokens';

const useNativeDriver = Platform.OS !== 'web';

/**
 * "Waterline" glass for React Native (7 Nov 2026), adapted from the Nimbus UI liquid navbar.
 *
 * The Nimbus component itself is a web-only DOM + WebGL shader (canvas, CSS backdrop-filter, SVG displacement) and cannot run in
 * Expo Go / native. What carries over, drawn with plain Views so it runs the same on iOS, Android and web:
 *   - a lit rim (bright top edge, soft shade on the bottom edge)           → `rim`
 *   - a short gloss band across the top of the lens                        → `gloss`   (buttons, panes)
 *   - a small specular droplet on the upper left                           → `gloss`
 *   - a ring ripple that spreads from the finger on press                  → `<WaterRipple>` (motion only)
 *
 * Rules kept from the accessibility pass: every layer is decorative (pointerEvents none, hidden from assistive tech); nothing
 * uses shadow or blur; the gloss band is a fixed GLOSS_HEIGHT strip at the top of the control, above where button text sits, so text
 * contrast is the flat-colour pairing already tested; Reduce Motion removes the ripple and keeps the still highlights;
 * Reduce Transparency removes the highlights too.
 */
/** Fixed heights (pt), kept above the text of the shortest 48 pt button (text starts ~14 pt down) and above card padding (16 pt). */
export const GLOSS_HEIGHT = 12;
export const SHEEN_HEIGHT = 8;
export const SHEEN_ALPHA = 0.1;
/** Tones whose text pairings keep ≥ 4.5:1 under the sheen (copper and olive have too little margin, so they stay plain). */
export const SHEEN_TONES: readonly Tone[] = ['brown', 'fir', 'burgundy', 'night'];
/** Image panes carry no text, so their gloss is a share of the picture instead. */
export const PANE_BAND = 0.34;
export const GLOSS_ALPHA = 0.28;
export const RIM_ALPHA = 0.5;
export const SHADE_ALPHA = 0.16;

const DECOR = { pointerEvents: 'none' as const, accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true };

/** rim: lit edge (+ a faint sheen on dark tones) · gloss: buttons · pane: pictures (no text on them). */
export type WaterLevel = 'rim' | 'gloss' | 'pane';

/** Static lit-glass layers. Sits behind the control's content. */
export function WaterGlass({ radius, level = 'rim' }: { radius: number; level?: WaterLevel }) {
  const { colors, tone, reduceTransparency } = useTheme();
  if (reduceTransparency) return null; // OS Reduce Transparency: back to the plain flat surface
  const light = tone === 'white' || tone === 'pearl';
  const sheen = SHEEN_TONES.includes(tone);
  const inset = Math.min(radius, 14);
  return (
    <View {...DECOR} testID="water-glass" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      {level === 'gloss' || level === 'pane' || sheen ? (
        <LinearGradient
          {...DECOR}
          colors={[rgba('#FFFFFF', level === 'rim' ? SHEEN_ALPHA : GLOSS_ALPHA + (level === 'pane' ? 0.04 : 0)), rgba('#FFFFFF', 0)]}
          style={[styles.gloss, { height: level === 'pane' ? `${PANE_BAND * 100}%` : level === 'gloss' ? GLOSS_HEIGHT : SHEEN_HEIGHT }]}
        />
      ) : null}
      {level === 'pane' ? <View {...DECOR} style={[styles.streak, { backgroundColor: rgba('#FFFFFF', 0.28) }]} /> : null}
      {/* Lit top rim and shaded bottom edge: the lens's thickness. */}
      <View {...DECOR} style={[styles.rim, { left: inset, right: inset, backgroundColor: rgba('#FFFFFF', light ? RIM_ALPHA : RIM_ALPHA * 0.6) }]} />
      <View {...DECOR} style={[styles.shade, { left: inset, right: inset, backgroundColor: rgba(light ? colors.ink : '#000000', SHADE_ALPHA) }]} />
      {level !== 'rim' ? <View {...DECOR} style={[styles.drop, { left: inset + 4, backgroundColor: rgba('#FFFFFF', 0.55) }]} /> : null}
    </View>
  );
}

export type RipplePoint = { id: number; x?: number; y?: number };

/** Press signal for <WaterRipple>: spread onPressIn into the control's handlers. */
export function useWaterTrigger() {
  const [point, setPoint] = useState<RipplePoint>({ id: 0 });
  const next = useRef(0);
  return {
    point,
    onPressIn: (e?: GestureResponderEvent) => {
      const n = e?.nativeEvent as { locationX?: number; locationY?: number } | undefined;
      next.current += 1;
      setPoint({ id: next.current, x: n?.locationX, y: n?.locationY });
    },
  };
}

/** A ring that spreads from the touch point and fades (520 ms). Nothing is drawn at rest, and nothing with Reduce Motion. */
export function WaterRipple({ point, radius }: { point: RipplePoint; radius: number }) {
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || point.id === 0) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver }).start();
  }, [point.id, reduced, t]);
  if (reduced) return null;
  const d = Math.max(size.w, size.h, 40) * 1.8;
  const cx = point.x ?? size.w / 2;
  const cy = point.y ?? size.h / 2;
  return (
    <View
      {...DECOR}
      testID="water-ripple"
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Animated.View
        {...DECOR}
        style={{
          position: 'absolute',
          left: cx - d / 2,
          top: cy - d / 2,
          width: d,
          height: d,
          borderRadius: d / 2,
          borderWidth: 1.5,
          borderColor: rgba('#FFFFFF', 0.7),
          backgroundColor: rgba('#FFFFFF', 0.1),
          opacity: t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.9, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.08, 1] }) }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gloss: { position: 'absolute', top: 0, left: 0, right: 0 },
  rim: { position: 'absolute', top: 1, height: 1.5 },
  shade: { position: 'absolute', bottom: 1, height: 1.5 },
  streak: { position: 'absolute', top: 10, left: 14, width: 34, height: 5, borderRadius: 3, transform: [{ rotate: '-8deg' }] },
  drop: { position: 'absolute', top: 5, width: 12, height: 4, borderRadius: 2 },
});
