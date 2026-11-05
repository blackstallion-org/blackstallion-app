import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontFor } from '@/ui/theme/fonts';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { brand, displaySize, typography, rgba } from '@/ui/tokens';

const MAX_DECORATIVE_LENGTH = 28;

/**
 * Decorative liquid-metal display lettering for a SHORT brand mark or hero
 * title (brief §3). Each line is three stacked copies of the text: a warm
 * brushed-metal base with a soft golden glow, a bright upper "meniscus"
 * clipped at the waistline and a thin darker horizon band (a restrained take
 * on LiquidMetal.reference.tsx without a shader). The layered copies are hidden from assistive technology;
 * the container exposes ONE header with the plain text (or `accessibilityLabel`).
 *
 * Never use for forms, OTP, scores, amounts, errors or button labels — those
 * use AppText. Lines are given explicitly with "\n" and must be short (the
 * glow is never clipped, so lines are not truncated either).
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
  /** display: 44–64 responsive; title: 32. */
  role?: 'display' | 'title';
  align?: 'left' | 'center';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { scheme } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const plain = text.replace(/\s*\n\s*/g, ' ');
  if (__DEV__ && plain.length > MAX_DECORATIVE_LENGTH) {
    console.warn(`LiquidDisplayText is for short decorative titles (≤ ${MAX_DECORATIVE_LENGTH} chars); use AppText for "${plain.slice(0, 40)}…".`);
  }
  const base = role === 'display' ? { ...typography.display, ...displaySize(width) } : typography.title;
  const { maxFontSizeMultiplier, fontWeight, ...type } = base;
  const dark = scheme === 'dark';
  const textStyle = [type, fontFor(fontWeight), { textAlign: align }];
  // Rendered line height (OS text size included, capped like the Text itself) for the clip bands.
  const lh = type.lineHeight * Math.min(fontScale || 1, maxFontSizeMultiplier ?? 1);
  const waist = Math.round(lh * 0.52);
  const band = Math.max(2, Math.round(lh * 0.035));
  // Dark: golden bronze with a bright meniscus. Light: polished copper (sienna top, deep amber body, warm highlight line).
  const tone = dark
    ? { body: '#E3AF76', top: '#FFF6E8', horizon: '#BC7E45', glow: rgba(brand.goldenHour, 0.42) }
    : { body: brand.deepAmber, top: brand.burntSienna, horizon: '#F2B57A', glow: rgba(brand.goldenHour, 0.2) };
  return (
    <View testID={testID} accessible accessibilityRole="header" accessibilityLabel={accessibilityLabel ?? plain} style={style}>
      {text.split('\n').map((line, i) => (
        <View key={i} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {/* Base: warm brushed metal with a soft golden glow. */}
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[textStyle, { color: tone.body, textShadowColor: tone.glow, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 }]}>
            {line}
          </Text>
          {/* Upper meniscus: bright, clipped just above the waistline. */}
          <View style={[styles.clip, { height: waist }]} pointerEvents="none">
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[textStyle, { color: tone.top }]}>
              {line}
            </Text>
          </View>
          {/* Horizon: a thin darker band where the liquid surface meets the metal. */}
          <View style={[styles.clip, { top: waist, height: band }]} pointerEvents="none">
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[textStyle, styles.shifted, { top: -waist, color: tone.horizon }]}>
              {line}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  // The band's copy sits where the unclipped text would be (shifted up by the band's offset).
  shifted: { position: 'absolute', left: 0, right: 0 },
});
