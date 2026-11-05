import { useCallback, useEffect, useRef, useState } from 'react';

import { registerSignOutCleanup } from '@/core/auth/signOutCleanup';
import { useRepositories } from '@/core/data/RepositoryProvider';
import { ScopedLoadError, useScopedResource } from '@/core/data/useScopedResource';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import type { AuthorizedSession } from '@/features/identity/domain/access';

import type { AccountScope } from './data/repositories';
import type { ProfileDetails } from './domain/profile';

export const scopeOf = (session: AuthorizedSession): AccountScope => ({
  subjectId: session.subjectId,
  displayName: session.displayName,
  allowedExperiences: session.allowedExperiences,
  scope: session.scope,
});

/** The signed-in person's account scope (authorized tree only). */
export function useAccountScope(): { subject: AccountScope; contextKey: string } {
  const { state, contextKey } = useAuthorizedAccess();
  return { subject: scopeOf(state.session), contextKey };
}

/** Thrown when this build has no account repositories; screens show "not connected". */
export const NOT_CONNECTED = 'ACCOUNT-UNCONNECTED';

/**
 * Last good profile header per subject (SH-04 "Offline: cached header labelled stale"). In memory only, keyed by
 * subject, and cleared on sign-out and on a user switch, so one person's header can never show for another.
 */
const profileCache = new Map<string, { details: ProfileDetails; at: number }>();
registerSignOutCleanup(() => profileCache.clear());
/** Test/diagnostic view: whose headers are cached (subject ids only). */
export const profileCacheSubjects = (): string[] => Array.from(profileCache.keys());

export function useProfileDetails() {
  const { subject, contextKey } = useAccountScope();
  const account = useRepositories().account;
  const res = useScopedResource(`${contextKey}:profile`, async () => {
    if (!account) throw new ScopedLoadError('Not connected', NOT_CONNECTED);
    const details = await account.profile.get(subject);
    profileCache.set(subject.subjectId, { details, at: Date.now() });
    return details;
  });
  const cached = res.status === 'error' ? (profileCache.get(subject.subjectId) ?? null) : null;
  return { ...res, cached };
}

/**
 * Count of unsent local work for this person (SH-06/SH-10/SH-12). `null` while unknown; 0 when this build keeps no
 * unsent work (no port wired). A late answer for another person is ignored.
 */
export function usePendingWork(subjectId: string | null) {
  const port = useRepositories().account?.pendingWork;
  const [entry, setEntry] = useState<{ key: string; count: number } | null>(null);
  const seq = useRef(0);
  const key = `${subjectId ?? '-'}#${port ? 'port' : 'none'}`;

  const read = useCallback(async (): Promise<number> => {
    if (!port || !subjectId) return 0;
    try {
      return Math.max(0, Math.floor(await port.count(subjectId)));
    } catch {
      return 0; // an unknown count is not shown as work that exists
    }
  }, [port, subjectId]);

  /** Re-reads the count (e.g. right before signing out) and returns it. */
  const refresh = useCallback(async (): Promise<number> => {
    const id = ++seq.current;
    const count = await read();
    if (id === seq.current) setEntry({ key, count });
    return count;
  }, [read, key]);

  useEffect(() => {
    if (!port || !subjectId) return;
    const id = ++seq.current;
    void read().then((count) => {
      if (id === seq.current) setEntry({ key, count });
    });
  }, [read, key, port, subjectId]);

  const count = !port || !subjectId ? 0 : entry && entry.key === key ? entry.count : null;
  return { count, refresh, canDiscard: !!port?.discard, port, durable: port?.durable !== false };
}
