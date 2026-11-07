/**
 * @jest-environment node
 */
// The phone's outbox store: expo-sqlite's sync API (emulated here over node:sqlite with the same method shapes) through
// createExpoSqliteDriver → QueueStore. Queued work must survive closing and reopening the database (an app restart).
/* eslint-disable @typescript-eslint/no-require-imports */
import { openQueueStore } from '../data/openQueueStore';
import type { NewQueueItem } from '../domain/outboxStore';
import { tempDir } from '../testing/nodeHarness';

jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => { throw new Error('native module not in jest'); } }));

type Row = Record<string, unknown>;
function expoLikeOver(file: string) {
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => any };
  const db = new DatabaseSync(file);
  return {
    db,
    api: {
      execSync: (sql: string) => db.exec(sql),
      runSync: (sql: string, params: (string | number | null)[]) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
      getAllSync: <T,>(sql: string, params: (string | number | null)[]) => db.prepare(sql).all(...params) as T[],
    },
  };
}

const T0 = Date.parse('2026-11-08T06:00:00Z');
const item = (op: string): NewQueueItem => ({
  operationId: op, actorId: 'groom-1', hubId: 'hub-1', aggregateId: `task-${op}`, commandType: 'care.submitEvidence', payloadVersion: 1,
  payload: { x: op }, payloadHash: 'pending', localFileRefs: [], observedAt: T0,
});

test('durable on phones: a queued item survives closing and reopening the database', () => {
  const file = `${tempDir('open-queue')}/bsah-outbox.db`;
  const first = expoLikeOver(file);
  const s1 = openQueueStore((() => first.api) as never);
  expect(s1.durability).toBe('durable');
  s1.migrate();
  s1.insertCapturing(item('op-restart'), T0);
  s1.markReady('op-restart', { payload: { x: 1 }, payloadHash: 'h1' }, T0 + 1);
  first.db.close(); // the app is killed

  const second = expoLikeOver(file);
  const s2 = openQueueStore((() => second.api) as never);
  s2.migrate();
  const leased = s2.leaseNext('groom-1', 'worker', T0 + 5, 1000);
  expect(leased).toMatchObject({ operationId: 'op-restart', payloadHash: 'h1' });
  second.db.close();
});

test('if the database cannot be opened, the store is memory-only and says so', () => {
  const s = openQueueStore((() => { throw new Error('disk full'); }) as never);
  expect(s.durability).toBe('memory');
});

test('default (no native module available) falls back to memory rather than crashing', () => {
  expect(openQueueStore().durability).toBe('memory');
});

export type { Row };
