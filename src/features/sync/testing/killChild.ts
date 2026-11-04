// Test-only child process for the SIGKILL test: captures one proof, starts syncing against the local replica,
// writes a marker at the requested checkpoint and then hangs until the parent kills it with SIGKILL.
/* eslint-disable @typescript-eslint/no-require-imports */
import { captureCareEvidence } from '../domain/capture';
import { QueueStore } from '../domain/queueStore';
import { SyncWorker } from '../domain/worker';
import { DirVault, FakeSession, openNodeSqlite } from './nodeHarness';
import { createReplicaTransport } from './replicaTransport';

const fs = require('node:fs') as typeof import('node:fs');
const crypto = require('node:crypto') as typeof import('node:crypto');

async function main(): Promise<void> {
  const env = process.env;
  const db = openNodeSqlite(env.G5_DB!);
  const store = new QueueStore(db);
  store.migrate();
  const vault = new DirVault(env.G5_VAULT!);
  const transport = createReplicaTransport({ port: env.G5_PG_PORT!, token: { subject: env.G5_USER!, valid: true } });
  vault.upload = async (_ref, target) => transport.uploadAs(target.mediaPath);
  const session = new FakeSession({ subjectId: env.G5_USER!, hubId: env.G5_HUB! });
  const clock = { now: () => Date.now() };
  const r = await captureCareEvidence(
    { store, files: vault, session, clock, newId: () => crypto.randomUUID() },
    { occurrenceId: env.G5_OCC!, horseId: env.G5_HORSE!, hubId: env.G5_HUB!, tempPhotoRef: env.G5_TEMP!, mimeType: 'image/jpeg',
      observedAt: Date.now(), location: { latitude: 16.5, longitude: 80.6, accuracyM: 8 } },
    true,
  );
  if (!r.ok) throw new Error(`capture failed: ${r.error}`);
  fs.writeFileSync(`${env.G5_MARK}.op`, r.item.operationId);
  const worker = new SyncWorker({
    store, transport, files: vault, session, clock, random: Math.random, workerId: `child-${process.pid}`,
    checkpoint: (name) => {
      if (name !== env.G5_KILL_AT) return undefined;
      fs.writeFileSync(env.G5_MARK!, name);
      return new Promise<void>(() => {
        setInterval(() => undefined, 1_000); // hang here until SIGKILL
      });
    },
  });
  await worker.drain();
  fs.writeFileSync(env.G5_MARK!, 'finished-without-kill');
}

main().catch((e) => {
  fs.writeFileSync(`${process.env.G5_MARK}.err`, String(e?.stack ?? e));
  process.exit(2);
});
