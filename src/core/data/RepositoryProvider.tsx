import { createContext, useContext, type ReactNode } from 'react';

import type { FamilyHomeRepository } from '@/features/family/types';
import type { FieldTodayRepository } from '@/features/field/types';

import { ScopedLoadError } from './useScopedResource';

export type Repositories = {
  familyHome: FamilyHomeRepository;
  fieldToday: FieldTodayRepository;
};

/** Default for non-development builds in G2: no backend is connected yet. */
export const unconnectedRepositories: Repositories = {
  familyHome: { getHome: async () => Promise.reject(new ScopedLoadError('Not connected', 'G2-UNCONNECTED')) },
  fieldToday: { getToday: async () => Promise.reject(new ScopedLoadError('Not connected', 'G2-UNCONNECTED')) },
};

const RepositoryContext = createContext<Repositories>(unconnectedRepositories);

export function RepositoryProvider({ value, children }: { value: Repositories; children: ReactNode }) {
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export const useRepositories = (): Repositories => useContext(RepositoryContext);
