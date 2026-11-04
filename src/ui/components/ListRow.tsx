import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes, space } from '@/ui/tokens';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export function ListRow({
  label,
  value,
  icon,
  onPress,
  accessibilityHint,
  testID,
  divider = true,
}: {
  label: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
  divider?: boolean;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      {icon ? <Icon name={icon} color={colors.inkMuted} /> : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {value ? <AppText tone="muted">{value}</AppText> : null}
      </View>
      {onPress ? <Icon name="chevron-forward" color={colors.inkMuted} /> : null}
    </>
  );
  const rowStyle = [styles.row, divider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }];
  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle} accessible accessibilityLabel={[label, value].filter(Boolean).join(', ')}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[label, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [...rowStyle, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: sizes.minTouch + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  text: { flex: 1, gap: 2 },
});
