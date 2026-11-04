import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { AppText } from './AppText';
import { Icon } from './Icon';

/** Shown on every screen that renders synthetic fixtures, so they are never mistaken for records. */
export function PreviewBanner({ text = 'Synthetic preview data — not real people or records.' }: { text?: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={text}
      testID="preview-banner"
      style={[styles.banner, { backgroundColor: colors.devBannerBg }]}
    >
      <Icon name="flask-outline" color={colors.devBannerText} size={18} />
      <AppText variant="caption" style={[styles.text, { color: colors.devBannerText }]}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.control },
  text: { flex: 1, fontWeight: '600' },
});
