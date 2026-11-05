import { Pressable, StyleSheet, View } from 'react-native';

import { GlassSurface } from '@/ui/glass/GlassSurface';
import { PressDecor, usePressFeedback } from '@/ui/glass/pressFeedback';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, size as sizes, space } from '@/ui/tokens';

import { AppText } from './AppText';
import { Icon } from './Icon';

export type Option<T extends string> = { value: T; label: string; description?: string };

/** Single-choice group exposed as radio buttons; flat rows inside one glass group. */
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
    <GlassSurface testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label} borderRadius={radius.card} contentStyle={styles.group}>
      {options.map((opt, i) => (
        <View key={opt.value}>
          {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
          <OptionRow opt={opt} selected={opt.value === value} onPress={() => onChange(opt.value)} testID={testID ? `${testID}-${opt.value}` : undefined} />
        </View>
      ))}
    </GlassSurface>
  );
}

function OptionRow<T extends string>({ opt, selected, onPress, testID }: { opt: Option<T>; selected: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const { focused, handlers } = usePressFeedback();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={opt.label}
      accessibilityHint={opt.description}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      style={styles.option}
    >
      {({ pressed }) => (
        <>
          <PressDecor pressed={pressed} focused={focused} radius={radius.control} />
          <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} color={selected ? colors.accent : colors.inkMuted} />
          <View style={styles.text}>
            <AppText variant="bodyStrong">{opt.label}</AppText>
            {opt.description ? (
              <AppText variant="secondary" tone="muted">
                {opt.description}
              </AppText>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { height: StyleSheet.hairlineWidth },
  option: { minHeight: sizes.minTouch + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  text: { flex: 1, gap: 2 },
});
