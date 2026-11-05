// FO-08..FO-20 strings (EN/HI/TE) on the care/sync runtime (features/care/i18n). The `fo.*` namespace is merged over
// the care/sync catalogues so screens can reuse `care.*`, `sync.*` and `common.*` keys.
// Hindi and Telugu are a machine-assisted first draft: every key is listed in locales/review.json as needing native review.
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

import { CARE_CATALOGS, createTranslatorFrom, mergeCatalogs, resolveLocale, type Catalog, type Locale, type Translator } from '@/features/care/i18n/i18n';

import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';

export type { Locale, Translator };

const CATALOGS: Record<Locale, Catalog> = {
  en: mergeCatalogs(CARE_CATALOGS.en, en),
  hi: mergeCatalogs(CARE_CATALOGS.hi, hi),
  te: mergeCatalogs(CARE_CATALOGS.te, te),
};

const cache = new Map<Locale, Translator>();
export function createFieldOpsTranslator(locale: Locale): Translator {
  let t = cache.get(locale);
  if (!t) {
    t = createTranslatorFrom(CATALOGS, locale);
    cache.set(locale, t);
  }
  return t;
}

function deviceLocale(): Locale {
  try {
    return resolveLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
  } catch {
    return 'en';
  }
}

const LocaleContext = createContext<Locale | null>(null);

/** Overrides the Field language (Settings language preference, tests, gallery). Default: the device language. */
export function FieldOpsLocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return createElement(LocaleContext.Provider, { value: locale }, children);
}

export function useFieldOpsT(): Translator {
  const chosen = useContext(LocaleContext);
  return useMemo(() => createFieldOpsTranslator(chosen ?? deviceLocale()), [chosen]);
}
