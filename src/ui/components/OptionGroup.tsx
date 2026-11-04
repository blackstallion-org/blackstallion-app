import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { border, radius, size as sizes, space } from '@/ui/tokens';

import { AppText } from './AppText';
import { Icon } from './Icon';

export type Option<T extends string> = { value: T; label: string; description?: string };

/** Single-choice group exposed as radio buttons to assistive technology. */
export function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  testID,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (next: T) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            testID={testID ? `${testID}-${opt.value}` : undefined}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityHint={opt.description}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: selected ? colors.ink : colors.border,
                borderWidth: selected ? border.strong : border.hairline,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Icon
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              color={selected ? colors.ink : colors.inkMuted}
            />
            <View style={styles.text}>
              <AppText variant="bodyStrong">{opt.label}</AppText>
              {opt.description ? (
                <AppText variant="caption" tone="muted">
                  {opt.description}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  option: {
    minHeight: sizes.minTouch + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.control,
  },
  text: { flex: 1, gap: 2 },
});
