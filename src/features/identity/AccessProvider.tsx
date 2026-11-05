import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { AccessAdapter, CodeRequestResult, ResetResult, SignInResult } from '@/core/auth/accessAdapter';
import type { KeyValueStore } from '@/core/preferences/keyValueStore';

import {
  canSwitchExperience,
  contextKeyOf,
  resolveAccess,
  switchExperience as applySwitch,
  type AccessState,
  type Experience,
} from './domain/access';
import { lastExperienceStore } from './lastExperience';

type AccessContextValue = {
  state: AccessState;
  /** subject:experience, or null when not authorized. Keys all scoped data. */
  contextKey: string | null;
  canSwitch: boolean;
  adapterName: string;
  switchExperience: (target: Experience) => void;
  signOut: () => Promise<void>;
  reload: () => void;
  /** Present only when the adapter is connected to a real backend (G3). */
  signInWithPassword?: (email: string, password: string) => Promise<SignInResult>;
  requestEmailCode?: (email: string) => Promise<CodeRequestResult>;
  verifyEmailCode?: (email: string, code: string) => Promise<SignInResult>;
  requestPasswordReset?: (email: string) => Promise<CodeRequestResult>;
  completePasswordReset?: (email: string, code: string, newPassword: string) => Promise<ResetResult>;
};

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({
  adapter,
  store,
  children,
}: {
  adapter: AccessAdapter;
  store: KeyValueStore;
  children: ReactNode;
}) {
  const [state, setState] = useState<AccessState>({ phase: 'loading' });
  const generation = useRef(0);
  const memory = useMemo(() => lastExperienceStore(store), [store]);

  // Each load supersedes earlier ones; a late result from an older load
  // (e.g. a previous person) is discarded and can never render.
  const run = useCallback(
    async (id: number) => {
      try {
        const [snapshot, last] = await Promise.all([adapter.load(), memory.read()]);
        if (id === generation.current) setState(resolveAccess(snapshot, last));
      } catch {
        if (id === generation.current) setState({ phase: 'unavailable', reason: 'bootError' });
      }
    },
    [adapter, memory],
  );

  const reload = useCallback(() => {
    const id = ++generation.current;
    setState({ phase: 'loading' });
    void run(id);
  }, [run]);

  useEffect(() => {
    void run(++generation.current);
    return adapter.subscribe(reload);
  }, [adapter, run, reload]);

  const switchExperience = useCallback(
    (target: Experience) => {
      setState((current) => {
        const next = applySwitch(current, target);
        if (next !== current && next.phase === 'authorized') {
          void memory.write(next.session.subjectId, next.experience);
        }
        return next;
      });
    },
    [memory],
  );

  const signOut = useCallback(async () => {
    generation.current++;
    // Drop private state first so nothing of this person stays rendered.
    setState({ phase: 'signedOut' });
    await memory.clear();
    await adapter.signOut();
  }, [adapter, memory]);

  const value = useMemo<AccessContextValue>(
    () => ({
      state,
      contextKey: contextKeyOf(state),
      canSwitch: canSwitchExperience(state),
      adapterName: adapter.name,
      switchExperience,
      signOut,
      reload,
      signInWithPassword: adapter.signInWithPassword?.bind(adapter),
      requestEmailCode: adapter.requestEmailCode?.bind(adapter),
      verifyEmailCode: adapter.verifyEmailCode?.bind(adapter),
      requestPasswordReset: adapter.requestPasswordReset?.bind(adapter),
      completePasswordReset: adapter.completePasswordReset?.bind(adapter),
    }),
    [state, adapter, switchExperience, signOut, reload],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error('useAccess must be used inside AccessProvider');
  return ctx;
}

/** For screens inside the authenticated tree only. */
export function useAuthorizedAccess() {
  const access = useAccess();
  if (access.state.phase !== 'authorized') {
    throw new Error('useAuthorizedAccess used outside the authorized tree');
  }
  return { ...access, state: access.state, contextKey: access.contextKey as string };
}
