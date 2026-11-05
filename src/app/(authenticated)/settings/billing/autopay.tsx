import { BillingRouteAlias } from '@/features/billing/ui/RegisterRouteAlias';

/** Registered route (SCREEN_REGISTER BI-05) → the Family billing screen. */
export default function Alias() {
  return <BillingRouteAlias to="autopay" />;
}
