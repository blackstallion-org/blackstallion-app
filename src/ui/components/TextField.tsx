import { useId, useState, type ComponentRef, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { border, radius, size as sizes, space, typography } from '@/ui/tokens';

import { AppText } from './AppText';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  hint?: string;
  error?: string | null;
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

export function TextField({ label, hint, error, onFocus, onBlur, ref, ...rest }: TextFieldProps) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const id = useId();
  const borderColor = error ? colors.dangerText : focused ? colors.focus : colors.borderStrong;
  return (
    <View style={styles.wrap}>
      <AppText variant="label" nativeID={`${id}-label`}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityLabelledBy={`${id}-label`}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={colors.inkMuted}
        keyboardAppearance={scheme}
        selectionColor={colors.focus}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          typography.body,
          {
            color: colors.ink,
            backgroundColor: colors.surface,
            borderColor,
            borderWidth: focused || error ? border.strong : border.hairline,
          },
        ]}
      />
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    minHeight: sizes.minTouch,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
});
