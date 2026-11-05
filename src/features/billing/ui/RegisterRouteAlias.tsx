import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { PermissionDeniedState } from '@/ui/glass';

import { BILLING_COPY as C } from '../strings';
import { BILLING_ROUTES, BillingPage, useBackTo } from './kit';

type Target = 'home' | 'invoices' | 'invoice' | 'order' | 'autopay';

/**
 * The SCREEN_REGISTER / NAVIGATION_MAP routes (`/settings/billing/...`) as aliases of the Family billing routes, so a
 * link or push using the registered path lands on the same screen. Billing is Family-only: outside the Family
 * experience the alias explains that instead of redirecting into a guarded stack. Ids are passed through encoded; the
 * target screens validate them (a malformed id is "not found").
 */
export function BillingRouteAlias({ to }: { to: Target }) {
  const { state } = useAuthorizedAccess();
  const params = useLocalSearchParams<{ invoiceId?: string; orderId?: string }>();
  const back = useBackTo('/settings');
  if (state.experience !== 'family') {
    return (
      <BillingPage title={C.billing} onBack={back} testID="billing-alias">
        <PermissionDeniedState title={C.familyOnlyTitle} message={C.familyOnlyMessage} testID="billing-family-only" />
      </BillingPage>
    );
  }
  const id = (v: string | string[] | undefined) => encodeURIComponent(typeof v === 'string' ? v : '');
  const href =
    to === 'invoice'
      ? BILLING_ROUTES.invoice(id(params.invoiceId))
      : to === 'order'
        ? BILLING_ROUTES.order(id(params.orderId))
        : BILLING_ROUTES[to];
  return <Redirect href={href} />;
}
