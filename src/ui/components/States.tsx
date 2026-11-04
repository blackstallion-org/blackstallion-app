import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';

import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { motion, radius, size as sizes, space } from '@/ui/tokens';

import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

/** Placeholder block. Pulses unless the OS asks for reduced motion. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: DimensionValue }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: motion.skeletonPulse, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.skeletonPulse, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View
      style={{ height, width, borderRadius: radius.sm, backgroundColor: colors.skeleton, opacity: pulse }}
    />
  );
}

/**
 * Skeleton that matches the final layout. It never renders data, so nothing
 * from a previous person or context can show while loading.
 */
export function LoadingState({ label, rows = 3, testID }: { label: string; rows?: number; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityRole="progressbar"
      style={styles.stack}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.skeletonCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Skeleton height={12} width="40%" />
          <Skeleton height={20} width="85%" />
          <Skeleton height={14} width="60%" />
        </View>
      ))}
    </View>
  );
}

type StateAction = { label: string; onPress: () => void };

export function EmptyState({
  icon = 'leaf-outline',
  title,
  message,
  action,
  testID,
}: {
  icon?: IconName;
  title: string;
  message: string;
  action?: StateAction;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={styles.centered}>
      <Icon name={icon} size={36} color={colors.accent} />
      <AppText variant="headline" header align="center">
        {title}
      </AppText>
      <AppText tone="muted" align="center">
        {message}
      </AppText>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}

/** Safe message + Retry; a support reference sits behind "Details" (13 shared rules). */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  details,
  testID,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  details?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View testID={testID} style={styles.centered}>
      <Icon name="cloud-offline-outline" size={36} color={colors.dangerText} />
      <AppText variant="headline" header align="center" accessibilityRole="alert">
        {title}
      </AppText>
      <AppText tone="muted" align="center">
        {message}
      </AppText>
      {onRetry ? <Button label="Retry" onPress={onRetry} /> : null}
      {details ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Hide details' : 'Show details'}
          onPress={() => setOpen((v) => !v)}
          style={styles.details}
        >
          <AppText variant="label" tone="muted">
            {open ? 'Hide details' : 'Details'}
          </AppText>
          {open ? (
            <AppText variant="caption" tone="muted" selectable>
              {details}
            </AppText>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  skeletonCard: { borderWidth: 1, borderRadius: radius.card, padding: space.screenInset, gap: space.md },
  centered: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl },
  details: { minHeight: sizes.minTouch, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.lg },
});
