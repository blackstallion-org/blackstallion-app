import { memo } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius as radii, size as sizes, space, type GlassMaterial } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';
import { PressDecor, usePressFeedback } from './pressFeedback';

/**
 * Selectable glass pill (filters, child selector). 48 pt high. Exposed as a
 * radio when it is one choice of a group, otherwise as a toggle button.
 */
export const Chip = memo(function Chip({
  label,
  selected = false,
  onPress,
  icon,
  role = 'button',
  material = 'regular',
  accessibilityHint,
  testID,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  role?: 'button' | 'radio';
  material?: GlassMaterial;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, glass } = useTheme();
  const { scaleStyle, focused, handlers } = usePressFeedback();
  const r = radii.control;
  const fg = selected ? glass.action.text : colors.ink;
  return (
    <Animated.View style={[scaleStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={role === 'radio' ? { checked: selected, selected } : { selected }}
        onPress={onPress}
        {...handlers}
        style={[styles.chip, { borderRadius: r }]}
      >
        {({ pressed }) => (
          <>
            <GlassSurface pointerEvents="none" fill={selected ? 'action' : 'glass'} material={selected ? material : 'thin'} borderRadius={r} elevated={false} style={[StyleSheet.absoluteFill, selected ? null : { borderWidth: 1, borderColor: colors.borderStrong }]} />
            <PressDecor pressed={pressed} focused={focused} radius={r} />
            <View style={styles.row} pointerEvents="none">
              {icon ? <Icon name={icon} size={18} color={fg} /> : null}
              <AppText variant="secondary" style={{ color: fg, fontWeight: '600' }} numberOfLines={1}>
                {label}
              </AppText>
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
});

/** Non-interactive glass label pill (category tags, "Daily Spark"). */
export function Pill({ label, icon, material: _material = 'regular', testID }: { label: string; icon?: IconName; material?: GlassMaterial; testID?: string }) {
  const { colors } = useTheme();
  return (
    <GlassSurface testID={testID} material="thin" borderRadius={radii.sm} elevated={false} style={[styles.pill, { borderWidth: 1, borderColor: colors.borderStrong }]} contentStyle={styles.pillContent} accessible accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={16} color={colors.ink} /> : null}
      <AppText variant="secondary" style={{ fontWeight: '500' }}>
        {label}
      </AppText>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: sizes.minTouch, minWidth: sizes.minTouch, justifyContent: 'center', paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  pill: { alignSelf: 'flex-start' },
  pillContent: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 32 },
});
