import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View, type DimensionValue, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { rgba, scrims, type ScrimName } from '@/ui/tokens';

/**
 * Editorial photograph + espresso scrim. Decorative: hidden from screen readers
 * and untouchable. Editorial art only — never evidence, live media, a real
 * horse profile or an identity record (assets-manifest.json usagePolicy).
 *
 * The scrim is mandatory wherever text or glass sits on the photo (contrast
 * tests: SCRIM_TEXT_ZONES). `fade` blends into the CANVAS colour instead of
 * espresso, for light-theme page heads. Avoid full-orange gradients: the light
 * comes from the photograph, the ground stays espresso.
 */
export function PhotoBackdrop({
  source,
  scrim = 'card',
  height,
  style,
  imageStyle,
  testID,
}: {
  source: ImageSourcePropType;
  scrim?: ScrimName;
  /** Limit the image to the top part (fades into the canvas below). Default: fill. */
  height?: DimensionValue;
  style?: StyleProp<ViewStyle>;
  /** Positioning of the image inside the frame (e.g. a taller box to move the focal point). */
  imageStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const stops = scrims[scrim];
  const scrimColor = scrim === 'fade' ? colors.canvas : colors.scrim;
  const gradient = stops.map(([, a]) => rgba(scrimColor, a)) as unknown as readonly [string, string, ...string[]];
  const locations = stops.map(([o]) => o) as unknown as readonly [number, number, ...number[]];
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[height === undefined ? StyleSheet.absoluteFill : { position: 'absolute', top: 0, left: 0, right: 0, height }, { overflow: 'hidden' }, style]}
    >
      <Image source={source} resizeMode="cover" style={[StyleSheet.absoluteFill, styles.image, imageStyle as object]} accessibilityIgnoresInvertColors />
      <LinearGradient colors={gradient} locations={locations} style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
});
