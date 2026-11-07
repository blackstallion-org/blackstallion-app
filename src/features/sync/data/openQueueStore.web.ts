// Browser preview only: no durable on-device store (expo-sqlite on web needs extra hosting headers and is not the
// acceptance target). The queue reports durability 'memory' and every screen says unsent work would be lost.
import { MemoryQueueStore } from '../domain/memoryQueueStore';
import type { OutboxStore } from '../domain/outboxStore';

export const OUTBOX_DB_NAME = 'bsah-outbox.db';
export function openQueueStore(): OutboxStore {
  return new MemoryQueueStore();
}
