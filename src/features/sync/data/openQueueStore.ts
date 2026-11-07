// Native (iOS/Android): the Field outbox lives in an on-device SQLite file, so queued work survives an app restart or
// an OS kill (G5's QueueStore, failure-injection tested with real SQLite in src/features/sync). The browser preview uses
// openQueueStore.web.ts (memory only, and says so).
import { openDatabaseSync } from 'expo-sqlite';

import { MemoryQueueStore } from '../domain/memoryQueueStore';
import type { OutboxStore } from '../domain/outboxStore';
import { QueueStore } from '../domain/queueStore';
import { createExpoSqliteDriver } from './expoSqliteDriver';

export const OUTBOX_DB_NAME = 'bsah-outbox.db';

/** Opens the durable store; if the database can't be opened, falls back to memory and the UI says work isn't kept. */
export function openQueueStore(open: typeof openDatabaseSync = openDatabaseSync): OutboxStore {
  try {
    const store = new QueueStore(createExpoSqliteDriver(open(OUTBOX_DB_NAME)));
    store.migrate(); // a corrupt file or full disk falls back here instead of breaking the data layer (review M2)
    return store;
  } catch (e) {
    console.warn('[outbox] durable store unavailable, using memory:', e instanceof Error ? e.name : 'error');
    return new MemoryQueueStore();
  }
}
