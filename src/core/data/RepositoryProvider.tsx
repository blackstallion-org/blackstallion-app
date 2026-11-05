import { createContext, useContext, type ReactNode } from 'react';

import type { AccountRepositories } from '@/features/account/data/repositories';
import type { BillingRepositories } from '@/features/billing/data/repositories';
import type { FamilyAppRepositories } from '@/features/family/data/repositories';
import type { SparkFeature } from '@/features/family/spark/types';
import type { FamilyHomeRepository } from '@/features/family/types';
import type { FieldAppRepositories } from '@/features/field/data/repositories';
import type { FieldWorkflowRepository } from '@/features/field/domain/workflow';
import type { FieldTodayRepository } from '@/features/field/types';
import type { FieldOpsRepositories } from '@/features/fieldOps/data/repositories';

import { ScopedLoadError } from './useScopedResource';

export type Repositories = {
  familyHome: FamilyHomeRepository;
  fieldToday: FieldTodayRepository;
  /** Field commands (check-in, publish). Absent when no backend is connected; screens then say so. */
  fieldWorkflow?: FieldWorkflowRepository;
  /**
   * FA-06 Daily Spark content + audio. Absent until a Spark source exists (no
   * server contract yet; D18/M13/Q12 unsigned): the Home entry is hidden and
   * the route shows "unavailable". Development builds use a labelled fixture.
   */
  spark?: SparkFeature;
  /** Feature repositories. Absent = not connected in this build; screens must show an honest unavailable state. */
  account?: AccountRepositories;
  familyApp?: FamilyAppRepositories;
  fieldApp?: FieldAppRepositories;
  fieldOps?: FieldOpsRepositories;
  billing?: BillingRepositories;
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
