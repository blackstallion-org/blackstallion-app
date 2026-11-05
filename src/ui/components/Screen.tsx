import { GlassScreen, type GlassScreenProps } from '@/ui/glass/GlassScreen';

export type ScreenProps = GlassScreenProps;

/**
 * Pre-glass API kept for existing screens; renders a GlassScreen (espresso
 * canvas with amber light, safe areas, keyboard, floating-tab inset).
 */
export function Screen(props: ScreenProps) {
  return <GlassScreen {...props} />;
}
