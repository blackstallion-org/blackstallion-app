import { StyleSheet, View } from 'react-native';

import { Row } from '@/ui/glass/ListGroup';
import { useTheme } from '@/ui/theme/ThemeProvider';

import type { IconName } from './Icon';

/** Pre-glass API kept for existing screens: a flat Row with an optional hairline divider below. */
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
  return (
    <View>
      <Row label={label} value={value} icon={icon} onPress={onPress} accessibilityHint={accessibilityHint} testID={testID} />
      {divider ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} /> : null}
    </View>
  );
}
