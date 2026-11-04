import { Text, type TextProps } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { typography, type ColorTokens, type TextVariant } from '@/ui/tokens';

export type TextTone = 'default' | 'muted' | 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'onPrimary';

const toneColor = (tone: TextTone, c: ColorTokens): string =>
  ({
    default: c.ink,
    muted: c.inkMuted,
    accent: c.accentText,
    info: c.infoText,
    success: c.successText,
    warning: c.warningText,
    danger: c.dangerText,
    onPrimary: c.onPrimary,
  })[tone];

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Marks the text as a heading for VoiceOver/TalkBack navigation. */
  header?: boolean;
  align?: 'auto' | 'left' | 'center' | 'right';
};

export function AppText({ variant = 'body', tone = 'default', header, align, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const { maxFontSizeMultiplier, ...type } = typography[variant];
  return (
    <Text
      accessibilityRole={header ? 'header' : rest.accessibilityRole}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
      style={[type, { color: toneColor(tone, colors), textAlign: align }, style]}
    />
  );
}
