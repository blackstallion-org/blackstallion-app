import { Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontFor } from '@/ui/theme/fonts';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { displaySize, isIndicScript, typography } from '@/ui/tokens';

const MAX_DECORATIVE_LENGTH = 28;

/**
 * Editorial hero lettering (6 Nov 2026 redesign; name kept for existing callers). `display` sets a SHORT brand mark
 * or greeting in Pinyon Script (Spencerian/Copperplate); `title` sets it in Bodoni Moda. Flat colour from the screen
 * tone (accent on light tones, ink on dark tones): no glow, no metal, no layered copies. One accessible header.
 *
 * Never for forms, OTP, scores, amounts, errors, care data or button labels — those use AppText.
 */
export function LiquidDisplayText({
  text,
  accessibilityLabel,
  role = 'title',
  align = 'left',
  testID,
  style,
}: {
  text: string;
  accessibilityLabel?: string;
  role?: 'display' | 'title';
  align?: 'left' | 'center';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, scheme } = useTheme();
  const { width } = useWindowDimensions();
  const plain = text.replace(/\s*\n\s*/g, ' ');
  if (__DEV__ && plain.length > MAX_DECORATIVE_LENGTH) {
    console.warn(`LiquidDisplayText is for short decorative titles (≤ ${MAX_DECORATIVE_LENGTH} chars); use AppText for "${plain.slice(0, 40)}…".`);
  }
  const indic = isIndicScript(plain);
  const script = role === 'display' && !indic;
  const base = script ? typography.script : role === 'display' ? { ...typography.display, ...displaySize(width) } : typography.title;
  const { maxFontSizeMultiplier, fontWeight, family, ...type } = base;
  // Script letterforms need room for ascenders/flourishes; scale with the window like the display role.
  const size = script ? Math.round(Math.min(64, Math.max(46, width * 0.15))) : type.fontSize;
  const color = scheme === 'light' ? colors.accentText : colors.ink;
  return (
    <View testID={testID} accessible accessibilityRole="header" accessibilityLabel={accessibilityLabel ?? plain} style={style}>
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[
          type,
          script ? { fontSize: size, lineHeight: Math.round(size * 1.3) } : null,
          fontFor(fontWeight, family, indic),
          { color, textAlign: align },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
