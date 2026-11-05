import { BillingRouteAlias } from '@/features/billing/ui/RegisterRouteAlias';

/** Registered route (SCREEN_REGISTER BI-04) → the Family billing screen. */
export default function Alias() {
  return <BillingRouteAlias to="order" />;
}
