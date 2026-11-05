import { useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { motion, rgba } from '@/ui/tokens';

const useNativeDriver = Platform.OS !== 'web';

/**
 * Pressed feedback shared by every glass control: a brief 160 ms scale to 0.97
 * (static with Reduce Motion) plus a pressed tint, and a visible focus ring for
 * keyboard / switch / web focus. No sound.
 */
export function usePressFeedback() {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [focused, setFocused] = useState(false);
  const to = (v: number) => {
    if (reduced) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, { toValue: v, duration: motion.fast, useNativeDriver }).start();
  };
  return {
    scaleStyle: { transform: [{ scale }] },
    focused,
    handlers: {
      onPressIn: () => to(0.97),
      onPressOut: () => to(1),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}

/** Decorative pressed tint + focus ring (never touchable, hidden from assistive tech). */
export function PressDecor({ pressed, focused, radius }: { pressed: boolean; focused: boolean; radius: number }) {
  const { colors, scheme } = useTheme();
  return (
    <>
      {pressed ? (
        <View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: scheme === 'dark' ? rgba('#FFFFFF', 0.1) : rgba('#1A0D06', 0.07) }]}
        />
      ) : null}
      {focused ? (
        <View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[styles.focus, { borderRadius: radius + 4, borderColor: colors.focus }]}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  focus: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderWidth: 2 },
});
