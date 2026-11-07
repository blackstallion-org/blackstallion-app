import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { rgba, size as sizes } from '@/ui/tokens';

import { floatingTabBottom } from './floatingTabInset';
import { PressDecor, usePressFeedback } from './pressFeedback';
import { WaterGlass } from './WaterGlass';

const useNativeDriver = Platform.OS !== 'web';
const PAD = 6;
/** Active-tab drop: tint strength behind the label (label contrast with this tint is covered in waterGlass.test). */
export const TAB_DROP_TINT = 0.04;

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
 * Docked editorial tab bar for expo-router Tabs (`tabBar` prop): flat canvas, hairline top rule, and a glass water-drop
 * (Waterline, adapted from Nimbus) that springs and stretches to the active item (static with Reduce Motion). Name kept for existing imports.
 * Icons AND labels, real router state (state.index / navigateToTab), tabPress
 * events honoured, safe-area aware, no sound; the water is drawn with plain Views, not WebGL.
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
  // Water-drop travel: the pill stretches while it moves, then settles (Nimbus head/tail, simplified).
  const [stretch] = useState(() => new Animated.Value(1));
  const count = state.routes.length;
  const itemWidth = count > 0 ? rowWidth / count : 0;
  const focusedRoute = state.routes[state.index];
  const focusedOptions = focusedRoute ? descriptors[focusedRoute.key]?.options : undefined;
  const hiddenByScreen = (StyleSheet.flatten(focusedOptions?.tabBarStyle as StyleProp<ViewStyle>) as ViewStyle | undefined)?.display === 'none';
  const narrow = width < 360;

  useEffect(() => {
    const to = state.index * itemWidth;
    if (reduceMotion || itemWidth === 0) {
      x.setValue(to);
      stretch.setValue(1);
    } else {
      Animated.parallel([
        Animated.spring(x, { toValue: to, damping: 16, stiffness: 190, mass: 0.8, useNativeDriver }),
        Animated.sequence([
          Animated.timing(stretch, { toValue: 1.28, duration: 110, useNativeDriver }),
          Animated.spring(stretch, { toValue: 1, damping: 9, stiffness: 160, useNativeDriver }),
        ]),
      ]).start();
    }
  }, [state.index, itemWidth, reduceMotion, x, stretch]);

  if (hiddenByScreen || keyboard || count === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: 0, left: 0, right: 0, paddingBottom: floatingTabBottom(insets.bottom), paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: colors.canvas, borderTopColor: colors.border }]}
    >
      <View style={styles.bar}>
        <View
          accessibilityRole="tablist"
          testID="glass-tab-bar"
          style={styles.row}
          onLayout={(e: LayoutChangeEvent) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {itemWidth > 0 ? (
            <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.indicator, { width: itemWidth, transform: [{ translateX: x }] }]}>
              {/* Active tab: a glass water-drop that slides and stretches to the chosen item. */}
              <Animated.View
                testID="tab-drop"
                style={[styles.drop, { width: itemWidth - 12, height: sizes.tabBar - 12, borderRadius: (sizes.tabBar - 12) / 2, backgroundColor: rgba(colors.accent, TAB_DROP_TINT), borderColor: rgba(colors.accent, 0.5), transform: [{ scaleX: stretch }] }]}
              >
                <WaterGlass radius={(sizes.tabBar - 12) / 2} level="gloss" />
              </Animated.View>
            </Animated.View>
          ) : null}
          {state.routes.map((route, index) => {
            const options = descriptors[route.key]?.options ?? {};
            const focused = index === state.index;
            const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
            const color = focused ? colors.accentText : colors.inkMuted;
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
      </View>
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
  host: { position: 'absolute', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  bar: { width: '100%', maxWidth: 560, height: sizes.tabBar },
  row: { flex: 1, flexDirection: 'row' },
  indicator: { position: 'absolute', top: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  drop: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  item: { flex: 1, minHeight: sizes.minTouch, alignItems: 'center', justifyContent: 'center', gap: 1 },
  badge: { position: 'absolute', top: 4, right: '22%', minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
});
