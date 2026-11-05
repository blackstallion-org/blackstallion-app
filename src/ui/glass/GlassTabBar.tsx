import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { motion, size as sizes, space } from '@/ui/tokens';

import { floatingTabBottom } from './floatingTabInset';
import { GlassSurface } from './GlassSurface';
import { PressDecor, usePressFeedback } from './pressFeedback';

const useNativeDriver = Platform.OS !== 'web';
const SIDE = space.lg;
const SIDE_NARROW = space.sm + 2;
const PAD = 6;

/** Hides the floating bar while the software keyboard is up (tabBarHideOnKeyboard parity). */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return shown;
}

/**
 * Floating glass tab bar for expo-router Tabs (`tabBar` prop). Adapts the
 * LiquidNavbar reference to React Native: a pill of glass with a lighter glass
 * capsule that slides to the active item (200 ms; static with Reduce Motion).
 * Icons AND labels, real router state (state.index / navigateToTab), tabPress
 * events honoured, safe-area aware, no sound, no WebGL water.
 *
 * Absolutely positioned so scenes run underneath; screens reserve its height
 * with useFloatingTabInset(). Routes hidden by `href: null` never reach this
 * component (expo-router filters them).
 */
export function GlassTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const keyboard = useKeyboardShown();
  const [rowWidth, setRowWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const count = state.routes.length;
  const itemWidth = count > 0 ? rowWidth / count : 0;
  const focusedRoute = state.routes[state.index];
  const focusedOptions = focusedRoute ? descriptors[focusedRoute.key]?.options : undefined;
  const hiddenByScreen = (StyleSheet.flatten(focusedOptions?.tabBarStyle as StyleProp<ViewStyle>) as ViewStyle | undefined)?.display === 'none';
  const narrow = width < 360;

  useEffect(() => {
    const to = state.index * itemWidth;
    if (reduceMotion || itemWidth === 0) x.setValue(to);
    else Animated.timing(x, { toValue: to, duration: motion.base, useNativeDriver }).start();
  }, [state.index, itemWidth, reduceMotion, x]);

  if (hiddenByScreen || keyboard || count === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: floatingTabBottom(insets.bottom), left: (narrow ? SIDE_NARROW : SIDE) + insets.left, right: (narrow ? SIDE_NARROW : SIDE) + insets.right }]}
    >
      <GlassSurface material="thick" borderRadius={sizes.tabBar / 2} style={styles.bar} contentStyle={styles.barContent}>
        <View
          accessibilityRole="tablist"
          testID="glass-tab-bar"
          style={styles.row}
          onLayout={(e: LayoutChangeEvent) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {itemWidth > 0 ? (
            <Animated.View pointerEvents="none" style={[styles.indicator, { width: itemWidth, transform: [{ translateX: x }] }]}>
              <GlassSurface material="thin" backgroundOpacity={0.16} borderRadius={(sizes.tabBar - PAD * 2) / 2} elevated={false} style={StyleSheet.absoluteFill} />
            </Animated.View>
          ) : null}
          {state.routes.map((route, index) => {
            const options = descriptors[route.key]?.options ?? {};
            const focused = index === state.index;
            const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
            const color = focused ? colors.ink : colors.inkMuted;
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            };
            const onLongPress = () => emitter.emit({ type: 'tabLongPress', target: route.key });
            return (
              <TabItem
                key={route.key}
                label={label}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                badge={options.tabBarBadge}
                testID={options.tabBarButtonTestID}
                focused={focused}
                icon={options.tabBarIcon?.({ focused, color: focused ? colors.accent : colors.inkMuted, size: sizes.tabIcon })}
                color={color}
                narrow={narrow}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            );
          })}
        </View>
      </GlassSurface>
    </View>
  );
}

function TabItem({
  label,
  accessibilityLabel,
  badge,
  testID,
  focused,
  icon,
  color,
  narrow,
  onPress,
  onLongPress,
}: {
  label: string;
  accessibilityLabel: string;
  badge?: number | string;
  testID?: string;
  focused: boolean;
  icon: ReactNode;
  color: string;
  narrow: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const { focused: kbFocus, handlers } = usePressFeedback();
  const r = (sizes.tabBar - PAD * 2) / 2;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={badge !== undefined ? `${accessibilityLabel}, ${badge}` : accessibilityLabel}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      style={styles.item}
    >
      {({ pressed }) => (
        <>
          <PressDecor pressed={pressed && !focused} focused={kbFocus} radius={r} />
          <View pointerEvents="none">{icon}</View>
          <AppText
            variant="caption"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            // iOS tab bars use 10 pt labels; 10 on narrow phones keeps five labels whole, 12 elsewhere.
            style={{ color, fontSize: narrow ? 10 : 12, lineHeight: narrow ? 13 : 16, letterSpacing: narrow ? -0.1 : 0, fontWeight: focused ? '600' : '500' }}
          >
            {label}
          </AppText>
          {badge !== undefined ? (
            <View pointerEvents="none" style={[styles.badge, { backgroundColor: colors.accent }]}>
              <AppText variant="caption" style={{ color: colors.onPrimary, fontSize: 10, lineHeight: 12 }}>
                {String(badge)}
              </AppText>
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', alignItems: 'center' },
  bar: { width: '100%', maxWidth: 480, height: sizes.tabBar },
  barContent: { padding: PAD },
  row: { flex: 1, flexDirection: 'row' },
  indicator: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  item: { flex: 1, minHeight: sizes.minTouch, alignItems: 'center', justifyContent: 'center', gap: 1 },
  badge: { position: 'absolute', top: 4, right: '22%', minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
});
