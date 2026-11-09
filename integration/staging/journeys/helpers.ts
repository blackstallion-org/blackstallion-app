/**
 * Shared session helpers for journey tests. Extracted from screens.staging.ts session() pattern.
 * Every scope the screens build is constructed here so journey tests use real access snapshots.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAccessAdapter } from '@/core/auth/supabase/supabaseAccessAdapter';
import type { Repositories } from '@/core/data/RepositoryProvider';
import type { AccountScope } from '@/features/account/data/repositories';
import type { BillingScope } from '@/features/billing/data/repositories';
import type { FamilyScope } from '@/features/family/types';
import type { FieldScope } from '@/features/field/types';
import type { OutboxOwner } from '@/features/fieldOps/data/repositories';
import type { FieldOpsScope } from '@/features/fieldOps/domain/types';
import { createServerRepositories } from '@/shell/serverRepositories';

import { appClient, signIn, type Account } from '../stack';

type Snap = {
  kind: string;
  subjectId: string;
  displayName: string;
  allowedExperiences: ('family' | 'field')[];
  scope: {
    role?: string;
    hubId: string | null;
    children: { cadetId: string; firstName: string; hubId: string | null }[];
    capabilities: Record<string, boolean>;
  };
};

/** createServerRepositories always wires these; fieldOps stays optional (its factory may decline). */
export type Session = {
  client: SupabaseClient;
  snap: Snap;
  repos: ReturnType<typeof createServerRepositories> &
    Required<Pick<Repositories, 'account' | 'familyApp' | 'fieldApp' | 'billing' | 'fieldWorkflow'>>;
  field: FieldScope;
  family: FamilyScope;
  ops: FieldOpsScope;
  owner: OutboxOwner;
  account: AccountScope;
  billing: BillingScope;
};

export async function session(a: Account): Promise<Session> {
  const client: SupabaseClient = await signIn(a, appClient());
  const snap = (await createSupabaseAccessAdapter(client).load()) as Snap;
  const repos = createServerRepositories(client as never);
  if (!repos.account || !repos.familyApp || !repos.fieldApp || !repos.billing || !repos.fieldWorkflow) {
    throw new Error('staging session: server repositories incomplete');
  }
  const hubId = snap.scope?.hubId ?? null;
  const role = snap.scope?.role ?? null;
  const children = snap.scope?.children ?? [];
  const fieldRole = role && role !== 'PARENT' ? role : undefined;
  const field: FieldScope = { subjectId: snap.subjectId, experience: 'field', hubId, role: fieldRole, displayName: snap.displayName };
  const family: FamilyScope = { subjectId: snap.subjectId, experience: 'family', children, displayName: snap.displayName };
  const ops: FieldOpsScope = { subjectId: snap.subjectId, experience: 'field', hubId, role };
  const owner: OutboxOwner = { subjectId: snap.subjectId, hubId };
  const account: AccountScope = {
    subjectId: snap.subjectId,
    displayName: snap.displayName,
    allowedExperiences: snap.allowedExperiences,
    scope: snap.scope as AccountScope['scope'],
  };
  const billing: BillingScope = { subjectId: snap.subjectId, experience: 'family', children };
  return { client, snap, repos: repos as Session['repos'], field, family, ops, owner, account, billing };
}

/** The rejection of `p` (fails the test if it resolves). */
export async function errOf(p: Promise<unknown>): Promise<Error & { kind?: string; reference?: string; hint?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { kind?: string; reference?: string };
  }
  throw new Error('expected a rejection, got success');
}

/** Assert that the promise is denied by the server (RLS or function raises). */
export async function expectDenied(p: Promise<unknown>): Promise<void> {
  const e = await errOf(p);
  expect(e).toBeDefined();
}

/** Session cache: signs in once per persona per suite. */
const cache: Record<string, Session> = {};
export async function cachedSession(name: string, account: Account): Promise<Session> {
  return (cache[name] ??= await session(account));
}

export function clearSessionCache(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}
