/**
 * @jest-environment node
 */
// Failure injection for the offline queue (10 §Failure acceptance matrix). Real SQLite file + real files; synthetic data.
import { captureCareEvidence, recoverInterruptedCaptures, evidenceRef } from '../domain/capture';
import { discardItem, runCleanup, signOutSummary } from '../domain/maintenance';
import { StorageFullError, TransportError } from '../domain/ports';
import { QueueStore } from '../domain/queueStore';
import { SyncWorker } from '../domain/worker';
import { DirVault, FakeClock, FakeSession, InMemoryServer, openNodeSqlite, tempDir, testId } from '../testing/nodeHarness';

const A = 'user-groom-a';
const B = 'user-groom-b';
const HUB = 'hub-e1';

function setup() {
  const dir = tempDir('worker');
  const dbFile = `${dir}/outbox.db`;
  const server = new InMemoryServer();
  server.staff.set(A, { hubId: HUB, role: 'GROOM' });
  server.staff.set(B, { hubId: HUB, role: 'GROOM' });
  server.tasks.set('occ-1', { hubId: HUB, horseId: 'horse-1', status: 'pending', assigned: new Set([A, B]) });
  server.tasks.set('occ-2', { hubId: HUB, horseId: 'horse-1', status: 'pending', assigned: new Set([A]) });
  server.tasks.set('occ-3', { hubId: HUB, horseId: 'horse-2', status: 'pending', assigned: new Set([A]) });
  server.tokenSubject = A;
  const clock = new FakeClock();
  const session = new FakeSession({ subjectId: A, hubId: HUB });
  session.refresh = async () => {
    session.refreshCalls++;
    if (session.refreshOk) server.tokenValid = true;
    return session.refreshOk;
  };
  const vault = new DirVault(`${dir}/files`, server);
  const open = () => {
    const db = openNodeSqlite(dbFile);
    const store = new QueueStore(db);
    store.migrate();
    return { db, store };
  };
  let { db, store } = open();
  let n = 0;
  const worker = (id = 'w1', extra: Partial<ConstructorParameters<typeof SyncWorker>[0]> = {}) =>
    new SyncWorker({ store, transport: server.transport(), files: vault, session, clock, random: () => 0.5, workerId: id, ...extra });
  const capture = async (occurrenceId = 'occ-1', opts: { accuracyM?: number | null; location?: boolean; horseId?: string } = {}) => {
    n++;
    const temp = vault.writeTemp(`cap-${n}.jpg`, `synthetic jpeg bytes ${n}`);
    const r = await captureCareEvidence(
      { store, files: vault, session, clock, newId: () => testId() },
      {
        occurrenceId,
        horseId: opts.horseId ?? server.tasks.get(occurrenceId)?.horseId ?? 'horse-1',
        hubId: HUB,
        tempPhotoRef: temp,
        mimeType: 'image/jpeg',
        observedAt: clock.now(),
        location: opts.location === false ? null : { latitude: 16.5, longitude: 80.6, accuracyM: opts.accuracyM === undefined ? 10 : opts.accuracyM },
      },
      true,
    );
    if (!r.ok) throw new Error(`capture failed: ${r.error}`);
    return r.item;
  };
  /** simulate an app restart: drop every in-memory object, reopen the same database file */
  const restart = () => {
    db.close();
    ({ db, store } = open());
    return store;
  };
  return {
    dir, server, clock, session, vault, capture, restart, worker,
    get store() {
      return store;
    },
  };
}

describe('offline queue failure injection', () => {
  test('F01 capture in airplane mode, restart, reconnect: published exactly once', async () => {
    const h = setup();
    h.server.offline = true;
    const item = await h.capture();
    expect(h.store.get(item.operationId)?.state).toBe('ready'); // "Saved on this phone" is truthful now
    const r1 = await h.worker().drain();
    expect(r1.acknowledged).toBe(0);
    expect(h.store.get(item.operationId)?.state).toBe('retry_wait');
    h.restart();
    h.server.offline = false;
    h.clock.advance(60_000);
    const r2 = await h.worker('w-after-restart').drain();
    expect(r2.acknowledged).toBe(1);
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
    expect(await h.worker().drain()).toEqual({ processed: 0, acknowledged: 0, paused: null });
    expect(h.server.submissions).toHaveLength(1);
  });

  test('F02 server commits but the response is lost: same key returns the original receipt, no duplicate', async () => {
    const h = setup();
    const item = await h.capture();
    h.server.dropResponseAfterCommit = 1;
    await h.worker().drain();
    expect(h.store.get(item.operationId)?.state).toBe('retry_wait');
    h.clock.advance(60_000);
    await h.worker().drain();
    const done = h.store.get(item.operationId)!;
    expect(done.state).toBe('acknowledged');
    expect(done.serverReceipt?.replayed).toBe(true);
    expect(h.server.submissions).toHaveLength(1);
  });

  test('F03 duplicate workers on separate connections to the same database submit each item once', async () => {
    const h = setup();
    const items = [await h.capture('occ-1'), await h.capture('occ-2'), await h.capture('occ-3')];
    const second = openNodeSqlite(`${h.dir}/outbox.db`);
    const store2 = new QueueStore(second);
    const w2 = new SyncWorker({ store: store2, transport: h.server.transport(), files: h.vault, session: h.session, clock: h.clock, random: () => 0.5, workerId: 'w2' });
    const [r1, r2] = await Promise.all([h.worker('w1').drain(), w2.drain()]);
    expect(r1.acknowledged + r2.acknowledged).toBe(3);
    expect(h.server.submissions.map((s) => s.operationId).sort()).toEqual(items.map((i) => i.operationId).sort());
    expect(h.vault.uploads).toHaveLength(3);
    second.close();
  });

  test('F04 kill during upload (process frozen mid-upload, then restarted): recovered after lease expiry, sent once', async () => {
    const h = setup();
    const item = await h.capture();
    void h.worker('dies', { checkpoint: (name) => (name === 'before_upload' ? new Promise<void>(() => {}) : undefined) }).drain();
    await new Promise((r) => setImmediate(r));
    const store = h.restart();
    expect(store.get(item.operationId)?.state).toBe('uploading');
    expect((await h.worker('early').drain()).processed).toBe(0); // lease still valid: no second worker steals it
    h.clock.advance(121_000);
    await h.worker('w-new').drain();
    expect(store.get(item.operationId)?.state).toBe('acknowledged');
    expect(h.server.submissions).toHaveLength(1);
  });

  test('F05 kill after the server committed the submission, before the receipt was saved: replay, no duplicate', async () => {
    const h = setup();
    const item = await h.capture();
    void h.worker('dies', { checkpoint: (name) => (name === 'after_submit' ? new Promise<void>(() => {}) : undefined) }).drain();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.server.submissions).toHaveLength(1);
    const store = h.restart();
    expect(store.get(item.operationId)?.state).toBe('submitting');
    h.clock.advance(121_000);
    await h.worker('w-new').drain();
    const done = store.get(item.operationId)!;
    expect(done.state).toBe('acknowledged');
    expect(done.serverReceipt?.replayed).toBe(true);
    expect(done.upload.done).toBe(true);
    expect(h.vault.uploads).toHaveLength(1); // upload progress survived the kill
    expect(h.server.submissions).toHaveLength(1);
  });

  test('F06 session expired: refresh once and continue; if refresh fails, pause for sign-in without burning attempts', async () => {
    const h = setup();
    const a = await h.capture();
    h.server.tokenValid = false;
    const r = await h.worker().drain();
    expect(h.session.refreshCalls).toBe(1);
    expect(r.acknowledged).toBe(1);
    expect(h.store.get(a.operationId)?.state).toBe('acknowledged');

    const b = await h.capture('occ-2');
    h.server.tokenValid = false;
    h.session.refreshOk = false;
    const r2 = await h.worker().drain();
    expect(r2.paused).toBe('auth_required');
    const parked = h.store.get(b.operationId)!;
    expect(parked.state).toBe('retry_wait');
    expect(parked.lastErrorCode).toBe('auth_required');
    expect(parked.attemptCount).toBe(0);
  });

  test('F07 upload URL expires mid-transfer: intent renewed once and the upload succeeds', async () => {
    const h = setup();
    const item = await h.capture();
    let first = true;
    h.vault.failUpload = () => {
      if (!first) return null;
      first = false;
      return new TransportError('http', { status: 403, code: 'upload_url_expired' });
    };
    await h.worker().drain();
    expect(h.server.intentsIssued).toBe(2);
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
  });

  test('F08 server cannot find the uploaded object: re-upload on the next attempt', async () => {
    const h = setup();
    const item = await h.capture();
    const origUpload = h.vault.upload.bind(h.vault); // first upload "succeeds" locally but the object never lands
    let lose = true;
    h.vault.upload = async (ref, target) => {
      await origUpload(ref, target);
      if (lose) {
        lose = false;
        h.server.objects.delete(target.mediaPath);
      }
    };
    await h.worker().drain();
    const parked = h.store.get(item.operationId)!;
    expect(parked.state).toBe('retry_wait');
    expect(parked.lastErrorCode).toBe('media_not_found');
    expect(parked.upload.done).toBe(false);
    h.clock.advance(60_000);
    await h.worker().drain();
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
    expect(h.vault.uploads).toHaveLength(2);
  });

  test('F09 staff access revoked before sync: blocked, evidence retained, not retried automatically', async () => {
    const h = setup();
    const item = await h.capture();
    h.server.staff.set(A, { hubId: HUB, role: 'PARENT' });
    await h.worker().drain();
    const blocked = h.store.get(item.operationId)!;
    expect(blocked.state).toBe('blocked');
    expect(blocked.lastErrorCode).toBe('access_revoked');
    expect(await h.vault.exists(blocked.localFileRefs[0]!)).toBe(true);
    const calls = h.server.calls;
    h.clock.advance(3_600_000);
    expect((await h.worker().drain()).processed).toBe(0);
    expect(h.server.calls).toBe(calls);
    // access restored by the owner, staff taps Retry
    h.server.staff.set(A, { hubId: HUB, role: 'GROOM' });
    expect(h.store.retryNow(item.operationId, A, h.clock.now())).toBe(true);
    await h.worker().drain();
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
  });

  test('F10 account switch with queued work: B never sends or sees A’s items; A’s work resumes after switching back', async () => {
    const h = setup();
    h.server.offline = true;
    const item = await h.capture();
    await h.worker().drain();
    h.server.offline = false;
    h.session.who = { subjectId: B, hubId: HUB };
    h.server.tokenSubject = B;
    h.clock.advance(60_000);
    expect((await h.worker().drain()).processed).toBe(0);
    expect(h.store.listForOwner(B)).toHaveLength(0);
    expect(h.store.countPendingForOtherOwners(B)).toBe(1);
    expect(h.server.submissions).toHaveLength(0);
    h.session.who = { subjectId: A, hubId: HUB };
    h.server.tokenSubject = A;
    await h.worker().drain();
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
    expect(h.server.submissions[0]?.actorId).toBe(A);
  });

  test('F11 account switches in the middle of a drain: the item is handed back, nothing is sent with B’s token', async () => {
    const h = setup();
    const item = await h.capture();
    const r = await h
      .worker('w', {
        checkpoint: (name) => {
          if (name === 'before_submit') {
            h.session.who = { subjectId: B, hubId: HUB };
            h.server.tokenSubject = B;
          }
        },
      })
      .drain();
    expect(r.paused).toBe('account_changed');
    const it = h.store.get(item.operationId)!;
    expect(it.state).toBe('ready');
    expect(it.actorId).toBe(A);
    expect(h.server.submissions).toHaveLength(0);
  });

  test('F12 evidence for an already completed task: kept, receipt says already_completed + review_required', async () => {
    const h = setup();
    h.server.tasks.get('occ-1')!.status = 'completed';
    const item = await h.capture();
    await h.worker().drain();
    const done = h.store.get(item.operationId)!;
    expect(done.state).toBe('acknowledged');
    expect(done.serverReceipt).toMatchObject({ outcome: 'already_completed', reviewState: 'review_required' });
    expect(h.server.submissions).toHaveLength(1);
  });

  test('F13 disk full: capture refused up front or on finalise; earlier drafts untouched', async () => {
    const h = setup();
    const earlier = await h.capture();
    h.vault.free = 10 * 1024 * 1024;
    const temp = h.vault.writeTemp('x.jpg', 'bytes');
    const deps = { store: h.store, files: h.vault, session: h.session, clock: h.clock, newId: () => testId() };
    const input = { occurrenceId: 'occ-2', horseId: 'horse-1', hubId: HUB, tempPhotoRef: temp, mimeType: 'image/jpeg' as const, observedAt: h.clock.now(), location: null };
    expect(await captureCareEvidence(deps, input, true)).toEqual({ ok: false, error: 'storage_full' });
    h.vault.free = 10 * 1024 * 1024 * 1024;
    h.vault.failNextFinalize = new StorageFullError();
    expect(await captureCareEvidence(deps, input, true)).toEqual({ ok: false, error: 'storage_full' });
    const mine = h.store.listForOwner(A);
    expect(mine.map((i) => i.operationId)).toEqual([earlier.operationId]);
    expect(await h.vault.exists(earlier.localFileRefs[0]!)).toBe(true);
  });

  test('F14 evidence file missing before upload: needs recapture, row kept, never silently dropped', async () => {
    const h = setup();
    const item = await h.capture();
    await h.vault.remove(item.localFileRefs[0]!);
    await h.worker().drain();
    const it = h.store.get(item.operationId)!;
    expect(it.state).toBe('needs_recapture');
    expect(it.lastErrorCode).toBe('missing_file');
    expect(h.server.calls).toBe(0);
  });

  test('F15 poor location accuracy and denied location are submitted and routed to review, never "verified"', async () => {
    const h = setup();
    const weak = await h.capture('occ-1', { accuracyM: 300 });
    const none = await h.capture('occ-2', { location: false });
    await h.worker().drain();
    expect(h.store.get(weak.operationId)?.serverReceipt).toMatchObject({ reviewState: 'review_required', reviewReasons: ['weak_location_accuracy'] });
    expect(h.store.get(none.operationId)?.serverReceipt).toMatchObject({ reviewState: 'review_required', reviewReasons: ['location_missing'] });
    expect(JSON.stringify(h.store.listForOwner(A))).not.toMatch(/verified/i);
  });

  test('F16 bounded retries: 8 transient failures → needs_attention, kept, no further automatic attempts', async () => {
    const h = setup();
    const item = await h.capture();
    h.server.offline = true;
    for (let i = 0; i < 12; i++) {
      await h.worker().drain();
      h.clock.advance(16 * 60_000);
    }
    const it = h.store.get(item.operationId)!;
    expect(it.state).toBe('needs_attention');
    expect(it.attemptCount).toBe(8);
    expect(it.nextAttemptAt).toBeNull();
    expect(await h.vault.exists(it.localFileRefs[0]!)).toBe(true);
  });

  test('F17 server Retry-After is honoured and the delay is capped at 15 minutes', async () => {
    const h = setup();
    const item = await h.capture();
    const t = h.server.transport();
    const failing = { ...t, submit: async () => { throw new TransportError('http', { status: 503, code: 'busy', retryAfterMs: 10 * 60_000 }); } };
    await new SyncWorker({ store: h.store, transport: failing, files: h.vault, session: h.session, clock: h.clock, random: () => 0, workerId: 'w' }).drain();
    const it = h.store.get(item.operationId)!;
    expect(it.nextAttemptAt! - h.clock.now()).toBe(10 * 60_000);
    const failing2 = { ...t, submit: async () => { throw new TransportError('http', { status: 429, retryAfterMs: 60 * 60_000 }); } };
    h.clock.advance(11 * 60_000);
    await new SyncWorker({ store: h.store, transport: failing2, files: h.vault, session: h.session, clock: h.clock, random: () => 0, workerId: 'w' }).drain();
    expect(h.store.get(item.operationId)!.nextAttemptAt! - h.clock.now()).toBe(15 * 60_000);
  });

  test('F18 dependency ordering: a dependent item waits until its dependency is acknowledged', async () => {
    const h = setup();
    const first = await h.capture('occ-1');
    const second = await h.capture('occ-2');
    // make `second` depend on `first` (e.g. a correction that needs the original receipt)
    (h.store as unknown as { db: { run: (s: string, p: unknown[]) => void } }).db.run(
      `update outbox set dependency_ids = ? where operation_id = ?`, [JSON.stringify([first.operationId]), second.operationId]);
    h.server.tasks.delete('occ-1'); // first fails permanently (task_not_found → needs_review)
    await h.worker().drain();
    expect(h.store.get(first.operationId)?.state).toBe('needs_review');
    expect(h.store.get(second.operationId)?.state).toBe('ready');
    expect(h.server.submissions).toHaveLength(0);
  });

  test('F19 crash between queue row and file move: launch recovery finishes or flags it, never deletes', async () => {
    const h = setup();
    const withFile = testId();
    const withoutFile = testId();
    for (const op of [withFile, withoutFile]) {
      h.store.insertCapturing({ operationId: op, actorId: A, hubId: HUB, aggregateId: 'occ-1', commandType: 'care.submitEvidence', payloadVersion: 1,
        payload: { occurrenceId: 'occ-1', horseId: 'horse-1', observedAt: new Date(h.clock.now()).toISOString(), location: null, evidence: null },
        payloadHash: 'pending', localFileRefs: [evidenceRef(A, op)], observedAt: h.clock.now() }, h.clock.now());
    }
    const temp = h.vault.writeTemp('moved.jpg', 'bytes that made it');
    await h.vault.finalize(temp, evidenceRef(A, withFile));
    h.restart();
    expect(await recoverInterruptedCaptures({ store: h.store, files: h.vault, clock: h.clock })).toEqual({ recovered: 1, needsRecapture: 1 });
    expect(h.store.get(withFile)?.state).toBe('ready');
    expect(h.store.get(withFile)?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.store.get(withoutFile)?.state).toBe('needs_recapture');
  });

  test('F20 discard needs explicit confirmation, writes a tombstone, then deletes; acknowledged work cannot be discarded', async () => {
    const h = setup();
    const keep = await h.capture('occ-1');
    const drop = await h.capture('occ-2');
    h.server.offline = true;
    await h.worker().drain();
    await expect(discardItem({ store: h.store, files: h.vault, clock: h.clock }, drop.operationId, A, { confirmed: false as unknown as true, reason: 'x' })).rejects.toThrow('confirmation_required');
    await expect(discardItem({ store: h.store, files: h.vault, clock: h.clock }, drop.operationId, B, { confirmed: true, reason: 'x' })).rejects.toThrow('not_owner');
    const t = await discardItem({ store: h.store, files: h.vault, clock: h.clock }, drop.operationId, A, { confirmed: true, reason: 'wrong horse' });
    expect(t).toMatchObject({ hadEvidence: true, previousState: 'retry_wait', reason: 'wrong horse' });
    expect(await h.vault.exists(drop.localFileRefs[0]!)).toBe(false);
    expect(h.store.tombstones(A)).toHaveLength(1);
    h.server.offline = false;
    h.clock.advance(60_000);
    await h.worker().drain();
    await expect(discardItem({ store: h.store, files: h.vault, clock: h.clock }, keep.operationId, A, { confirmed: true, reason: 'x' })).rejects.toThrow('cannot_discard_acknowledged');
    expect(h.server.submissions.map((s) => s.operationId)).toEqual([keep.operationId]);
  });

  test('F21 cleanup: removes local photos only after receipt + grace; unsynced and orphan files are never deleted', async () => {
    const h = setup();
    const sent = await h.capture('occ-1');
    await h.worker().drain();
    h.server.offline = true;
    const unsent = await h.capture('occ-2');
    await h.worker().drain();
    const orphan = h.vault.writeTemp('o.jpg', 'orphan');
    await h.vault.finalize(orphan, 'evidence/user-groom-a/orphan.jpg');
    const deps = { store: h.store, files: h.vault, clock: h.clock };
    expect((await runCleanup(deps)).filesRemoved).toBe(0); // within 24 h grace
    h.clock.advance(25 * 3_600_000);
    const rep = await runCleanup(deps);
    expect(rep.filesRemoved).toBe(1);
    expect(rep.orphanFiles).toEqual(['evidence/user-groom-a/orphan.jpg']);
    expect(await h.vault.exists(sent.localFileRefs[0]!)).toBe(false);
    expect(await h.vault.exists(unsent.localFileRefs[0]!)).toBe(true);
    expect(await h.vault.exists('evidence/user-groom-a/orphan.jpg')).toBe(true);
    expect(signOutSummary(h.store, A)).toEqual({ pending: 1, options: ['finish_sync', 'keep_locked', 'discard'] });
  });

  test('F22 a worker that lost its lease cannot overwrite the new owner’s result', async () => {
    const h = setup();
    const item = await h.capture();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = h.worker('slow', { checkpoint: (name) => (name === 'before_submit' ? gate : undefined) }).drain();
    await new Promise((r) => setImmediate(r));
    h.clock.advance(121_000); // slow worker's lease expires
    await h.worker('fast').drain();
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
    release();
    await slow;
    // slow worker submitted too (replayed by server idempotency) but could not touch the acknowledged row
    expect(h.store.get(item.operationId)?.state).toBe('acknowledged');
    expect(h.server.submissions).toHaveLength(1);
  });
});
