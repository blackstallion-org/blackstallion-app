// Test-only harness (never imported by app code): real SQLite file via node:sqlite, real temp-directory file vault,
// controllable clock/session, and an in-memory server that applies the same idempotency rules as the SQL delta.
/* eslint-disable @typescript-eslint/no-require-imports */
import type { Clock, FileVault, SessionPort, SqlDriver, SqlValue, StoredFile, SubmitRequest, Transport, UploadIntentRequest, UploadTarget } from '../domain/ports';
import { StorageFullError, TransportError } from '../domain/ports';

const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
const crypto = require('node:crypto') as typeof import('node:crypto');

export function openNodeSqlite(file: string): SqlDriver & { close(): void } {
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => any };
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;');
  return {
    exec: (sql: string) => db.exec(sql),
    run: (sql: string, params: readonly SqlValue[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    all: <T,>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    transaction<T>(fn: () => T): T {
      db.exec('begin immediate');
      try {
        const out = fn();
        db.exec('commit');
        return out;
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
    close: () => db.close(),
  };
}

export class FakeClock implements Clock {
  constructor(public t = Date.parse('2026-11-04T06:00:00Z')) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export class FakeSession implements SessionPort {
  refreshOk = true;
  refreshCalls = 0;
  constructor(public who: { subjectId: string; hubId: string | null } | null) {}
  current() {
    return this.who;
  }
  async refresh(): Promise<boolean> {
    this.refreshCalls++;
    return this.refreshOk;
  }
}

/** Real files in a temp dir. `failNextFinalize` simulates ENOSPC; `failUpload` simulates transport faults. */
export class DirVault implements FileVault {
  free = 10 * 1024 * 1024 * 1024;
  failNextFinalize: Error | null = null;
  failUpload: ((ref: string, target: UploadTarget) => Error | null) | null = null;
  uploads: { ref: string; mediaPath: string }[] = [];
  constructor(public readonly root: string, private readonly server?: InMemoryServer) {
    fs.mkdirSync(root, { recursive: true });
  }
  abs(ref: string): string {
    return path.join(this.root, ref);
  }
  writeTemp(name: string, content: string): string {
    const ref = `tmp/${name}`;
    fs.mkdirSync(path.dirname(this.abs(ref)), { recursive: true });
    fs.writeFileSync(this.abs(ref), content);
    return ref;
  }
  async freeBytes() {
    return this.free;
  }
  async finalize(tempRef: string, finalRef: string): Promise<StoredFile> {
    if (this.failNextFinalize) {
      const e = this.failNextFinalize;
      this.failNextFinalize = null;
      throw e;
    }
    const dst = this.abs(finalRef);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const fd = fs.openSync(this.abs(tempRef), 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(this.abs(tempRef), dst); // atomic on the same volume
    return (await this.stat(finalRef))!;
  }
  async exists(ref: string) {
    return fs.existsSync(this.abs(ref));
  }
  async stat(ref: string): Promise<StoredFile | null> {
    try {
      const buf = fs.readFileSync(this.abs(ref));
      return { ref, sizeBytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    } catch {
      return null;
    }
  }
  async remove(ref: string) {
    fs.rmSync(this.abs(ref), { force: true });
  }
  async upload(ref: string, target: UploadTarget) {
    const err = this.failUpload?.(ref, target) ?? null;
    if (err) throw err;
    if (!fs.existsSync(this.abs(ref))) throw new Error('file vanished during upload');
    this.uploads.push({ ref, mediaPath: target.mediaPath });
    this.server?.storeObject(target.mediaPath);
  }
  async listFinalRefs() {
    const base = this.abs('evidence');
    if (!fs.existsSync(base)) return [];
    const out: string[] = [];
    for (const actor of fs.readdirSync(base)) for (const f of fs.readdirSync(path.join(base, actor))) out.push(`evidence/${actor}/${f}`);
    return out;
  }
}

export function storageFull(): StorageFullError {
  return new StorageFullError();
}

interface ServerTask {
  hubId: string;
  horseId: string;
  status: 'pending' | 'submitted' | 'completed';
  assigned: Set<string>;
}

/**
 * Mirrors field.submit_care_evidence semantics: receipts keyed by operation id + payload hash, auth re-read per call,
 * evidence retained for completed tasks, media must exist. Used where the real replica is not running.
 */
export class InMemoryServer {
  receipts = new Map<string, { actorId: string; hash: string; result: Record<string, unknown> }>();
  submissions: { operationId: string; actorId: string; occurrenceId: string; reviewState: string }[] = [];
  objects = new Set<string>();
  staff = new Map<string, { hubId: string; role: 'GROOM' | 'PARENT' }>();
  tasks = new Map<string, ServerTask>();
  /** the account whose token the transport currently carries */
  tokenSubject: string | null = null;
  tokenValid = true;
  offline = false;
  /** commit, then lose the response (network drop after commit) */
  dropResponseAfterCommit = 0;
  intentsIssued = 0;
  calls = 0;

  storeObject(p: string) {
    this.objects.add(p);
  }

  transport(): Transport {
    return {
      createUploadIntent: async (req: UploadIntentRequest): Promise<UploadTarget> => {
        this.guard(req.actorId);
        this.intentsIssued++;
        const s = this.staff.get(req.actorId)!;
        return { mediaPath: `${s.hubId}/${req.actorId}/${req.operationId}.jpg`, url: `https://upload.invalid/${req.operationId}`, expiresAt: Date.now() + 60_000 };
      },
      submit: async (req: SubmitRequest) => {
        this.guard(req.actorId);
        const result = this.submit(req);
        if (this.dropResponseAfterCommit > 0) {
          this.dropResponseAfterCommit--;
          throw new TransportError('network', { message: 'response lost after commit' });
        }
        return result;
      },
    };
  }

  private guard(actorId: string) {
    this.calls++;
    if (this.offline) throw new TransportError('network', { message: 'offline' });
    if (!this.tokenValid || !this.tokenSubject) throw new TransportError('http', { status: 401, code: 'no_session' });
    // what a correct adapter must do: never send another account's work with the live token
    if (this.tokenSubject !== actorId) throw new TransportError('http', { status: 403, code: 'not_owner_session' });
  }

  private submit(req: SubmitRequest): Record<string, unknown> {
    const actor = this.tokenSubject!;
    const prev = this.receipts.get(req.operationId);
    if (prev) {
      if (prev.actorId !== actor || prev.hash !== req.payloadHash) throw new TransportError('http', { status: 409, code: 'idempotency_key_reused' });
      return { ...prev.result, replayed: true };
    }
    const s = this.staff.get(actor);
    if (!s || s.role !== 'GROOM') throw new TransportError('http', { status: 403, code: 'access_revoked' });
    const p = req.payload as { occurrenceId: string; horseId: string; mediaPath: string; location: { accuracyM: number | null } | null };
    const task = this.tasks.get(p.occurrenceId);
    if (!task) throw new TransportError('http', { status: 404, code: 'task_not_found' });
    if (task.hubId !== s.hubId) throw new TransportError('http', { status: 403, code: 'cross_hub_denied' });
    if (task.horseId !== p.horseId) throw new TransportError('http', { status: 403, code: 'horse_mismatch' });
    if (!task.assigned.has(actor)) throw new TransportError('http', { status: 403, code: 'not_assigned' });
    if (!this.objects.has(p.mediaPath)) throw new TransportError('http', { status: 404, code: 'media_not_found' });
    const reasons: string[] = [];
    if (!p.location) reasons.push('location_missing');
    else if (p.location.accuracyM == null || p.location.accuracyM > 50) reasons.push('weak_location_accuracy');
    let outcome = 'recorded';
    if (task.status === 'completed') {
      reasons.push('task_already_completed');
      outcome = 'already_completed';
    } else if (task.status === 'submitted') {
      reasons.push('task_already_submitted');
      outcome = 'already_submitted';
    } else task.status = 'submitted';
    const reviewState = reasons.length ? 'review_required' : 'received';
    this.submissions.push({ operationId: req.operationId, actorId: actor, occurrenceId: p.occurrenceId, reviewState });
    const result = { receiptId: req.operationId, reviewState, reviewReasons: reasons, outcome };
    this.receipts.set(req.operationId, { actorId: actor, hash: req.payloadHash, result });
    return { ...result, replayed: false };
  }
}

let seq = 0;
export function testId(prefix = 'op'): string {
  seq++;
  return `${prefix}-${String(seq).padStart(4, '0')}-${crypto.randomUUID()}`;
}

export function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(process.env.G5_TMP || require('node:os').tmpdir(), `g5-${label}-`));
}
