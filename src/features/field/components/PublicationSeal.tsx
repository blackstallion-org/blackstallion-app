import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/ui/components';
import { GlassSurface } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { motion, space } from '@/ui/tokens';

/**
 * The publication seal (brass stamp). Rendered ONLY after the server acknowledged the publish/correction; never
 * optimistically. 0.8 s settle (motion.seal) with one success haptic; static with Reduce Motion.
 */
export function PublicationSeal({ title, caption, testID }: { title: string; caption: string; testID?: string }) {
  const { colors, reduceMotion } = useTheme();
  const [scale] = useState(() => new Animated.Value(reduceMotion ? 1 : 0.86));
  const [opacity] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    if (reduceMotion) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: motion.seal, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: motion.seal, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity, reduceMotion]);
  return (
    <View style={styles.wrap} testID={testID} accessible accessibilityRole="text" accessibilityLabel={`${title}. ${caption}`} accessibilityLiveRegion="polite">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <GlassSurface fill="action" borderRadius={72} style={styles.seal} contentStyle={styles.sealContent}>
          <View style={[styles.ring, { borderColor: colors.onPrimary }]}>
            <Icon name="ribbon" size={44} color={colors.onPrimary} />
          </View>
        </GlassSurface>
      </Animated.View>
      <AppText variant="title" align="center">
        {title}
      </AppText>
      <AppText tone="muted" align="center">
        {caption}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  seal: { width: 144, height: 144 },
  sealContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 112, height: 112, borderRadius: 56, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});
