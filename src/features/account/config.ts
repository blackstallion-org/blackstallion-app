/**
 * Build-time account configuration (no server source exists for these; SCREEN_REGISTER SH-09 "academy contact from
 * app config", SH-12 "test track or store"). Only public, non-secret values, read from EXPO_PUBLIC_* variables.
 * Every value is validated; anything malformed is dropped so the screens say "not configured" instead of offering a
 * broken or unsafe link. Nothing here is invented: an unset value stays null.
 */
export type SupportContact = {
  academyName: string | null;
  /** E.164-ish, digits/spaces/dashes only. */
  phone: string | null;
  email: string | null;
  /** https only. */
  website: string | null;
  /** Free text such as "Mon–Sat, 9:00–18:00 IST". */
  hours: string | null;
  /** https only; the website's privacy policy (SH-13 external row). */
  privacyPolicyUrl: string | null;
  /** 'synthetic-preview' contacts are samples: shown, never dialled or opened. */
  source: 'config' | 'synthetic-preview';
};

export type UpdateDestinations = { ios: string | null; android: string | null };

export type AccountConfig = { support: SupportContact; update: UpdateDestinations };

type Env = Record<string, string | undefined>;

/** Expo inlines EXPO_PUBLIC_* only for literal `process.env.NAME` reads, so each one is spelled out. */
const defaultEnv = (): Env => ({
  EXPO_PUBLIC_SUPPORT_ACADEMY_NAME: process.env.EXPO_PUBLIC_SUPPORT_ACADEMY_NAME,
  EXPO_PUBLIC_SUPPORT_PHONE: process.env.EXPO_PUBLIC_SUPPORT_PHONE,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_SUPPORT_WEBSITE: process.env.EXPO_PUBLIC_SUPPORT_WEBSITE,
  EXPO_PUBLIC_SUPPORT_HOURS: process.env.EXPO_PUBLIC_SUPPORT_HOURS,
  EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
  EXPO_PUBLIC_UPDATE_URL_IOS: process.env.EXPO_PUBLIC_UPDATE_URL_IOS,
  EXPO_PUBLIC_UPDATE_URL_ANDROID: process.env.EXPO_PUBLIC_UPDATE_URL_ANDROID,
});

const text = (v: string | undefined, max = 80): string | null => {
  const s = v?.trim();
  return s && s.length <= max && !/[<>]/.test(s) ? s : null;
};

export const validPhone = (v: string | undefined): string | null => {
  const s = v?.trim();
  return s && /^\+?[0-9][0-9 -]{5,18}[0-9]$/.test(s) ? s : null;
};

export const validEmail = (v: string | undefined): string | null => {
  const s = v?.trim();
  return s && /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(s) && s.length <= 120 ? s : null;
};

export function validHttpsUrl(v: string | undefined, allowedHosts?: readonly string[]): string | null {
  const s = v?.trim();
  if (!s) return null;
  const m = /^https:\/\/([a-z0-9.-]+)(?::\d+)?(\/[^\s<>"]*)?$/i.exec(s);
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  if (allowedHosts && !allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return s;
}

/** Legitimate update destinations only (store listings and test tracks). */
export const STORE_HOSTS = {
  ios: ['apps.apple.com', 'testflight.apple.com'],
  android: ['play.google.com'],
} as const;

export function readAccountConfig(env: Env = defaultEnv()): AccountConfig {
  return {
    support: {
      academyName: text(env.EXPO_PUBLIC_SUPPORT_ACADEMY_NAME),
      phone: validPhone(env.EXPO_PUBLIC_SUPPORT_PHONE),
      email: validEmail(env.EXPO_PUBLIC_SUPPORT_EMAIL),
      website: validHttpsUrl(env.EXPO_PUBLIC_SUPPORT_WEBSITE),
      hours: text(env.EXPO_PUBLIC_SUPPORT_HOURS),
      privacyPolicyUrl: validHttpsUrl(env.EXPO_PUBLIC_PRIVACY_POLICY_URL),
      source: 'config',
    },
    update: {
      ios: validHttpsUrl(env.EXPO_PUBLIC_UPDATE_URL_IOS, STORE_HOSTS.ios),
      android: validHttpsUrl(env.EXPO_PUBLIC_UPDATE_URL_ANDROID, STORE_HOSTS.android),
    },
  };
}

export const hasAnyContact = (c: SupportContact): boolean => !!(c.phone || c.email || c.website);
