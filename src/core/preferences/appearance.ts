/** Appearance preference rules. Pure: no React or platform imports. */
export type AppearancePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

export const APPEARANCE_KEY = 'bsah.pref.appearance.v1';

/** White/light is the first-launch default (ADR 003). */
export const DEFAULT_APPEARANCE: AppearancePreference = 'light';

export const parseAppearance = (raw: string | null | undefined): AppearancePreference =>
  raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_APPEARANCE;

export const resolveScheme = (
  preference: AppearancePreference,
  systemScheme: string | null | undefined,
): ResolvedScheme => {
  if (preference !== 'system') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
};
