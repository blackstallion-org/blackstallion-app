import { createContext, useContext, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { size as sizes, space } from '@/ui/tokens';

const FloatingTabContext = createContext(false);

/** Marks a subtree as living under the floating GlassTabBar (set by ExperienceTabs). */
export function FloatingTabBarScope({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  return <FloatingTabContext.Provider value={enabled}>{children}</FloatingTabContext.Provider>;
}

/** Distance of the floating bar's bottom edge from the screen bottom. */
export const floatingTabBottom = (safeBottom: number): number => Math.max(safeBottom, space.xs);

/**
 * Bottom padding scroll content needs so the floating tab bar never covers it:
 * the bar's full height + its offset (safe area included) + breathing room.
 * 0 outside the tab navigator.
 */
export function useFloatingTabInset(): number {
  const inTabs = useContext(FloatingTabContext);
  const insets = useSafeAreaInsets();
  return inTabs ? sizes.tabBar + floatingTabBottom(insets.bottom) + space.lg : 0;
}

export const useInFloatingTabs = (): boolean => useContext(FloatingTabContext);
