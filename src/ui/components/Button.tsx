import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { border, radius, size as sizes, space, type ColorTokens } from '@/ui/tokens';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'regular' | 'field';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
};

const palette = (variant: ButtonVariant, c: ColorTokens) => {
  switch (variant) {
    case 'primary':
      return { bg: c.primaryFill, fg: c.onPrimary, border: c.primaryFill };
    case 'secondary':
      return { bg: c.secondaryFill, fg: c.onSecondary, border: c.borderStrong };
    case 'danger':
      return { bg: c.dangerBg, fg: c.dangerText, border: c.dangerText };
    case 'ghost':
      return { bg: 'transparent', fg: c.ink, border: 'transparent' };
  }
};

export function Button({
  label,
  variant = 'primary',
  size = 'regular',
  icon,
  loading = false,
  fullWidth = true,
  disabled,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  // Disabled uses muted tokens (inkMuted on surfaceMuted ≥ 4.5:1) rather than
  // opacity, so the label stays legible in sunlight.
  const p = disabled
    ? { bg: colors.surfaceMuted, fg: colors.inkMuted, border: colors.border }
    : palette(variant, colors);
  const inactive = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      android_ripple={{ color: colors.border }}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === 'field' ? sizes.fieldAction : sizes.minTouch,
          backgroundColor: p.bg,
          borderColor: p.border,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: pressed && !disabled ? 0.82 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={p.fg} accessibilityElementsHidden importantForAccessibility="no" />
        ) : icon ? (
          <Icon name={icon} color={p.fg} />
        ) : null}
        <AppText variant="label" style={{ color: p.fg }} align="center">
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    borderWidth: border.hairline,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
});
