/**
 * Field Ops strings (EN/HI/TE, D19 PROPOSED). Same i18next-shaped JSON and `{{placeholder}}` syntax as
 * `features/care/i18n`, so both catalogues can move to one runtime later. Hindi and Telugu are a machine-assisted first
 * draft: every key is listed in `locales/review.json` as needing native review. No React here (used by tests too).
 */
import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';

export type FieldLocale = 'en' | 'hi' | 'te';
export const FIELD_LOCALES: readonly FieldLocale[] = ['en', 'hi', 'te'];

type Catalog = { [k: string]: string | Catalog };
const CATALOGS: Record<FieldLocale, Catalog> = { en, hi, te };
const INTL_TAG: Record<FieldLocale, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

export type Params = Record<string, string | number>;

export interface FieldTranslator {
  readonly locale: FieldLocale;
  /** Missing in this locale → English; missing everywhere → the key itself (visible in review, never blank). */
  t(key: string, params?: Params): string;
  /** Plural: looks up `<key>.one` / `<key>.other` by the locale's plural rules; `{{count}}` is filled in. */
  tn(key: string, count: number, params?: Params): string;
  /** True when the key exists in English (lets callers fall back to server-provided English safely). */
  has(key: string): boolean;
  number(n: number): string;
}

function lookup(cat: Catalog, key: string): string | undefined {
  let node: string | Catalog | undefined = cat;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function resolveFieldLocale(preferred: readonly (string | null | undefined)[]): FieldLocale {
  for (const tag of preferred) {
    const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
    if (base === 'hi' || base === 'te' || base === 'en') return base;
  }
  return 'en';
}

const cache = new Map<FieldLocale, FieldTranslator>();

export function fieldTranslator(locale: FieldLocale): FieldTranslator {
  const hit = cache.get(locale);
  if (hit) return hit;
  const tag = INTL_TAG[locale];
  const nf = new Intl.NumberFormat(tag);
  const plural = typeof Intl.PluralRules === 'function' ? new Intl.PluralRules(tag) : null;
  const fill = (s: string, params?: Params) =>
    s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
      const v = params?.[name];
      if (v === undefined) return `{{${name}}}`;
      return typeof v === 'number' ? nf.format(v) : v;
    });
  const raw = (key: string) => lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key);
  const tr: FieldTranslator = {
    locale,
    t: (key, params) => fill(raw(key) ?? key, params),
    tn: (key, count, params) => {
      const form = plural?.select(count) === 'one' ? 'one' : 'other';
      const s = raw(`${key}.${form}`) ?? raw(`${key}.other`) ?? key;
      return fill(s, { count, ...params });
    },
    has: (key) => lookup(CATALOGS.en, key) !== undefined,
    number: (n) => nf.format(n),
  };
  cache.set(locale, tr);
  return tr;
}

/** Device language, best effort without expo-localization (not installed): the JS runtime's default locale. */
export function deviceFieldLocale(): FieldLocale {
  try {
    return resolveFieldLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
  } catch {
    return 'en';
  }
}
