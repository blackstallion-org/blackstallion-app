import type { Repositories } from '@/core/data/RepositoryProvider';
import { createSupabaseFamilyHomeRepository } from '@/features/family/data/supabaseFamilyHomeRepository';
import { createSupabaseFieldTodayRepository } from '@/features/field/data/supabaseFieldTodayRepository';
import { createServerClock } from '@/features/field/data/serverClock';
import { createSupabaseFieldWorkflowRepository, type DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';

/** Server-backed repositories. Use the SAME client as the access adapter so every read and command carries that session. */
export function createServerRepositories(client: DataClient): Repositories {
  const clock = createServerClock(client); // one phone-vs-server clock measurement shared by Today and commands
  return {
    familyHome: createSupabaseFamilyHomeRepository(client),
    fieldToday: createSupabaseFieldTodayRepository(client, { clock }),
    fieldWorkflow: createSupabaseFieldWorkflowRepository(client, { clock }),
  };
}
