/**
 * @jest-environment node
 */
// Client queue ↔ LOCAL THROWAWAY Postgres replica running the G5 delta (server/live-delta/g5-field-care/run.sh, KEEP=1).
// Real SQL functions, real storage policies, real SQLite file, real files, and a real SIGKILL of a child process.
// Skipped unless G5_PG_PORT is set. Synthetic users/horses from tests.sql only.
/* eslint-disable @typescript-eslint/no-require-imports */
import { captureCareEvidence } from '../domain/capture';
import { QueueStore } from '../domain/queueStore';
import { SyncWorker } from '../domain/worker';
import { TransportError } from '../domain/ports';
import { DirVault, FakeSession, openNodeSqlite, tempDir } from '../testing/nodeHarness';
import { createReplicaTransport, psql, asUser } from '../testing/replicaTransport';

const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
const crypto = require('node:crypto') as typeof import('node:crypto');
const cp = require('node:child_process') as typeof import('node:child_process');

const PORT = process.env.G5_PG_PORT;
const d = PORT ? describe : describe.skip;
const U = (s: string) => `00000000-0000-0000-0000-0000000000${s}`;
const B4 = U('b4'), C5 = U('c5'), C6 = U('c6'), B2 = U('b2');
const E1 = U('e1'), E2 = U('e2'), F1 = U('f1'), F2 = U('f2');

function occ(slot: string, day: string, horse = F1): string {
  return psql(PORT!, `select id from field.care_task_occurrences where horse_id = '${horse}' and slot_key = '${slot}' and local_date = '${day}'`);
}
function count(sql: string): number {
  return Number(psql(PORT!, sql));
}

function harness(user = B4, hub = E1) {
  const dir = tempDir('replica');
  const dbFile = `${dir}/outbox.db`;
  let db = openNodeSqlite(dbFile);
  let store = new QueueStore(db);
  store.migrate();
  const token = { subject: user as string | null, valid: true };
  const net = { offline: false };
  const drop = { count: 0 };
  const transport = createReplicaTransport({ port: PORT!, token, offline: () => net.offline, dropAfterCommit: drop });
  const vault = new DirVault(`${dir}/files`);
  const failUploadOnce = { on: false };
  vault.upload = async (ref, target) => {
    if (failUploadOnce.on) {
      failUploadOnce.on = false;
      throw new TransportError('http', { status: 403, code: 'upload_url_expired' });
    }
    if (!fs.existsSync(vault.abs(ref))) throw new Error('file vanished');
    transport.uploadAs(target.mediaPath);
  };
  const session = new FakeSession({ subjectId: user, hubId: hub });
  session.refresh = async () => {
    session.refreshCalls++;
    if (session.refreshOk) token.valid = true;
    return session.refreshOk;
  };
  let offset = 0;
  const clock = { now: () => Date.now() + offset };
  const worker = (id = 'w1') => new SyncWorker({ store, transport, files: vault, session, clock, random: () => 0.5, workerId: id });
  let n = 0;
  const capture = async (occurrenceId: string, horseId = F1, accuracyM: number | null = 8) => {
    n++;
    const temp = vault.writeTemp(`p${n}.jpg`, `synthetic proof ${n} ${crypto.randomUUID()}`);
    const r = await captureCareEvidence(
      { store, files: vault, session, clock, newId: () => crypto.randomUUID() },
      { occurrenceId, horseId, hubId: hub, tempPhotoRef: temp, mimeType: 'image/jpeg', observedAt: clock.now(),
        location: { latitude: 16.5, longitude: 80.6, accuracyM } },
      true,
    );
    if (!r.ok) throw new Error(r.error);
    return r.item;
  };
  return {
    dir, dbFile, token, net, drop, vault, session, transport, failUploadOnce, capture, worker,
    get store() { return store; },
    advance(ms: number) { offset += ms; },
    restart() { db.close(); db = openNodeSqlite(dbFile); store = new QueueStore(db); store.migrate(); },
  };
}

const subs = (op: string) => count(`select count(*) from field.care_submissions where operation_id = '${op}'`);

d('queue against the local replica (real SQL, real policies)', () => {
  test('I01 airplane-mode capture → restart → reconnect → exactly one server row', async () => {
    const h = harness();
    h.net.offline = true;
    const it = await h.capture(occ('morning_feed', '2026-11-06'));
    await h.worker().drain();
    expect(h.store.get(it.operationId)?.state).toBe('retry_wait');
    h.restart();
    h.net.offline = false;
    h.advance(60_000);
    await h.worker('after-restart').drain();
    expect(h.store.get(it.operationId)?.state).toBe('acknowledged');
    expect(h.store.get(it.operationId)?.serverReceipt).toMatchObject({ reviewState: 'received', replayed: false });
    await h.worker().drain();
    expect(subs(it.operationId)).toBe(1);
  });

  test('I02 response lost after commit → replay receipt, one row', async () => {
    const h = harness();
    const it = await h.capture(occ('hoof', '2026-11-06'));
    h.drop.count = 1;
    await h.worker().drain();
    expect(h.store.get(it.operationId)?.state).toBe('retry_wait');
    expect(subs(it.operationId)).toBe(1);
    h.advance(60_000);
    await h.worker().drain();
    expect(h.store.get(it.operationId)?.serverReceipt?.replayed).toBe(true);
    expect(subs(it.operationId)).toBe(1);
  });

  test('I03 two workers on separate connections → one row per operation', async () => {
    const h = harness();
    const a = await h.capture(occ('midday_water', '2026-11-06'));
    const b = await h.capture(occ('evening_water', '2026-11-06'));
    const db2 = openNodeSqlite(h.dbFile);
    const w2 = new SyncWorker({ store: new QueueStore(db2), transport: h.transport, files: h.vault, session: h.session, clock: { now: () => Date.now() }, random: () => 0.5, workerId: 'w2' });
    await Promise.all([h.worker('w1').drain(), w2.drain()]);
    expect(subs(a.operationId) + subs(b.operationId)).toBe(2);
    db2.close();
  });

  test('I04 staff access revoked before sync → storage policy refuses the upload, item blocked and retained', async () => {
    const h = harness();
    const it = await h.capture(occ('night_med', '2026-11-06'));
    psql(PORT!, `update public.users set role = 'PARENT' where id = '${B4}'`);
    try {
      await h.worker().drain();
    } finally {
      psql(PORT!, `update public.users set role = 'GROOM' where id = '${B4}'`);
    }
    const s = h.store.get(it.operationId)!;
    expect(s.state).toBe('blocked');
    expect(s.lastErrorCode).toBe('storage_denied'); // refused at the first server step (private upload)
    expect(fs.existsSync(h.vault.abs(s.localFileRefs[0]!))).toBe(true);
    expect(subs(it.operationId)).toBe(0);
  });

  test('I04b revoked after the upload landed → the submit command itself refuses (access_revoked)', async () => {
    const h = harness();
    const it = await h.capture(occ('morning_feed', '2026-11-05'));
    const w = new SyncWorker({ store: h.store, transport: h.transport, files: h.vault, session: h.session, clock: { now: () => Date.now() },
      random: () => 0.5, workerId: 'w', checkpoint: (name) => { if (name === 'before_submit') psql(PORT!, `update public.users set role = 'PARENT' where id = '${B4}'`); } });
    try {
      await w.drain();
    } finally {
      psql(PORT!, `update public.users set role = 'GROOM' where id = '${B4}'`);
    }
    expect(h.store.get(it.operationId)).toMatchObject({ state: 'blocked', lastErrorCode: 'access_revoked' });
    expect(subs(it.operationId)).toBe(0);
  });

  test('I05 evidence for an already completed task → retained on the server for review', async () => {
    const h = harness();
    const id = occ('early_check', '2026-11-06');
    const first = await h.capture(id);
    await h.worker().drain();
    const sub = psql(PORT!, `select id from field.care_submissions where operation_id = '${first.operationId}'`);
    asUser(PORT!, B2, `select field.review_care_submission('${crypto.randomUUID()}', '${'a'.repeat(64)}', '${sub}', 'accepted', null);`);
    const second = await h.capture(id);
    await h.worker().drain();
    expect(h.store.get(second.operationId)?.serverReceipt).toMatchObject({ outcome: 'already_completed', reviewState: 'review_required' });
    expect(count(`select count(*) from field.care_submissions where occurrence_id = '${id}'`)).toBe(2);
  });

  test('I06 upload intent expired mid-transfer → renewed, then submitted once', async () => {
    const h = harness();
    const it = await h.capture(occ('morning_feed', '2026-11-07'));
    h.failUploadOnce.on = true;
    await h.worker().drain();
    expect(h.store.get(it.operationId)?.state).toBe('acknowledged');
    expect(subs(it.operationId)).toBe(1);
  });

  test('I07 poor accuracy (250 m) → server says review_required/weak_location_accuracy', async () => {
    const h = harness();
    const it = await h.capture(occ('hoof', '2026-11-07'), F1, 250);
    await h.worker().drain();
    expect(h.store.get(it.operationId)?.serverReceipt).toMatchObject({ reviewState: 'review_required', reviewReasons: ['weak_location_accuracy'] });
  });

  test('I08 cross-horse write (f1 task claimed as f2) → server refuses, item blocked', async () => {
    const h = harness();
    const it = await h.capture(occ('midday_water', '2026-11-07'), F2);
    await h.worker().drain();
    expect(h.store.get(it.operationId)).toMatchObject({ state: 'blocked', lastErrorCode: 'horse_mismatch' });
    expect(subs(it.operationId)).toBe(0);
  });

  test('I09 cross-hub write (hub e2 groom, hub e1 task) → server refuses, item blocked', async () => {
    const h = harness(C5, E2);
    const it = await h.capture(occ('midday_water', '2026-11-07'));
    await h.worker().drain();
    expect(h.store.get(it.operationId)).toMatchObject({ state: 'blocked', lastErrorCode: 'cross_hub_denied' });
    expect(subs(it.operationId)).toBe(0);
  });

  test('I10 account switch with work queued → other account sends nothing; owner sends later', async () => {
    const h = harness();
    h.net.offline = true;
    const it = await h.capture(occ('early_check', '2026-11-07'));
    await h.worker().drain();
    h.net.offline = false;
    h.session.who = { subjectId: C6, hubId: E1 };
    h.token.subject = C6;
    h.advance(60_000);
    expect((await h.worker().drain()).processed).toBe(0);
    expect(subs(it.operationId)).toBe(0);
    h.session.who = { subjectId: B4, hubId: E1 };
    h.token.subject = B4;
    await h.worker().drain();
    expect(subs(it.operationId)).toBe(1);
    expect(psql(PORT!, `select actor_id from field.care_submissions where operation_id = '${it.operationId}'`)).toBe(B4);
  });

  test('I11 session expired and refresh fails → paused for sign-in; nothing sent', async () => {
    const h = harness();
    const it = await h.capture(occ('hoof', '2026-11-04', F2));
    h.token.valid = false;
    h.session.refreshOk = false;
    const r = await h.worker().drain();
    expect(r.paused).toBe('auth_required');
    expect(h.store.get(it.operationId)).toMatchObject({ state: 'retry_wait', lastErrorCode: 'auth_required', attemptCount: 0 });
  });
});

d('SIGKILL of a real child process during sync (local replica)', () => {
  const outDir = path.join(process.env.G5_TMP || require('node:os').tmpdir(), 'g5-compiled');
  beforeAll(() => {
    const root = path.resolve(__dirname, '..');
    const files = ['domain/sha256.ts', 'domain/types.ts', 'domain/retry.ts', 'domain/ports.ts', 'domain/queueStore.ts', 'domain/worker.ts',
      'domain/capture.ts', 'testing/nodeHarness.ts', 'testing/replicaTransport.ts', 'testing/killChild.ts'].map((f) => path.join(root, f));
    cp.execFileSync(path.resolve(__dirname, '../../../../node_modules/.bin/tsc'),
      ['--ignoreConfig', '--outDir', outDir, '--rootDir', root, '--module', 'commonjs', '--moduleResolution', 'node10', '--ignoreDeprecations', '6.0', '--target', 'es2022',
        '--strict', '--skipLibCheck', '--types', 'node', ...files], { stdio: 'pipe' });
  }, 120_000);

  async function killAt(point: 'before_upload' | 'after_submit', slot: string) {
    const h = harness();
    const mark = path.join(h.dir, 'mark');
    const temp = h.vault.writeTemp('kill.jpg', `synthetic ${crypto.randomUUID()}`);
    const child = cp.spawn(process.execPath, [path.join(outDir, 'testing/killChild.js')], {
      env: { ...process.env, G5_DB: h.dbFile, G5_VAULT: h.vault.root, G5_PG_PORT: PORT, G5_USER: B4, G5_HUB: E1, G5_OCC: occ(slot, '2026-11-07'),
        G5_HORSE: F1, G5_TEMP: temp, G5_MARK: mark, G5_KILL_AT: point },
      stdio: 'ignore',
    });
    const t0 = Date.now();
    while (!fs.existsSync(mark) && !fs.existsSync(`${mark}.err`) && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 50));
    if (fs.existsSync(`${mark}.err`)) throw new Error(fs.readFileSync(`${mark}.err`, 'utf8'));
    expect(fs.readFileSync(mark, 'utf8')).toBe(point);
    const exited = new Promise<NodeJS.Signals | null>((r) => child.on('exit', (_c, sig) => r(sig)));
    child.kill('SIGKILL');
    expect(await exited).toBe('SIGKILL');
    const op = fs.readFileSync(`${mark}.op`, 'utf8');
    h.restart();
    return { h, op };
  }

  test('K01 killed during upload → after restart the work is uploaded and submitted exactly once', async () => {
    const { h, op } = await killAt('before_upload', 'evening_water');
    expect(h.store.get(op)?.state).toBe('uploading');
    expect(subs(op)).toBe(0);
    h.advance(121_000); // the dead process's lease expires
    await h.worker('after-kill').drain();
    expect(h.store.get(op)?.state).toBe('acknowledged');
    expect(subs(op)).toBe(1);
  }, 60_000);

  test('K02 killed after the server committed, before the receipt was saved → replayed, still one row', async () => {
    const { h, op } = await killAt('after_submit', 'night_med');
    expect(h.store.get(op)?.state).toBe('submitting');
    expect(subs(op)).toBe(1);
    h.advance(121_000);
    await h.worker('after-kill').drain();
    expect(h.store.get(op)).toMatchObject({ state: 'acknowledged', serverReceipt: { replayed: true } });
    expect(subs(op)).toBe(1);
  }, 60_000);
});
