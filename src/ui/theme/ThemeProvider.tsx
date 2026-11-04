import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  parseAppearance,
  resolveScheme,
  type AppearancePreference,
  type ResolvedScheme,
} from '@/core/preferences/appearance';
import type { KeyValueStore } from '@/core/preferences/keyValueStore';
import { colorsFor, type ColorTokens } from '@/ui/tokens';

export type ThemeContextValue = {
  /** False until the stored preference has been read; render nothing themed before. */
  ready: boolean;
  preference: AppearancePreference;
  scheme: ResolvedScheme;
  colors: ColorTokens;
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
    () => ({ ready, preference, scheme, colors: colorsFor(scheme), saveError, setPreference }),
    [ready, preference, scheme, saveError, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
