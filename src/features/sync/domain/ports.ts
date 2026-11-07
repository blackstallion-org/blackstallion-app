// Ports the queue depends on. Production adapters (expo-sqlite, expo-file-system, Supabase rpc/storage) plug in here;
// tests use node:sqlite, a real temp directory and an in-memory or local-replica server.

/** Minimal synchronous SQL surface satisfied by expo-sqlite (execSync/runSync/getAllSync) and node:sqlite. */
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): { changes: number };
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  /** BEGIN IMMEDIATE … COMMIT; rolls back on throw */
  transaction<T>(fn: () => T): T;
}
export type SqlValue = string | number | null;

export interface StoredFile {
  ref: string;
  sizeBytes: number;
  sha256: string;
}

/** App-private evidence files. Never a public/shared directory. */
export interface FileVault {
  /** 'memory' when file references don't survive an app restart (outbox then reports memory too). Default durable. */
  readonly durability?: 'durable' | 'memory';
  freeBytes(): Promise<number>;
  /** Close and atomically move a finished temp capture to its final private path; returns hash and size. */
  finalize(tempRef: string, finalRef: string): Promise<StoredFile>;
  exists(ref: string): Promise<boolean>;
  /** Hash and size of a finalised file, or null when it is missing/unreadable. */
  stat(ref: string): Promise<StoredFile | null>;
  remove(ref: string): Promise<void>;
  /** Upload to a server-issued private target. Throws TransportError(kind 'http', code 'upload_url_expired') on expiry. */
  upload(ref: string, target: UploadTarget): Promise<void>;
  listFinalRefs(): Promise<string[]>;
}

export interface UploadTarget {
  mediaPath: string;
  url: string;
  expiresAt: number;
}

export interface UploadIntentRequest {
  operationId: string;
  actorId: string;
  purpose: 'care_proof';
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface SubmitRequest {
  operationId: string;
  /** owner of the work; the adapter must refuse to send when the live session belongs to someone else */
  actorId: string;
  payloadHash: string;
  commandType: string;
  payload: Record<string, unknown>;
}

export interface Transport {
  createUploadIntent(req: UploadIntentRequest): Promise<UploadTarget>;
  submit(req: SubmitRequest): Promise<Record<string, unknown>>;
}

export type TransportErrorKind = 'network' | 'timeout' | 'http';

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterMs: number | null;
  constructor(kind: TransportErrorKind, opts: { status?: number; code?: string; retryAfterMs?: number; message?: string } = {}) {
    super(opts.message ?? `${kind}${opts.status ? ` ${opts.status}` : ''}${opts.code ? ` ${opts.code}` : ''}`);
    this.name = 'TransportError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

export class StorageFullError extends Error {
  constructor(message = 'storage_full') {
    super(message);
    this.name = 'StorageFullError';
  }
}

/** Current authenticated identity, from the server-derived access snapshot (07). */
export interface SessionPort {
  current(): { subjectId: string; hubId: string | null } | null;
  /** Refresh the session once; false means the user must sign in again. */
  refresh(): Promise<boolean>;
}

export interface Clock {
  now(): number;
}
