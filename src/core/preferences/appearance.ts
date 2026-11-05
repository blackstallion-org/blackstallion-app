/** Appearance preference rules. Pure: no React or platform imports. */
export type AppearancePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

export const APPEARANCE_KEY = 'bsah.pref.appearance.v1';

/**
 * First-launch default: the espresso/amber theme ("dark"). The liquid-glass
 * brief (design/claude-liquid-glass-brief §3) replaces the earlier white
 * default (ADR 003); Light and System stay available and persist.
 */
export const DEFAULT_APPEARANCE: AppearancePreference = 'dark';

export const parseAppearance = (raw: string | null | undefined): AppearancePreference =>
  raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_APPEARANCE;

export const resolveScheme = (
  preference: AppearancePreference,
  systemScheme: string | null | undefined,
): ResolvedScheme => {
  if (preference !== 'system') return preference;
  // System follows the OS; with no OS answer, fall back to the default theme.
  return systemScheme === 'light' ? 'light' : 'dark';
};
