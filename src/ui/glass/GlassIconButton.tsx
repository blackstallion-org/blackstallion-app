import type { ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/ui/components/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes, type GlassMaterial } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';
import { PressDecor, usePressFeedback } from './pressFeedback';
import { usePressGuard, type PressHandler } from './usePressGuard';

export type GlassIconButtonProps = {
  icon: IconName;
  /** Custom glyph (e.g. a "10 s" replay mark from another icon set); `icon` is the fallback. */
  renderIcon?: (color: string, size: number) => ReactNode;
  /** Required: icon-only controls must be named for VoiceOver/TalkBack. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: PressHandler;
  /** glass (default), solid (high-emphasis light disc, e.g. Play), plain (no surface). */
  appearance?: 'glass' | 'solid' | 'plain';
  /** Diameter; never below 48. */
  size?: number;
  iconSize?: number;
  material?: GlassMaterial;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function GlassIconButton({
  icon,
  renderIcon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  appearance = 'glass',
  size = sizes.minTouch,
  iconSize,
  material = 'regular',
  disabled = false,
  loading = false,
  selected,
  testID,
  style,
}: GlassIconButtonProps) {
  const { colors, scheme } = useTheme();
  const { pending, press } = usePressGuard(onPress);
  const { scaleStyle, focused, handlers } = usePressFeedback();
  const d = Math.max(sizes.minTouch, size);
  const r = d / 2;
  const busy = loading || pending;
  const inactive = disabled || busy;
  // Solid disc: warm white in the dark scope (espresso icon), espresso in light.
  const solidBg = scheme === 'dark' ? '#FFF6EC' : colors.ink;
  const solidFg = scheme === 'dark' ? '#1A0D06' : colors.canvas;
  const fg = disabled ? colors.inkMuted : appearance === 'solid' ? solidFg : colors.ink;
  return (
    <Animated.View style={[{ width: d, height: d }, scaleStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy, selected }}
        disabled={inactive}
        onPress={press}
        {...handlers}
        style={[styles.base, { width: d, height: d, borderRadius: r }]}
      >
        {({ pressed }) => (
          <>
            {appearance === 'glass' ? (
              <GlassSurface pointerEvents="none" material={material} borderRadius={r} style={StyleSheet.absoluteFill} elevated={false} />
            ) : appearance === 'solid' ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: disabled ? colors.surfaceMuted : solidBg, boxShadow: '0px 8px 24px rgba(8, 3, 1, 0.35)' }]} />
            ) : null}
            <PressDecor pressed={pressed && !inactive} focused={focused} radius={r} />
            {busy ? (
              <ActivityIndicator color={fg} accessibilityElementsHidden importantForAccessibility="no" />
            ) : renderIcon ? (
              <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {renderIcon(fg, iconSize ?? Math.round(d * 0.42))}
              </View>
            ) : (
              <Icon name={icon} color={fg} size={iconSize ?? Math.round(d * 0.42)} />
            )}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
