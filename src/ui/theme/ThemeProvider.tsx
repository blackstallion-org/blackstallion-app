import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, useColorScheme } from 'react-native';

import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  parseAppearance,
  resolveScheme,
  type AppearancePreference,
  type ResolvedScheme,
} from '@/core/preferences/appearance';
import type { KeyValueStore } from '@/core/preferences/keyValueStore';
import { colorsFor, glassFor, type ColorTokens, type GlassTokens } from '@/ui/tokens';

import { readReduceTransparency, subscribeReduceTransparency } from './accessibilityPrefs';

export type ThemeContextValue = {
  /** False until the stored preference has been read; render nothing themed before. */
  ready: boolean;
  preference: AppearancePreference;
  /** The scheme in effect HERE (a ThemeScope may force dark over photographs). */
  scheme: ResolvedScheme;
  /** The app-wide scheme chosen by the person (ignores ThemeScope). */
  appScheme: ResolvedScheme;
  colors: ColorTokens;
  glass: GlassTokens;
  /** OS Reduce Transparency (or a development override): glass becomes opaque. */
  reduceTransparency: boolean;
  /** OS Reduce Motion (or a development override): animations resolve to their end state. */
  reduceMotion: boolean;
  /** Null when the last save succeeded; otherwise the choice applies this session only. */
  saveError: string | null;
  setPreference: (next: AppearancePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Keeps native UI (keyboards, alerts, system bars) on the same scheme as the app. */
const applyNativeOverride = (preference: AppearancePreference) => {
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);
};

export function ThemeProvider({ store, children }: { store: KeyValueStore; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [preference, setPreferenceState] = useState<AppearancePreference>(DEFAULT_APPEARANCE);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let active = true;
    store
      .get(APPEARANCE_KEY)
      .catch(() => null)
      .then((raw) => {
        if (!active) return;
        const parsed = parseAppearance(raw);
        applyNativeOverride(parsed);
        setPreferenceState(parsed);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [store]);

  // One OS subscription each for the whole app, not one per control.
  useEffect(() => {
    let mounted = true;
    void readReduceTransparency().then((v) => mounted && setReduceTransparency(v));
    const unsubscribe = subscribeReduceTransparency(setReduceTransparency);
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => mounted && setReduceMotion(v))
      .catch(() => undefined);
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      unsubscribe();
      motionSub?.remove();
    };
  }, []);

  const setPreference = useCallback(
    async (next: AppearancePreference) => {
      applyNativeOverride(next);
      setPreferenceState(next);
      try {
        await store.set(APPEARANCE_KEY, next);
        setSaveError(null);
      } catch {
        setSaveError('Your appearance choice could not be saved. It applies until the app restarts.');
      }
    },
    [store],
  );

  // While the override is 'light'/'dark', useColorScheme reports the override,
  // so the explicit preference wins; with 'system' it reports the OS value.
  const scheme = resolveScheme(preference, systemScheme);

  const value = useMemo<ThemeContextValue>(
    () => ({
      ready,
      preference,
      scheme,
      appScheme: scheme,
      colors: colorsFor(scheme),
      glass: glassFor(scheme),
      reduceTransparency,
      reduceMotion,
      saveError,
      setPreference,
    }),
    [ready, preference, scheme, reduceTransparency, reduceMotion, saveError, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Forces a scheme for a subtree. Photographs are always composed in the dark
 * (espresso) scope so white text and dark glass stay readable over them in
 * both app themes. Development galleries can also force Reduce Transparency.
 */
export function ThemeScope({
  scheme,
  reduceTransparency,
  reduceMotion,
  children,
}: {
  scheme?: ResolvedScheme;
  reduceTransparency?: boolean;
  reduceMotion?: boolean;
  children: ReactNode;
}) {
  const parent = useTheme();
  const value = useMemo<ThemeContextValue>(() => {
    const s = scheme ?? parent.scheme;
    return {
      ...parent,
      scheme: s,
      colors: colorsFor(s),
      glass: glassFor(s),
      reduceTransparency: reduceTransparency ?? parent.reduceTransparency,
      reduceMotion: reduceMotion ?? parent.reduceMotion,
    };
  }, [parent, scheme, reduceTransparency, reduceMotion]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Null outside a ThemeProvider (lets low-level hooks fall back to their own OS reads). */
export const useOptionalTheme = (): ThemeContextValue | null => useContext(ThemeContext);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
