import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { border, motion, motionDuration, radius, space, type ColorTokens } from '@/ui/tokens';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type StatusTone = 'info' | 'success' | 'warning' | 'danger';

const tones = (tone: StatusTone, c: ColorTokens): { bg: string; fg: string; icon: IconName } =>
  ({
    info: { bg: c.infoBg, fg: c.infoText, icon: 'information-circle-outline' as IconName },
    success: { bg: c.successBg, fg: c.successText, icon: 'checkmark-circle-outline' as IconName },
    warning: { bg: c.warningBg, fg: c.warningText, icon: 'alert-circle-outline' as IconName },
    danger: { bg: c.dangerBg, fg: c.dangerText, icon: 'close-circle-outline' as IconName },
  })[tone];

/** Inline status. Warnings and errors are announced (alert role + live region). */
export function StatusMessage({
  tone = 'info',
  title,
  message,
  testID,
}: {
  tone?: StatusTone;
  title?: string;
  message: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: motionDuration(motion.base, reduced),
      useNativeDriver: true,
    }).start();
  }, [opacity, reduced]);
  const t = tones(tone, colors);
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole={urgent ? 'alert' : 'text'}
      accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
      accessibilityLabel={[title, message].filter(Boolean).join('. ')}
      style={[styles.box, { backgroundColor: t.bg, borderColor: t.fg, opacity }]}
    >
      <Icon name={t.icon} color={t.fg} />
      <View style={styles.text}>
        {title ? <AppText variant="label" style={{ color: t.fg }}>{title}</AppText> : null}
        <AppText variant="body" style={{ color: t.fg }}>
          {message}
        </AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.control,
    borderWidth: border.hairline,
    alignItems: 'flex-start',
  },
  text: { flex: 1, gap: space.xs },
});
