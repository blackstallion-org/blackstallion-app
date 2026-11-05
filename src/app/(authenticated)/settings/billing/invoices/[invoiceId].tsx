import { BillingRouteAlias } from '@/features/billing/ui/RegisterRouteAlias';

/** Registered route (SCREEN_REGISTER BI-03) → the Family billing screen. */
export default function Alias() {
  return <BillingRouteAlias to="invoice" />;
}
