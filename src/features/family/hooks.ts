import { ScopedLoadError, useScopedResource } from '@/core/data/useScopedResource';

import type { ConsentGate } from './components/PrivateClip';
import type { FamilyAppRepositories } from './data/repositories';
import { SESSION_VIDEO } from './domain/consent';
import { useFamily } from './FamilyContext';

const UNCONNECTED = () => Promise.reject(new ScopedLoadError('Not connected', 'OFF-UNCONNECTED', true));

/**
 * A Family resource keyed by person + experience + `parts` (include the child id for child-scoped data, so a
 * sibling's data can never render after a switch). Rejects with OFF-UNCONNECTED when this build has no source.
 */
export function useFamilyResource<T>(parts: (string | number)[], load: (repos: FamilyAppRepositories) => Promise<T>) {
  const { repos, keyFor } = useFamily();
  return useScopedResource<T>(keyFor(...parts), () => (repos ? load(repos) : UNCONNECTED()));
}

/** The child's CURRENT session_video consent (`allowed` under the current wording). Unknown while loading or failed. */
export function useSessionVideoConsent(childId: string | null): ConsentGate {
  const { scope } = useFamily();
  const res = useFamilyResource(['consent-gate', childId ?? '-'], (r) => r.consent.centre(scope));
  if (res.status === 'loading') return { allowed: null, status: 'loading', retry: res.retry };
  if (res.status === 'error') return { allowed: null, status: 'error', retry: res.retry };
  const child = res.data.children.find((c) => c.childId === childId);
  const allowed = child?.consents.some((c) => c.purpose === SESSION_VIDEO && c.allowed) ?? false;
  return { allowed, status: 'ready', retry: res.retry };
}
