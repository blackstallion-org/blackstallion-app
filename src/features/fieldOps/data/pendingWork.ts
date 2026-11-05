// Wiring point for SH-06 sign-out / SH-10 deletion / SH-12 update gate: the account feature's PendingWorkPort over the
// Field outbox. Composition roots (shell/serverRepositories, dev/fixtures) set `account.pendingWork` to this.
import type { PendingWorkPort } from '@/features/account/data/repositories';

import type { FieldOutbox } from './repositories';

export function createOutboxPendingWork(outbox: FieldOutbox): PendingWorkPort {
  return {
    durable: outbox.durability !== 'memory',
    count: async (subjectId) => outbox.pendingCount(subjectId),
    async discard(subjectId) {
      await outbox.discardAllFor(subjectId);
    },
  };
}
