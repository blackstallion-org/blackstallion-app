import { GlassButton } from '@/ui/glass/GlassButton';
import type { PressHandler } from '@/ui/glass/usePressGuard';

import type { IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'regular' | 'field';

export type ButtonProps = {
  label: string;
  variant?: ButtonVariant;
  /** field = 56 (primary height); regular = 48. Unset: primary 56, others 48. */
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  /** A returned promise blocks repeat presses until it settles (duplicate-submission guard). */
  onPress?: PressHandler;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * Pre-glass API kept for existing screens; renders through GlassButton.
 * `danger` maps to the destructive glass variant, which always shows an icon.
 */
export function Button({ variant = 'primary', size, icon, ...rest }: ButtonProps) {
  const glassSize = size === 'field' ? 'large' : size === 'regular' ? 'regular' : undefined;
  if (variant === 'danger') return <GlassButton {...rest} size={glassSize} variant="destructive" icon={icon ?? 'warning-outline'} />;
  return <GlassButton {...rest} size={glassSize} variant={variant} icon={icon} />;
}
