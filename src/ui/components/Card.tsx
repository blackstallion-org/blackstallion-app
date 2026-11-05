import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { GlassCard } from '@/ui/glass/GlassCard';

type CardProps = {
  children: ReactNode;
  /** Makes the whole card one accessible button; requires an explicit label. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** muted = thicker glass (denser panels). */
  tone?: 'surface' | 'muted';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Pre-glass API kept for existing screens; renders a regular GlassCard (radius 22). */
export function Card({ tone = 'surface', ...rest }: CardProps) {
  return <GlassCard {...rest} material={tone === 'muted' ? 'thick' : 'regular'} />;
}
