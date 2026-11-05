import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useOptionalTheme } from '@/ui/theme/ThemeProvider';

function useOsReducedMotion(enabled: boolean): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => mounted && setReduced(value))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [enabled]);
  return reduced;
}

/**
 * Tracks the OS "reduce motion" setting; animations must offer a static end
 * state. Inside the app the ThemeProvider holds the single OS subscription (and
 * the gallery can override it); outside a provider this hook reads the OS itself.
 */
export function useReducedMotion(): boolean {
  const theme = useOptionalTheme();
  const own = useOsReducedMotion(theme === null);
  return theme ? theme.reduceMotion : own;
}
