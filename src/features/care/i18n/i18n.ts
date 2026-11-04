// Small dependency-free translator for Field Ops (EN/HI/TE per D19, PROPOSED). G2 provides no i18n runtime; this can
// be swapped for i18next later because the catalogues are i18next-shaped JSON with {{placeholders}}.
// All Hindi/Telugu text is a machine-assisted first draft: see locales/review.json (every key needs native review).
import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';

export type Locale = 'en' | 'hi' | 'te';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'hi', 'te'];
type Catalog = { [k: string]: string | Catalog };

const CATALOGS: Record<Locale, Catalog> = { en, hi, te };
const INTL_TAG: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

function lookup(cat: Catalog, key: string): string | undefined {
  let node: string | Catalog | undefined = cat;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export interface Translator {
  locale: Locale;
  t(key: string, params?: Record<string, string | number>): string;
  /** time of day in the hub's timezone, e.g. "6:00 am" / "सुबह 6:00" */
  time(at: number | Date, timeZone: string): string;
  /** short date in the hub's timezone */
  date(at: number | Date, timeZone: string): string;
  number(n: number): string;
  /** keys requested but missing in this locale (fell back to English) */
  missing: Set<string>;
}

export function resolveLocale(preferred: readonly string[] | undefined): Locale {
  for (const tag of preferred ?? []) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base === 'hi' || base === 'te' || base === 'en') return base;
  }
  return 'en';
}

export function createTranslator(locale: Locale): Translator {
  const missing = new Set<string>();
  const tag = INTL_TAG[locale];
  return {
    locale,
    missing,
    t(key, params) {
      let s = lookup(CATALOGS[locale], key);
      if (s === undefined) {
        missing.add(key);
        s = lookup(CATALOGS.en, key) ?? key;
      }
      return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
        const v = params?.[name];
        if (v === undefined) return `{{${name}}}`;
        return typeof v === 'number' ? new Intl.NumberFormat(tag).format(v) : v;
      });
    },
    time: (at, timeZone) => new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', timeZone }).format(at),
    date: (at, timeZone) => new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(at),
    number: (n) => new Intl.NumberFormat(tag).format(n),
  };
}

/** Strip the design kit's <b> markers for plain Text rendering (bold handled by the component). */
export function plain(s: string): string {
  return s.replace(/<\/?b>/g, '');
}
