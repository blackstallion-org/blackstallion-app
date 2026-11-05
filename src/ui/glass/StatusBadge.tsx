import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space, type ColorTokens } from '@/ui/tokens';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_ICON: Record<StatusTone, IconName> = {
  neutral: 'ellipse-outline',
  info: 'information-circle',
  success: 'checkmark-circle',
  warning: 'alert-circle',
  danger: 'close-circle',
};

export const toneColors = (tone: StatusTone, c: ColorTokens): { bg: string; fg: string } =>
  ({
    neutral: { bg: c.surfaceMuted, fg: c.ink },
    info: { bg: c.infoBg, fg: c.infoText },
    success: { bg: c.successBg, fg: c.successText },
    warning: { bg: c.warningBg, fg: c.warningText },
    danger: { bg: c.dangerBg, fg: c.dangerText },
  })[tone];

/** Status as icon + word, never colour alone. Editorial: no pill or fill — coloured icon and word on the screen tone. */
export function StatusBadge({ label, tone = 'neutral', icon, testID }: { label: string; tone?: StatusTone; icon?: IconName | null; testID?: string }) {
  const { colors } = useTheme();
  const { fg } = toneColors(tone, colors);
  const glyph = icon === null ? null : (icon ?? TONE_ICON[tone]);
  return (
    <View testID={testID} accessible accessibilityLabel={label} style={styles.badge}>
      {glyph ? <Icon name={glyph} size={14} color={fg} /> : null}
      <AppText variant="caption" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xxs,
  },
});
