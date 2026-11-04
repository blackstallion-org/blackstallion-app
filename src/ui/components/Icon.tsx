import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes } from '@/ui/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Decorative icon: always hidden from screen readers; the adjacent text carries meaning. */
export function Icon({ name, size = sizes.icon, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? colors.ink}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
