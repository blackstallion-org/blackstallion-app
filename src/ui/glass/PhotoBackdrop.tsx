import { Image, type ImageSource } from 'expo-image';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import type { ScrimName } from '@/ui/tokens';

/**
 * Editorial photograph, shown as it is: no scrim, fade, tint or gradient (6 Nov 2026 redesign — "less fading").
 * Decorative: hidden from screen readers and untouchable. Text never sits on it; screens place copy on the flat tone
 * beside or below the image. `scrim` is accepted for compatibility and ignored.
 */
export function PhotoBackdrop({
  source,
  height,
  style,
  imageStyle,
  resizeMode = 'cover',
  testID,
}: {
  source: ImageSource;
  scrim?: ScrimName;
  height?: DimensionValue;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ViewStyle>;
  resizeMode?: 'cover' | 'contain';
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[height === undefined ? StyleSheet.absoluteFill : { position: 'absolute', top: 0, left: 0, right: 0, height }, { overflow: 'hidden' }, style]}
    >
      <Image source={source} contentFit={resizeMode} style={[StyleSheet.absoluteFill, styles.image, imageStyle as object]} accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
});
