import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

/**
 * Back for pushed shared screens. A screen opened by a deep link has no history: Back then goes to the given
 * fallback (the Settings screen, or Home) instead of doing nothing.
 */
export function useSafeBack(fallback: Href = '/') {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}

/** Routes owned by this workstream and the destinations it links to (NAVIGATION_MAP §3). */
export const SHARED_ROUTES = {
  settings: '/settings',
  notifications: '/settings/notifications',
  help: '/settings/help',
  deleteAccount: '/settings/delete-account',
  /** FA-12, owned by the Family workstream (route file to be created there). */
  consents: '/settings/privacy/consents',
  /** BI-01, owned by the Billing workstream (route file to be created there). */
  billing: '/settings/billing',
  /** FO-12 Sync tab (SH-06 "Send them first"). */
  fieldSync: '/field/sync',
  gallery: '/settings/gallery',
} as const;
