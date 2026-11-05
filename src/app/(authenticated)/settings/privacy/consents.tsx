import { Redirect } from 'expo-router';

import { useAuthorizedAccess } from '@/features/identity/AccessProvider';

/**
 * Registered route for FA-12 (`/settings/privacy/consents`, NAVIGATION_MAP) → the Family consent centre. Consent is a
 * guardian action in the Family experience only; from Field Ops the link is not offered and a deep link returns to
 * Settings instead of entering the guarded Family stack. The server still decides whose consent can be read or changed.
 */
export default function ConsentsAlias() {
  const { state } = useAuthorizedAccess();
  return <Redirect href={state.experience === 'family' ? '/family/consents' : '/settings'} />;
}
