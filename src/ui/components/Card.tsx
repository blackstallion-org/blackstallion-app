import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { border, radius, space } from '@/ui/tokens';

type CardProps = {
  children: ReactNode;
  /** Makes the whole card one accessible button; requires an explicit label. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  tone?: 'surface' | 'muted';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Card({ children, onPress, accessibilityLabel, accessibilityHint, tone = 'surface', style, testID }: CardProps) {
  const { colors } = useTheme();
  const base = [
    styles.card,
    { backgroundColor: tone === 'muted' ? colors.surfaceMuted : colors.surface, borderColor: colors.border },
    style,
  ];
  if (!onPress) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: border.hairline, padding: space.screenInset, gap: space.md },
});
