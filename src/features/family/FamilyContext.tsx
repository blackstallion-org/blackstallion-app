import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';

import type { FamilyAppRepositories, FamilyChild } from './data/repositories';
import type { FamilyScope } from './types';

type FamilyContextValue = {
  scope: FamilyScope;
  /** Linked children (access snapshot / synthetic persona). Never anything else. */
  linked: readonly FamilyChild[];
  selected: FamilyChild | null;
  /** Selects a linked child; an id that is not linked is ignored (deep links are untrusted). */
  select: (id: string | null | undefined) => boolean;
  repos: FamilyAppRepositories | undefined;
  /** Resource key: person + experience (+ hub) + parts. A child switch or another person never reuses data. */
  keyFor: (...parts: (string | number)[]) => string;
};

const Ctx = createContext<FamilyContextValue | null>(null);

/**
 * Family-wide state: which linked child the screens show. One selection is shared by Home, Progress, Horse,
 * Community, Spark and the pushed screens, so "Aarav's progress" never silently becomes Meera's on another tab.
 * Remounted per person/experience by the family layout (keyed by contextKey).
 */
export function FamilyProvider({ children }: { children: ReactNode }) {
  const { state, contextKey } = useAuthorizedAccess();
  const { familyApp } = useRepositories();
  const session = state.session;
  const scope = useMemo<FamilyScope>(
    () => ({ subjectId: session.subjectId, experience: 'family', children: session.scope?.children, displayName: session.displayName }),
    [session.subjectId, session.scope?.children, session.displayName],
  );
  const linked = useMemo<readonly FamilyChild[]>(
    () => (familyApp ? familyApp.linkedChildren(scope) : (scope.children ?? []).map((c) => ({ id: c.cadetId, firstName: c.firstName, hubId: c.hubId }))),
    [familyApp, scope],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = linked.find((c) => c.id === selectedId) ?? linked[0] ?? null;
  const select = useCallback(
    (id: string | null | undefined) => {
      if (!id || !linked.some((c) => c.id === id)) return false;
      setSelectedId(id);
      return true;
    },
    [linked],
  );
  const keyFor = useCallback((...parts: (string | number)[]) => [contextKey, 'family', ...parts].join(':'), [contextKey]);
  const value = useMemo(() => ({ scope, linked, selected, select, repos: familyApp, keyFor }), [scope, linked, selected, select, familyApp, keyFor]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFamily(): FamilyContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFamily must be used inside FamilyProvider (family layout)');
  return v;
}
