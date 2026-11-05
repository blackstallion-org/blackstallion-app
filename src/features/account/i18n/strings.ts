/**
 * Shared account/settings strings (SH-03,04,06,08,09,10,11,12,13) in EN/HI/TE. Same i18next-shaped JSON and
 * `{{placeholder}}` syntax as `features/care/i18n` and `features/field/i18n`, so the catalogues can move to one runtime.
 * Hindi and Telugu are a machine-assisted FIRST DRAFT: every key is listed in `locales/review.json` as needing review
 * by a native speaker before release. No React here.
 */
import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';

import type { AppLanguage } from './languagePreference';

type Catalog = { [k: string]: string | Catalog };
const CATALOGS: Record<AppLanguage, Catalog> = { en, hi, te };
const INTL_TAG: Record<AppLanguage, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

export type Params = Record<string, string | number>;

export interface AccountStrings {
  readonly locale: AppLanguage;
  /** Missing in this locale → English; missing everywhere → the key (visible in review, never blank). */
  t(key: string, params?: Params): string;
  has(key: string): boolean;
  /** "3 Nov 2026" in the locale, in the academy's zone (dates on account requests). */
  date(iso: string): string;
}

function lookup(cat: Catalog, key: string): string | undefined {
  let node: string | Catalog | undefined = cat;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** All leaf keys of a catalogue ("a.b.c"), for parity tests. */
export function catalogKeys(cat: Catalog = CATALOGS.en, prefix = ''): string[] {
  return Object.entries(cat).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : catalogKeys(v, `${prefix}${k}.`)));
}
export const catalogFor = (locale: AppLanguage): Catalog => CATALOGS[locale];

const cache = new Map<AppLanguage, AccountStrings>();

export function accountStrings(locale: AppLanguage): AccountStrings {
  const hit = cache.get(locale);
  if (hit) return hit;
  const tag = INTL_TAG[locale];
  const nf = new Intl.NumberFormat(tag);
  const df = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const s: AccountStrings = {
    locale,
    t(key, params) {
      const raw = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key) ?? key;
      return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
        const v = params?.[name];
        if (v === undefined) return `{{${name}}}`;
        return typeof v === 'number' ? nf.format(v) : v;
      });
    },
    has: (key) => lookup(CATALOGS.en, key) !== undefined,
    date(iso) {
      const t = Date.parse(iso);
      return Number.isFinite(t) ? df.format(t) : '';
    },
  };
  cache.set(locale, s);
  return s;
}
