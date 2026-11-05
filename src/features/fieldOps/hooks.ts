// React glue for FO-08..FO-20: scope from the access snapshot, scoped loads with an offline copy, the outbox
// subscription, and the translator. Nothing here decides permissions; the server does.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from 'react';

import { registerSignOutCleanup } from '@/core/auth/signOutCleanup';
import { useRepositories } from '@/core/data/RepositoryProvider';
import { FieldCommandError, toCommandError, type CommandErrorKind } from '@/features/field/domain/commandErrors';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import type { QueueItem } from '@/features/sync/domain/types';

import type { FieldOpsRepositories, FieldOutbox, OutboxOwner } from './data/repositories';
import type { FieldOpsScope } from './domain/types';
import { useFieldOpsT } from './i18n/i18n';

export { useFieldOpsT };

export interface FieldOpsContext {
  repos: FieldOpsRepositories | undefined;
  scope: FieldOpsScope;
  owner: OutboxOwner;
  contextKey: string;
  displayName: string;
  capabilities: Readonly<Record<string, boolean>> | undefined;
}

export function useFieldOps(): FieldOpsContext {
  const { state, contextKey } = useAuthorizedAccess();
  const { fieldOps } = useRepositories();
  const s = state.session;
  const hubId = s.scope?.hubId ?? null;
  const role = s.scope?.role ?? null;
  return useMemo(
    () => ({
      repos: fieldOps,
      scope: { subjectId: s.subjectId, experience: 'field' as const, hubId, role },
      owner: { subjectId: s.subjectId, hubId },
      contextKey,
      displayName: s.displayName,
      capabilities: s.scope?.capabilities,
    }),
    [fieldOps, s.subjectId, hubId, role, contextKey, s.displayName, s.scope?.capabilities],
  );
}

// ------------------------------------------------------------------ scoped loads with a last-good copy
type Cached = { data: unknown; at: number };
const lastGood = new Map<string, Cached>();
registerSignOutCleanup(() => lastGood.clear());

export type FieldResource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; at: number; stale: false }
  /** the request failed; `cached` is this scope's last good answer (never another person's) */
  | { status: 'error'; error: FieldCommandError; kind: CommandErrorKind; cached: { data: T; at: number } | null };

/**
 * Loads data for one scope key (subject + experience + hub + what). A result is shown only while its key is current,
 * so nothing from another person or hub can flash. A network failure keeps the last good copy for the same key and
 * reports when it was fetched. The copies live in memory only and are cleared on sign-out.
 */
export function useFieldResource<T>(key: string | null, loader: () => Promise<T>): FieldResource<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const requestKey = key ? `${key}#${attempt}` : null;
  const [entry, setEntry] = useState<{ key: string; state: FieldResource<T> } | null>(null);
  const load = useEffectEvent(() => loader());
  useEffect(() => {
    if (!requestKey || !key) return;
    let current = true;
    load()
      .then((data) => {
        if (!current) return;
        const at = Date.now();
        lastGood.set(key, { data, at });
        setEntry({ key: requestKey, state: { status: 'ready', data, at, stale: false } });
      })
      .catch((e: unknown) => {
        if (!current) return;
        const error = e instanceof FieldCommandError ? e : toCommandError(e, 'load');
        const c = lastGood.get(key);
        setEntry({ key: requestKey, state: { status: 'error', error, kind: error.kind, cached: c ? { data: c.data as T, at: c.at } : null } });
      });
    return () => {
      current = false;
    };
  }, [requestKey, key]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state: FieldResource<T> = entry && entry.key === requestKey ? entry.state : { status: 'loading' };
  return { ...state, retry };
}

/** Data to render: fresh, or the same scope's last good copy after a network failure. */
export function shown<T>(r: FieldResource<T>): { data: T; at: number; stale: boolean } | null {
  if (r.status === 'ready') return { data: r.data, at: r.at, stale: false };
  if (r.status === 'error' && r.kind === 'network' && r.cached) return { ...r.cached, stale: true };
  return null;
}

// ------------------------------------------------------------------ outbox
const bound = new Map<FieldOutbox, { owner: OutboxOwner; count: number }>();

/**
 * Subscribes to the outbox and binds the signed-in owner while any field screen is mounted. When the last one unmounts
 * (sign-out renders nothing), the session is cleared so nothing is listed or sent for the previous person.
 */
export function useOutbox(outbox: FieldOutbox | undefined, owner: OutboxOwner) {
  const { subjectId, hubId } = owner;
  useEffect(() => {
    if (!outbox) return;
    const prev = bound.get(outbox);
    const same = prev && prev.owner.subjectId === subjectId && prev.owner.hubId === hubId;
    bound.set(outbox, { owner: { subjectId, hubId }, count: same ? prev.count + 1 : 1 });
    if (!same) outbox.setSession({ subjectId, hubId });
    return () => {
      const b = bound.get(outbox);
      if (!b || b.owner.subjectId !== subjectId || b.owner.hubId !== hubId) return;
      if (b.count <= 1) {
        bound.delete(outbox);
        outbox.setSession(null);
      } else b.count--;
    };
  }, [outbox, subjectId, hubId]);

  const subscribe = useCallback((fn: () => void) => (outbox ? outbox.subscribe(fn) : () => undefined), [outbox]);
  const [version, bump] = useState(0);
  useEffect(() => subscribe(() => bump((v) => v + 1)), [subscribe]);
  const online = useSyncExternalStore(subscribe, () => outbox?.online() ?? true, () => true);
  const items = useMemo<QueueItem[]>(
    () => (outbox ? outbox.list({ subjectId, hubId }) : []),
    // `version` re-reads after every outbox change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outbox, subjectId, hubId, version],
  );
  const otherAccountPending = useMemo(
    () => (outbox ? outbox.otherAccountPending({ subjectId, hubId }) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outbox, subjectId, hubId, version],
  );
  return { items, otherAccountPending, online };
}

/** Navigation helper: back when there is history, else a safe parent (deep links). */
export function backOr(router: { canGoBack(): boolean; back(): void; replace(href: never): void }, fallback: string) {
  return () => (router.canGoBack() ? router.back() : router.replace(fallback as never));
}

/**
 * False while another screen is on top. Sheets and dialogs are native windows (and portals on web): a screen that
 * lost focus (deep link, notification) hides its overlays so they never cover the next screen.
 */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
