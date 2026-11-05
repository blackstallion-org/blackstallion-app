import { Children, isValidElement, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Text, useWindowDimensions, type TextProps } from 'react-native';

import { fontFor } from '@/ui/theme/fonts';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { adjustForScript, displaySize, typography, type ColorTokens, type TextVariant } from '@/ui/tokens';

export type TextTone =
  | 'default'
  | 'muted'
  | 'accent'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'onPrimary'
  | 'onPhoto'
  | 'onPhotoMuted';

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
    onPhoto: c.onPhoto,
    onPhotoMuted: c.onPhotoMuted,
  })[tone];

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Marks the text as a heading for VoiceOver/TalkBack navigation. */
  header?: boolean;
  align?: 'auto' | 'left' | 'center' | 'right';
  ref?: Ref<ComponentRef<typeof Text>>;
};

/** Plain text of the children, for script detection (Hindi/Telugu spacing). */
const plainText = (children: ReactNode): string => {
  let out = '';
  Children.forEach(children, (c) => {
    if (typeof c === 'string' || typeof c === 'number') out += String(c);
    else if (isValidElement<{ children?: ReactNode }>(c)) out += plainText(c.props.children);
  });
  return out;
};

/**
 * All app text. Roles come from tokens/typography.ts; the font family comes
 * from the single platform mapping (theme/fonts.ts). OS font scaling stays on.
 */
export function AppText({ variant = 'body', tone = 'default', header, align, style, children, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { maxFontSizeMultiplier, fontWeight, ...type } = typography[variant];
  const sized = variant === 'display' ? { ...type, ...displaySize(width) } : type;
  const scripted = adjustForScript(sized, plainText(children));
  return (
    <Text
      accessibilityRole={header ? 'header' : rest.accessibilityRole}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
      style={[scripted, fontFor(fontWeight), { color: toneColor(tone, colors), textAlign: align }, style]}
    >
      {children}
    </Text>
  );
}
