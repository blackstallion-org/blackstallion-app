import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { AppText } from './AppText';
import type { StatusTone } from './StatusMessage';

export function Badge({ label, tone = 'info' }: { label: string; tone?: StatusTone | 'neutral' }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceMuted, colors.ink],
    info: [colors.infoBg, colors.infoText],
    success: [colors.successBg, colors.successText],
    warning: [colors.warningBg, colors.warningText],
    danger: [colors.dangerBg, colors.dangerText],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <AppText variant="caption" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 2 },
});
