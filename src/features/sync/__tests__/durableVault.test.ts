/**
 * @jest-environment node
 */
// Kill-restart durability: a care photo queued offline survives the JS process dying and uploads after reopen.
import { captureCareEvidence, recoverInterruptedCaptures } from '../domain/capture';
import { QueueStore } from '../domain/queueStore';
import { SyncWorker } from '../domain/worker';
import { DirVault, FakeClock, FakeSession, InMemoryServer, openNodeSqlite, tempDir, testId } from '../testing/nodeHarness';

const A = 'user-groom-a';
const HUB = 'hub-e1';

function setup() {
  const dir = tempDir('durable-vault');
  const dbFile = `${dir}/outbox.db`;
  const server = new InMemoryServer();
  server.staff.set(A, { hubId: HUB, role: 'GROOM' });
  server.tasks.set('occ-1', { hubId: HUB, horseId: 'horse-1', status: 'pending', assigned: new Set([A]) });
  server.tokenSubject = A;
  const clock = new FakeClock();
  const session = new FakeSession({ subjectId: A, hubId: HUB });

  const open = () => {
    const db = openNodeSqlite(dbFile);
    const store = new QueueStore(db);
    store.migrate();
    const vault = new DirVault(`${dir}/files`, server);
    return { db, store, vault };
  };

  return { open, server, clock, session };
}

test('photo queued offline survives kill and uploads after reopen', async () => {
  const { open, server, clock, session } = setup();

  // --- Session 1: capture a photo while offline ---
  let s1 = open();
  server.offline = true;

  const temp = s1.vault.writeTemp('photo.jpg', 'fake jpeg bytes for durability test');
  const captureResult = await captureCareEvidence(
    { store: s1.store, files: s1.vault, session, clock, newId: () => testId() },
    {
      occurrenceId: 'occ-1',
      horseId: 'horse-1',
      hubId: HUB,
      tempPhotoRef: temp,
      mimeType: 'image/jpeg',
      observedAt: clock.now(),
      location: { latitude: 16.5, longitude: 80.6, accuracyM: 10 },
    },
    true,
  );
  expect(captureResult.ok).toBe(true);

  const items1 = s1.store.listForOwner(A);
  expect(items1).toHaveLength(1);
  expect(items1[0]!.state).toBe('ready');

  // Verify file is on disk
  expect(await s1.vault.exists(items1[0]!.localFileRefs[0]!)).toBe(true);

  // --- Simulate kill: close the database, discard JS state ---
  s1.db.close();

  // --- Session 2: reopen from the same files ---
  const s2 = open();
  server.offline = false;

  // The queue row survived
  const items2 = s2.store.listForOwner(A);
  expect(items2).toHaveLength(1);
  expect(items2[0]!.state).toBe('ready');

  // The evidence file survived (DirVault reads from the same directory)
  expect(await s2.vault.exists(items2[0]!.localFileRefs[0]!)).toBe(true);

  // Drain: the item uploads and is acknowledged
  const worker = new SyncWorker({
    store: s2.store,
    transport: server.transport(),
    files: s2.vault,
    session,
    clock,
    random: () => 0.5,
    workerId: 'w-restart',
  });
  const result = await worker.drain();
  expect(result.acknowledged).toBe(1);

  const after = s2.store.listForOwner(A);
  expect(after).toHaveLength(1);
  expect(after[0]!.state).toBe('acknowledged');

  s2.db.close();
});

test('interrupted capture recovers after reopen', async () => {
  const { open, clock } = setup();

  let s1 = open();

  // Start a capture but simulate a crash mid-finalize by inserting the row
  // in 'capturing' state and finalizing the file, then "killing" before markReady
  const temp = s1.vault.writeTemp('photo2.jpg', 'bytes for interrupted capture');
  const opId = testId();
  const finalRef = `evidence/${A}/${opId}.jpg`;
  s1.store.insertCapturing(
    {
      operationId: opId,
      actorId: A,
      hubId: HUB,
      aggregateId: 'occ-1',
      commandType: 'care.submitEvidence',
      payloadVersion: 1,
      payload: { occurrenceId: 'occ-1', horseId: 'horse-1', observedAt: new Date(clock.now()).toISOString(), location: null, evidence: null },
      payloadHash: 'pending',
      localFileRefs: [finalRef],
      observedAt: clock.now(),
    },
    clock.now(),
  );
  await s1.vault.finalize(temp, finalRef);
  // markReady never called — simulates kill during capture
  s1.db.close();

  // Reopen
  const s2 = open();
  const recovery = await recoverInterruptedCaptures({ store: s2.store, files: s2.vault, clock });
  expect(recovery.recovered).toBe(1);
  expect(recovery.needsRecapture).toBe(0);

  const items = s2.store.listForOwner(A);
  expect(items).toHaveLength(1);
  expect(items[0]!.state).toBe('ready');

  s2.db.close();
});

test('outbox reports durable when both store and vault are durable', () => {
  const { open } = setup();
  const s = open();
  expect(s.store.durability).toBe('durable');
  // DirVault omits durability → undefined, which the outbox gate treats as durable
  // (outbox.ts line 109: files.durability !== 'memory').
  const vault: import('../domain/ports').FileVault = s.vault;
  expect(vault.durability).not.toBe('memory');
  s.db.close();
});
