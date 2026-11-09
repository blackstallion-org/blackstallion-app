import type { Repositories } from '@/core/data/RepositoryProvider';
import { createAccountServer } from '@/features/account/data/server';
import { createBillingServer } from '@/features/billing/data/server';
import { createFamilyAppServer } from '@/features/family/data/server';
import { createFieldAppServer } from '@/features/field/data/server';
import { createOutboxPendingWork } from '@/features/fieldOps/data/pendingWork';
import { createFieldOpsServer } from '@/features/fieldOps/data/server';
import { createSupabaseFamilyHomeRepository } from '@/features/family/data/supabaseFamilyHomeRepository';
import { createSupabaseFieldTodayRepository } from '@/features/field/data/supabaseFieldTodayRepository';
import { createServerClock } from '@/features/field/data/serverClock';
import { createSupabaseFieldWorkflowRepository, type DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';
import { createNotificationServer } from '@/features/notifications/data/server';

/** Server-backed repositories. Use the SAME client as the access adapter so every read and command carries that session. */
export function createServerRepositories(client: DataClient): Repositories {
  const clock = createServerClock(client); // one phone-vs-server clock measurement shared by Today and commands
  const fieldOps = createFieldOpsServer(client);
  return {
    familyHome: createSupabaseFamilyHomeRepository(client),
    fieldToday: createSupabaseFieldTodayRepository(client, { clock }),
    fieldWorkflow: createSupabaseFieldWorkflowRepository(client, { clock }),
    // SH-06 sign-out / SH-10 deletion / SH-12 ask about unsent Field work in this phone's outbox
    account: { ...createAccountServer(client), ...(fieldOps ? { pendingWork: createOutboxPendingWork(fieldOps.outbox) } : {}) },
    familyApp: createFamilyAppServer(client),
    fieldApp: createFieldAppServer(client),
    fieldOps,
    billing: createBillingServer(client),
    notifications: createNotificationServer(client),
  };
}
