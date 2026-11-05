import { useMemo } from 'react';

import { useAccess } from '@/features/identity/AccessProvider';

import { localeForExperience, useLanguagePreference } from './languagePreference';
import { accountStrings, type AccountStrings } from './strings';

/**
 * Strings for shared screens in the language that applies HERE: the chosen language in Field Ops and on gates
 * reached before an experience exists (account status, not found, update required); English in Family (D19 pilot).
 */
export function useAccountStrings(): AccountStrings {
  const { state } = useAccess();
  const { effective } = useLanguagePreference();
  const experience = state.phase === 'authorized' ? state.experience : null;
  const locale = localeForExperience(experience, effective);
  return useMemo(() => accountStrings(locale), [locale]);
}
