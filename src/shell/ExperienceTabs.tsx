import { Tabs } from 'expo-router/js-tabs';

import { Icon, type IconName } from '@/ui/components';
import { FloatingTabBarScope, GlassTabBar } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { size } from '@/ui/tokens';

export type TabSpec = { name: string; title: string; icon: IconName };

/**
 * Shared bottom-tab chrome for both experiences (max five tabs, 07): the
 * floating GlassTabBar. Scenes run underneath it; screens reserve its height
 * through useFloatingTabInset() (GlassScreen does this automatically).
 *
 * `hidden` keeps the earlier API (href: null). Note: in expo-router SDK 58 a
 * hidden tab route REDIRECTS to the first tab when focused, so screens that
 * must open above the tabs belong in the experience's Stack layout instead
 * (see app/(authenticated)/family/_layout.tsx and field/_layout.tsx).
 */
export function ExperienceTabs({ tabs, hidden = [] }: { tabs: readonly TabSpec[]; hidden?: readonly string[] }) {
  const { colors } = useTheme();
  return (
    <FloatingTabBarScope>
      <Tabs
        backBehavior="firstRoute"
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.canvas },
        }}
      >
        {tabs.map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarButtonTestID: `tab-${t.name}`,
              tabBarIcon: ({ color, focused }) => (
                <Icon name={focused ? (t.icon.replace(/-outline$/, '') as IconName) : t.icon} color={typeof color === 'string' ? color : colors.ink} size={size.tabIcon} />
              ),
            }}
          />
        ))}
        {hidden.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null, tabBarStyle: { display: 'none' } }} />
        ))}
      </Tabs>
    </FloatingTabBarScope>
  );
}
