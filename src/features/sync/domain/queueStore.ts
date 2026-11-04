// Durable outbox on SQLite. Everything the worker knows lives here, so a killed process loses nothing it acknowledged.
import type { SqlDriver, SqlValue } from './ports';
import { ACTIVE_STATES, type QueueItem, type QueueState, type ServerReceipt, type Tombstone } from './types';

const SCHEMA_VERSION = 1;

interface Row {
  operation_id: string;
  actor_id: string;
  hub_id: string;
  aggregate_id: string;
  command_type: string;
  payload_version: number;
  payload_json: string;
  payload_hash: string;
  dependency_ids: string;
  local_file_refs: string;
  state: string;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_until: number | null;
  created_at: number;
  observed_at: number;
  updated_at: number;
  acknowledged_at: number | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  upload_media_path: string | null;
  upload_done: number;
  server_receipt: string | null;
}

function toItem(r: Row): QueueItem {
  return {
    operationId: r.operation_id,
    actorId: r.actor_id,
    hubId: r.hub_id,
    aggregateId: r.aggregate_id,
    commandType: r.command_type as QueueItem['commandType'],
    payloadVersion: r.payload_version,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    payloadHash: r.payload_hash,
    dependencyIds: JSON.parse(r.dependency_ids) as string[],
    localFileRefs: JSON.parse(r.local_file_refs) as string[],
    state: r.state as QueueState,
    attemptCount: r.attempt_count,
    nextAttemptAt: r.next_attempt_at,
    leaseOwner: r.lease_owner,
    leaseUntil: r.lease_until,
    createdAt: r.created_at,
    observedAt: r.observed_at,
    updatedAt: r.updated_at,
    acknowledgedAt: r.acknowledged_at,
    lastErrorCode: r.last_error_code,
    lastErrorDetail: r.last_error_detail,
    upload: { mediaPath: r.upload_media_path, done: r.upload_done === 1 },
    serverReceipt: r.server_receipt ? (JSON.parse(r.server_receipt) as ServerReceipt) : null,
  };
}

export interface NewQueueItem {
  operationId: string;
  actorId: string;
  hubId: string;
  aggregateId: string;
  commandType: QueueItem['commandType'];
  payloadVersion: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  dependencyIds?: string[];
  localFileRefs: string[];
  observedAt: number;
}

/** Fields the worker may change while it holds the lease. */
export interface LeasedPatch {
  state?: QueueState;
  attemptCount?: number;
  nextAttemptAt?: number | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
  uploadMediaPath?: string | null;
  uploadDone?: boolean;
  payload?: Record<string, unknown>;
  payloadHash?: string;
  localFileRefs?: string[];
}

const ACTIVE_SQL = ACTIVE_STATES.map((s) => `'${s}'`).join(',');

export class QueueStore {
  constructor(private readonly db: SqlDriver) {}

  migrate(): void {
    this.db.exec(`
      create table if not exists g5_meta (key text primary key, value text not null);
      create table if not exists outbox (
        operation_id text primary key,
        actor_id text not null,
        hub_id text not null,
        aggregate_id text not null,
        command_type text not null,
        payload_version integer not null,
        payload_json text not null,
        payload_hash text not null,
        dependency_ids text not null default '[]',
        local_file_refs text not null default '[]',
        state text not null,
        attempt_count integer not null default 0,
        next_attempt_at integer,
        lease_owner text,
        lease_until integer,
        created_at integer not null,
        observed_at integer not null,
        updated_at integer not null,
        acknowledged_at integer,
        last_error_code text,
        last_error_detail text,
        upload_media_path text,
        upload_done integer not null default 0,
        server_receipt text
      );
      create index if not exists outbox_owner_state on outbox (actor_id, state, next_attempt_at);
      create table if not exists tombstones (
        operation_id text primary key,
        actor_id text not null,
        discarded_at integer not null,
        reason text not null,
        had_evidence integer not null,
        previous_state text not null
      );
    `);
    this.db.run(`insert into g5_meta (key, value) values ('schema_version', ?) on conflict (key) do nothing`, [
      String(SCHEMA_VERSION),
    ]);
  }

  insertCapturing(n: NewQueueItem, now: number): QueueItem {
    this.db.run(
      `insert into outbox (operation_id, actor_id, hub_id, aggregate_id, command_type, payload_version, payload_json,
         payload_hash, dependency_ids, local_file_refs, state, created_at, observed_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'capturing', ?, ?, ?)`,
      [
        n.operationId, n.actorId, n.hubId, n.aggregateId, n.commandType, n.payloadVersion, JSON.stringify(n.payload),
        n.payloadHash, JSON.stringify(n.dependencyIds ?? []), JSON.stringify(n.localFileRefs), now, n.observedAt, now,
      ],
    );
    return this.mustGet(n.operationId);
  }

  get(operationId: string): QueueItem | null {
    const r = this.db.all<Row>(`select * from outbox where operation_id = ?`, [operationId])[0];
    return r ? toItem(r) : null;
  }

  mustGet(operationId: string): QueueItem {
    const it = this.get(operationId);
    if (!it) throw new Error(`queue item ${operationId} not found`);
    return it;
  }

  /** Only the owner's items. Another account's work is never listed, only counted. */
  listForOwner(actorId: string): QueueItem[] {
    return this.db
      .all<Row>(`select * from outbox where actor_id = ? and state <> 'discarded' order by created_at, operation_id`, [actorId])
      .map(toItem);
  }

  countPendingForOtherOwners(actorId: string): number {
    const r = this.db.all<{ n: number }>(
      `select count(*) as n from outbox where actor_id <> ? and state not in ('acknowledged', 'discarded')`,
      [actorId],
    )[0];
    return r?.n ?? 0;
  }

  countPendingForOwner(actorId: string): number {
    const r = this.db.all<{ n: number }>(
      `select count(*) as n from outbox where actor_id = ? and state not in ('acknowledged', 'discarded')`,
      [actorId],
    )[0];
    return r?.n ?? 0;
  }

  /** Capture finished: file finalised and hashed. */
  markReady(operationId: string, patch: { payload: Record<string, unknown>; payloadHash: string }, now: number): void {
    const res = this.db.run(
      `update outbox set state = 'ready', payload_json = ?, payload_hash = ?, updated_at = ?
        where operation_id = ? and state = 'capturing'`,
      [JSON.stringify(patch.payload), patch.payloadHash, now, operationId],
    );
    if (res.changes !== 1) throw new Error(`markReady: ${operationId} is not capturing`);
  }

  setState(operationId: string, state: QueueState, now: number, error?: { code: string; detail?: string }): void {
    this.db.run(
      `update outbox set state = ?, updated_at = ?, last_error_code = coalesce(?, last_error_code),
         last_error_detail = coalesce(?, last_error_detail), lease_owner = null, lease_until = null
        where operation_id = ?`,
      [state, now, error?.code ?? null, error?.detail ?? null, operationId],
    );
  }

  /** Remove a row that never held evidence (capture failed before any file existed). */
  deleteUncapturedRow(operationId: string): void {
    this.db.run(`delete from outbox where operation_id = ? and state = 'capturing'`, [operationId]);
  }

  /**
   * Atomically lease the next eligible item of this owner whose dependencies are acknowledged.
   * Expired leases (crashed worker) are eligible again. Safe across processes: conditional update inside IMMEDIATE txn.
   */
  leaseNext(actorId: string, workerId: string, now: number, leaseMs: number): QueueItem | null {
    return this.db.transaction(() => {
      const candidates = this.db.all<Pick<Row, 'operation_id' | 'dependency_ids'>>(
        `select operation_id, dependency_ids from outbox
          where actor_id = ?
            and ((state in ('ready', 'retry_wait') and coalesce(next_attempt_at, 0) <= ?)
              or (state in (${ACTIVE_SQL}) and lease_until is not null and lease_until < ?))
          order by created_at, operation_id`,
        [actorId, now, now],
      );
      for (const c of candidates) {
        const deps = JSON.parse(c.dependency_ids) as string[];
        if (deps.length > 0) {
          const placeholders = deps.map(() => '?').join(',');
          const done = this.db.all<{ n: number }>(
            `select count(*) as n from outbox where operation_id in (${placeholders}) and state = 'acknowledged'`,
            deps,
          )[0]?.n ?? 0;
          if (done !== deps.length) continue;
        }
        const res = this.db.run(
          `update outbox set state = 'leased', lease_owner = ?, lease_until = ?, updated_at = ?
            where operation_id = ? and actor_id = ?
              and ((state in ('ready', 'retry_wait') and coalesce(next_attempt_at, 0) <= ?)
                or (state in (${ACTIVE_SQL}) and lease_until is not null and lease_until < ?))`,
          [workerId, now + leaseMs, now, c.operation_id, actorId, now, now],
        );
        if (res.changes === 1) return this.mustGet(c.operation_id);
      }
      return null;
    });
  }

  /** Update while holding the lease. Returns false if the lease was lost (expired and taken by another worker). */
  updateLeased(operationId: string, workerId: string, patch: LeasedPatch, now: number, extendLeaseMs?: number): boolean {
    const sets: string[] = ['updated_at = ?'];
    const params: SqlValue[] = [now];
    const add = (col: string, v: SqlValue) => {
      sets.push(`${col} = ?`);
      params.push(v);
    };
    if (patch.state !== undefined) add('state', patch.state);
    if (patch.attemptCount !== undefined) add('attempt_count', patch.attemptCount);
    if (patch.nextAttemptAt !== undefined) add('next_attempt_at', patch.nextAttemptAt);
    if (patch.lastErrorCode !== undefined) add('last_error_code', patch.lastErrorCode);
    if (patch.lastErrorDetail !== undefined) add('last_error_detail', patch.lastErrorDetail);
    if (patch.uploadMediaPath !== undefined) add('upload_media_path', patch.uploadMediaPath);
    if (patch.uploadDone !== undefined) add('upload_done', patch.uploadDone ? 1 : 0);
    if (patch.payload !== undefined) add('payload_json', JSON.stringify(patch.payload));
    if (patch.payloadHash !== undefined) add('payload_hash', patch.payloadHash);
    if (patch.localFileRefs !== undefined) add('local_file_refs', JSON.stringify(patch.localFileRefs));
    if (extendLeaseMs !== undefined) add('lease_until', now + extendLeaseMs);
    const releasing = patch.state !== undefined && !ACTIVE_STATES.includes(patch.state);
    if (releasing) sets.push('lease_owner = null', 'lease_until = null');
    params.push(operationId, workerId);
    const res = this.db.run(`update outbox set ${sets.join(', ')} where operation_id = ? and lease_owner = ?`, params);
    return res.changes === 1;
  }

  /** Persist the server receipt and finish; the only way into `acknowledged`. */
  acknowledge(operationId: string, workerId: string, receipt: ServerReceipt, now: number): boolean {
    const res = this.db.run(
      `update outbox set state = 'acknowledged', server_receipt = ?, acknowledged_at = ?, updated_at = ?,
         lease_owner = null, lease_until = null, last_error_code = null, last_error_detail = null, next_attempt_at = null
        where operation_id = ? and lease_owner = ?`,
      [JSON.stringify(receipt), now, now, operationId, workerId],
    );
    return res.changes === 1;
  }

  /** Expired leases from a crashed process become ready again (upload progress is kept). */
  recoverExpiredLeases(now: number): number {
    return this.db.run(
      `update outbox set state = 'ready', lease_owner = null, lease_until = null, updated_at = ?
        where state in (${ACTIVE_SQL}) and lease_until is not null and lease_until < ?`,
      [now, now],
    ).changes;
  }

  /** Owner asks to try again now. */
  retryNow(operationId: string, actorId: string, now: number): boolean {
    return (
      this.db.run(
        `update outbox set state = 'ready', next_attempt_at = null, attempt_count = 0, updated_at = ?
          where operation_id = ? and actor_id = ? and state in ('retry_wait', 'needs_attention', 'blocked')`,
        [now, operationId, actorId],
      ).changes === 1
    );
  }

  /**
   * Deliberate discard by the owner only. Writes a tombstone first; the caller deletes the local file only after this
   * returns. Acknowledged items cannot be "discarded" (they are already on the server).
   */
  discard(operationId: string, actorId: string, reason: string, now: number): Tombstone {
    return this.db.transaction(() => {
      const it = this.get(operationId);
      if (!it || it.actorId !== actorId) throw new Error('not_owner');
      if (it.state === 'acknowledged' || it.state === 'discarded') throw new Error(`cannot_discard_${it.state}`);
      if (ACTIVE_STATES.includes(it.state) && it.leaseUntil !== null && it.leaseUntil >= now) throw new Error('in_progress');
      const t: Tombstone = {
        operationId,
        actorId,
        discardedAt: now,
        reason,
        hadEvidence: it.localFileRefs.length > 0,
        previousState: it.state,
      };
      this.db.run(
        `insert into tombstones (operation_id, actor_id, discarded_at, reason, had_evidence, previous_state) values (?, ?, ?, ?, ?, ?)`,
        [t.operationId, t.actorId, t.discardedAt, t.reason, t.hadEvidence ? 1 : 0, t.previousState],
      );
      this.db.run(`update outbox set state = 'discarded', updated_at = ?, lease_owner = null, lease_until = null where operation_id = ?`, [
        now,
        operationId,
      ]);
      return t;
    });
  }

  tombstones(actorId: string): Tombstone[] {
    return this.db
      .all<{ operation_id: string; actor_id: string; discarded_at: number; reason: string; had_evidence: number; previous_state: string }>(
        `select * from tombstones where actor_id = ? order by discarded_at`,
        [actorId],
      )
      .map((r) => ({
        operationId: r.operation_id,
        actorId: r.actor_id,
        discardedAt: r.discarded_at,
        reason: r.reason,
        hadEvidence: r.had_evidence === 1,
        previousState: r.previous_state as QueueState,
      }));
  }

  /** Items whose local evidence may be cleaned up (acknowledged before `before`). */
  acknowledgedBefore(before: number): QueueItem[] {
    return this.db
      .all<Row>(`select * from outbox where state = 'acknowledged' and acknowledged_at < ? and local_file_refs <> '[]'`, [before])
      .map(toItem);
  }

  clearFileRefs(operationId: string, now: number): void {
    this.db.run(`update outbox set local_file_refs = '[]', updated_at = ? where operation_id = ? and state in ('acknowledged', 'discarded')`, [
      now,
      operationId,
    ]);
  }

  /** Drop acknowledged/discarded metadata older than `before` once no local file is referenced. */
  pruneMetadata(before: number): number {
    return this.db.run(
      `delete from outbox where state in ('acknowledged', 'discarded') and updated_at < ? and local_file_refs = '[]'`,
      [before],
    ).changes;
  }

  allFileRefs(): Set<string> {
    const refs = new Set<string>();
    for (const r of this.db.all<{ local_file_refs: string }>(`select local_file_refs from outbox`)) {
      for (const f of JSON.parse(r.local_file_refs) as string[]) refs.add(f);
    }
    return refs;
  }

  capturingItems(): QueueItem[] {
    return this.db.all<Row>(`select * from outbox where state = 'capturing'`).map(toItem);
  }
}
