import { Tabs } from 'expo-router/js-tabs';

import { Icon, type IconName } from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { size } from '@/ui/tokens';

export type TabSpec = { name: string; title: string; icon: IconName };

/** Shared bottom-tab chrome for both experiences (max five tabs, 07). */
export function ExperienceTabs({ tabs }: { tabs: readonly TabSpec[] }) {
  const { colors } = useTheme();
  return (
    <Tabs
      backBehavior="firstRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarHideOnKeyboard: true,
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
            tabBarIcon: ({ color }) => <Icon name={t.icon} color={typeof color === 'string' ? color : colors.ink} size={size.tabIcon} />,
          }}
        />
      ))}
    </Tabs>
  );
}
