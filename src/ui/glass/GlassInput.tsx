import { useId, useState, type ComponentRef, type Ref } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon } from '@/ui/components/Icon';
import { fontFor } from '@/ui/theme/fonts';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { border, radius, size as sizes, space, typography, type GlassMaterial } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';

export type GlassInputProps = Omit<TextInputProps, 'style'> & {
  /** Visible label, rendered OUTSIDE the glass so it never sits on a blurred layer. */
  label: string;
  hint?: string;
  error?: string | null;
  /** otp: large tabular digits with one-time-code autofill (iOS) / SMS retriever hint (Android). */
  variant?: 'text' | 'otp';
  material?: GlassMaterial;
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

const OTP_PROPS: Partial<TextInputProps> = {
  keyboardType: 'number-pad',
  textContentType: 'oneTimeCode',
  autoComplete: Platform.select<TextInputProps['autoComplete']>({ android: 'sms-otp', default: 'one-time-code' }),
  inputMode: 'numeric',
  maxLength: 6,
};

/**
 * Text field on a glass well. The input text itself is crisp (no refraction,
 * no distortion, blur only behind it); errors are announced and carry an icon.
 */
export function GlassInput({ label, hint, error, variant = 'text', material = 'regular', onFocus, onBlur, ref, ...rest }: GlassInputProps) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const id = useId();
  const otp = variant === 'otp';
  const edge = error ? colors.dangerText : focused ? colors.focus : colors.borderStrong;
  const typeStyle = otp
    ? { fontSize: 28, lineHeight: 34, letterSpacing: 8, fontVariant: ['tabular-nums' as const], textAlign: 'center' as const, ...fontFor('600') }
    : { ...typography.body, ...fontFor('400') };
  return (
    <View style={styles.wrap}>
      <AppText variant="label" nativeID={`${id}-label`}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="secondary" tone="muted">
          {hint}
        </AppText>
      ) : null}
      <View>
        <GlassSurface pointerEvents="none" material={material} borderRadius={radius.control} elevated={false} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius.control, borderColor: edge, borderWidth: focused || error ? border.strong : border.hairline }]} />
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityLabelledBy={`${id}-label`}
          accessibilityState={{ disabled: rest.editable === false }}
          placeholderTextColor={colors.inkMuted}
          keyboardAppearance={scheme}
          selectionColor={colors.focus}
          {...(otp ? OTP_PROPS : null)}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, typeStyle, { color: colors.ink, minHeight: otp ? 64 : sizes.minTouch + 4 }, webNoOutline]}
        />
      </View>
      {error ? (
        <View style={styles.error}>
          <Icon name="alert-circle" size={16} color={colors.dangerText} />
          <AppText variant="secondary" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorText}>
            {error}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** The glass edge already shows focus; suppress the browser's square outline on the web preview. */
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

const styles = StyleSheet.create({
  wrap: { gap: space.xs + 2 },
  input: { borderRadius: radius.control, paddingHorizontal: space.lg, paddingVertical: space.md },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs + 2 },
  errorText: { flex: 1 },
});
