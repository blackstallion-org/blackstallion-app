/** Appearance preference rules. Pure: no React or platform imports. */
export type AppearancePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

export const APPEARANCE_KEY = 'bsah.pref.appearance.v1';

/**
 * First-launch default: Light — the flat white editorial canvas (6 Nov 2026 redesign, restoring ADR 003's white
 * default). Dark (deep brown) and System stay available and persist.
 */
export const DEFAULT_APPEARANCE: AppearancePreference = 'light';

export const parseAppearance = (raw: string | null | undefined): AppearancePreference =>
  raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_APPEARANCE;

export const resolveScheme = (
  preference: AppearancePreference,
  systemScheme: string | null | undefined,
): ResolvedScheme => {
  if (preference !== 'system') return preference;
  // System follows the OS; with no OS answer, fall back to the default theme.
  return systemScheme === 'dark' ? 'dark' : 'light';
};
