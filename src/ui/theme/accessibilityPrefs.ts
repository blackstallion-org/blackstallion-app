import { AccessibilityInfo } from 'react-native';

/**
 * OS "Reduce Transparency" (iOS). Android has no equivalent setting; the call
 * resolves false there. Web uses the prefers-reduced-transparency media query
 * (accessibilityPrefs.web.ts).
 */
export function readReduceTransparency(): Promise<boolean> {
  return typeof AccessibilityInfo.isReduceTransparencyEnabled === 'function'
    ? AccessibilityInfo.isReduceTransparencyEnabled().catch(() => false)
    : Promise.resolve(false);
}

export function subscribeReduceTransparency(listener: (enabled: boolean) => void): () => void {
  const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', listener);
  return () => sub?.remove();
}
