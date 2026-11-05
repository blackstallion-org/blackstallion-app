import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes, space, type GlassMaterial } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';
import { PressDecor, usePressFeedback } from './pressFeedback';
import { usePressGuard, type PressHandler } from './usePressGuard';

export type GlassButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

type Common = {
  /** Visible action label; also the accessible name unless accessibilityLabel is given. */
  label: string;
  /** May return a promise: further presses are ignored until it settles (duplicate-submission guard). */
  onPress?: PressHandler;
  /** large = 56 (primary default), regular = 48 (minimum for every action). */
  size?: 'large' | 'regular';
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent width (default true). */
  fullWidth?: boolean;
  /** Secondary on photographs: use 'thick' (safe over any pixel). */
  material?: GlassMaterial;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Destructive actions always carry an icon and explicit text (never colour alone). */
export type GlassButtonProps = (Common & { variant?: 'primary' | 'secondary' | 'ghost' }) | (Common & { variant: 'destructive'; icon: IconName });

/**
 * Every app-owned action button. GlassSurface is only the visual layer; the
 * Pressable carries role, label, disabled/busy state and hit testing.
 */
export function GlassButton(props: GlassButtonProps) {
  const {
    label,
    onPress,
    variant = 'primary',
    size,
    icon,
    iconPosition = 'leading',
    loading = false,
    disabled = false,
    fullWidth = true,
    material = 'regular',
    accessibilityLabel,
    accessibilityHint,
    testID,
    style,
  } = props;
  const { colors, glass } = useTheme();
  const { pending, press } = usePressGuard(onPress);
  const { scaleStyle, focused, handlers } = usePressFeedback();
  const busy = loading || pending;
  const inactive = disabled || busy;
  const height = (size ?? (variant === 'primary' ? 'large' : 'regular')) === 'large' ? sizes.primaryAction : sizes.minTouch;
  const r = height / 2;

  // Disabled uses opaque muted tokens (inkMuted on surfaceMuted ≥ 4.5:1) rather
  // than opacity, so the label stays legible in sunlight.
  const fg = disabled
    ? colors.inkMuted
    : variant === 'primary'
      ? glass.action.text
      : variant === 'destructive'
        ? glass.destructive.text
        : variant === 'ghost'
          ? colors.accentText
          : colors.ink;
  const resolvedIcon = variant === 'destructive' && !icon ? 'warning-outline' : icon;

  return (
    <Animated.View style={[{ alignSelf: fullWidth ? 'stretch' : 'flex-start' }, scaleStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy }}
        disabled={inactive}
        onPress={press}
        {...handlers}
        style={[styles.base, { minHeight: height, minWidth: height, borderRadius: r, paddingHorizontal: variant === 'ghost' ? space.md : space.xl }]}
      >
        {({ pressed }) => (
          <>
            {variant === 'ghost' ? null : disabled ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border }]} />
            ) : (
              <GlassSurface
                pointerEvents="none"
                fill={variant === 'primary' ? 'action' : variant === 'destructive' ? 'destructive' : 'glass'}
                material={material}
                borderRadius={r}
                elevated={variant === 'primary'}
                style={StyleSheet.absoluteFill}
              />
            )}
            <PressDecor pressed={pressed && !inactive} focused={focused} radius={r} />
            <View style={styles.row} pointerEvents="none">
              {busy ? (
                <ActivityIndicator color={fg} accessibilityElementsHidden importantForAccessibility="no" />
              ) : resolvedIcon && iconPosition === 'leading' ? (
                <Icon name={resolvedIcon} color={fg} />
              ) : null}
              <AppText variant="button" align="center" style={{ color: fg }}>
                {label}
              </AppText>
              {!busy && resolvedIcon && iconPosition === 'trailing' ? <Icon name={resolvedIcon} color={fg} /> : null}
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { justifyContent: 'center', alignItems: 'center', paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
});
