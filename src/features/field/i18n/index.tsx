import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { deviceFieldLocale, fieldTranslator, type FieldLocale, type FieldTranslator } from './translator';

export { FIELD_LOCALES, fieldTranslator, resolveFieldLocale, type FieldLocale, type FieldTranslator } from './translator';

const LocaleContext = createContext<FieldLocale | null>(null);

/**
 * Optional override of the Field language. Until Settings stores a language preference (SH-13, not in this
 * workstream), screens follow the device language; a provider placed by the shell or a test wins.
 */
export function FieldLocaleProvider({ locale, children }: { locale: FieldLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useFieldStrings(): FieldTranslator {
  const forced = useContext(LocaleContext);
  return useMemo(() => fieldTranslator(forced ?? deviceFieldLocale()), [forced]);
}
