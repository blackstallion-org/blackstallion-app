// Queue worker: lease → verify owner and files → upload private media → submit command → persist receipt.
// Server idempotency (operation id + payload hash) makes every step safe to repeat after a crash or lost response.
import { backoffDelayMs, DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry';
import type { Clock, FileVault, SessionPort, Transport, UploadTarget } from './ports';
import { TransportError } from './ports';
import type { OutboxStore } from './outboxStore';
import type { QueueItem, QueueState, ServerReceipt } from './types';

export interface WorkerDeps {
  store: OutboxStore;
  transport: Transport;
  files: FileVault;
  session: SessionPort;
  clock: Clock;
  random: () => number;
  workerId: string;
  leaseMs?: number;
  policy?: RetryPolicy;
  /** test hook: called at named points so failure injection can stop the process exactly there */
  checkpoint?: (name: 'leased' | 'before_upload' | 'after_upload' | 'before_submit' | 'after_submit', item: QueueItem) => Promise<void> | void;
}

export type PauseReason = 'no_session' | 'auth_required' | 'account_changed';

export interface DrainResult {
  processed: number;
  acknowledged: number;
  paused: PauseReason | null;
}

const BLOCKED_CODES = new Set([
  'access_revoked',
  'cross_hub_denied',
  'horse_mismatch',
  'not_assigned',
  'not_field_staff',
  'unknown_account',
  'not_owner_session',
]);

type Classified =
  | { kind: 'transient'; code: string; retryAfterMs: number | null }
  | { kind: 'auth' }
  | { kind: 'final'; state: QueueState; code: string }
  | { kind: 'reupload' };

export function classifyError(e: unknown): Classified {
  if (e instanceof TransportError) {
    const code = e.code ?? (e.status ? `http_${e.status}` : e.kind);
    if (e.kind === 'network' || e.kind === 'timeout') return { kind: 'transient', code, retryAfterMs: null };
    const s = e.status ?? 0;
    if (s === 401 || e.code === 'no_session') return { kind: 'auth' };
    if (s === 403 || (e.code && BLOCKED_CODES.has(e.code))) return { kind: 'final', state: 'blocked', code };
    if (s === 404 && e.code === 'media_not_found') return { kind: 'reupload' };
    if (s === 409) return { kind: 'final', state: 'needs_review', code };
    if (s === 404) return { kind: 'final', state: 'needs_review', code };
    if (s === 400 || s === 422) return { kind: 'final', state: 'needs_edit', code };
    if (s === 408 || s === 425 || s === 429 || s >= 500) return { kind: 'transient', code, retryAfterMs: e.retryAfterMs };
    return { kind: 'final', state: 'needs_review', code };
  }
  return { kind: 'transient', code: 'unexpected', retryAfterMs: null };
}

class LeaseLost extends Error {}
class AccountChanged extends Error {}

export class SyncWorker {
  private readonly leaseMs: number;
  private readonly policy: RetryPolicy;
  private refreshedThisDrain = false;

  constructor(private readonly d: WorkerDeps) {
    this.leaseMs = d.leaseMs ?? 120_000;
    this.policy = d.policy ?? DEFAULT_RETRY_POLICY;
  }

  /** Drain eligible work for the signed-in owner. Triggered on resume, reconnect and the Sync screen button. */
  async drain(maxItems = 100): Promise<DrainResult> {
    const result: DrainResult = { processed: 0, acknowledged: 0, paused: null };
    const who = this.d.session.current();
    if (!who) return { ...result, paused: 'no_session' };
    this.refreshedThisDrain = false;
    this.d.store.recoverExpiredLeases(this.d.clock.now());
    while (result.processed < maxItems) {
      if (this.d.session.current()?.subjectId !== who.subjectId) return { ...result, paused: 'account_changed' };
      const item = this.d.store.leaseNext(who.subjectId, this.d.workerId, this.d.clock.now(), this.leaseMs);
      if (!item) break;
      result.processed++;
      const outcome = await this.process(item);
      if (outcome === 'acknowledged') result.acknowledged++;
      if (outcome === 'pause_auth') return { ...result, paused: 'auth_required' };
      if (outcome === 'account_changed') return { ...result, paused: 'account_changed' };
    }
    return result;
  }

  private now(): number {
    return this.d.clock.now();
  }

  private patch(item: QueueItem, p: Parameters<OutboxStore['updateLeased']>[2], extend = true): void {
    const ok = this.d.store.updateLeased(item.operationId, this.d.workerId, p, this.now(), extend ? this.leaseMs : undefined);
    if (!ok) throw new LeaseLost();
  }

  /** Re-check, right before any network call, that the live session is still the owner of this work. */
  private assertOwner(item: QueueItem): void {
    if (this.d.session.current()?.subjectId !== item.actorId) throw new AccountChanged();
  }

  private async process(item: QueueItem): Promise<'acknowledged' | 'parked' | 'pause_auth' | 'account_changed' | 'lost'> {
    try {
      await this.d.checkpoint?.('leased', item);
      for (const ref of item.localFileRefs) {
        if (!(await this.d.files.exists(ref))) {
          this.patch(item, { state: 'needs_recapture', lastErrorCode: 'missing_file', lastErrorDetail: ref }, false);
          return 'parked';
        }
      }

      let current = item;
      if (!current.upload.done && current.localFileRefs.length > 0) {
        this.patch(current, { state: 'uploading' });
        await this.d.checkpoint?.('before_upload', current);
        const mediaPath = await this.upload(current);
        this.patch(current, { uploadMediaPath: mediaPath, uploadDone: true });
        current = this.d.store.mustGet(current.operationId);
        await this.d.checkpoint?.('after_upload', current);
      }

      this.patch(current, { state: 'submitting' });
      await this.d.checkpoint?.('before_submit', current);
      this.assertOwner(current);
      const raw = await this.d.transport.submit({
        operationId: current.operationId,
        actorId: current.actorId,
        payloadHash: current.payloadHash,
        commandType: current.commandType,
        payload: { ...current.payload, mediaPath: current.upload.mediaPath },
      });
      await this.d.checkpoint?.('after_submit', current);
      const receipt: ServerReceipt = { receiptId: String(raw.receiptId ?? current.operationId), replayed: raw.replayed === true, ...raw };
      if (!this.d.store.acknowledge(current.operationId, this.d.workerId, receipt, this.now())) throw new LeaseLost();
      return 'acknowledged';
    } catch (e) {
      if (e instanceof LeaseLost) return 'lost';
      if (e instanceof AccountChanged) {
        // hand the item back untouched; it stays with its owner
        this.d.store.updateLeased(item.operationId, this.d.workerId, { state: 'ready' }, this.now());
        return 'account_changed';
      }
      return this.handleFailure(item, e);
    }
  }

  private async upload(item: QueueItem): Promise<string> {
    const ev = (item.payload.evidence ?? {}) as { mimeType?: string; sizeBytes?: number; sha256?: string };
    const ref = item.localFileRefs[0]!;
    const intent = (): Promise<UploadTarget> => {
      this.assertOwner(item);
      return this.d.transport.createUploadIntent({
        operationId: item.operationId,
        actorId: item.actorId,
        purpose: 'care_proof',
        mimeType: ev.mimeType ?? 'image/jpeg',
        sizeBytes: ev.sizeBytes ?? 0,
        sha256: ev.sha256 ?? '',
      });
    };
    let target = await intent();
    try {
      await this.d.files.upload(ref, target);
    } catch (e) {
      if (e instanceof TransportError && e.code === 'upload_url_expired') {
        target = await intent(); // renew the authorised intent once, then retry the upload
        await this.d.files.upload(ref, target);
      } else {
        throw e;
      }
    }
    return target.mediaPath;
  }

  private async handleFailure(item: QueueItem, e: unknown): Promise<'parked' | 'pause_auth' | 'lost'> {
    const c = classifyError(e);
    const detail = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    try {
      if (c.kind === 'auth') {
        if (!this.refreshedThisDrain) {
          this.refreshedThisDrain = true;
          if (await this.d.session.refresh()) {
            this.patch(item, { state: 'ready', lastErrorCode: 'session_refreshed', nextAttemptAt: null }, false);
            return 'parked';
          }
        }
        this.patch(item, { state: 'retry_wait', lastErrorCode: 'auth_required', lastErrorDetail: detail, nextAttemptAt: null }, false);
        return 'pause_auth';
      }
      if (c.kind === 'reupload') {
        // the server cannot see the object (expired/failed upload): upload again, counts as a transient attempt
        const attempt = item.attemptCount + 1;
        this.patch(
          item,
          {
            state: attempt >= this.policy.maxTransientAttempts ? 'needs_attention' : 'retry_wait',
            uploadDone: false,
            uploadMediaPath: null,
            attemptCount: attempt,
            nextAttemptAt: this.now() + backoffDelayMs(attempt, this.d.random, this.policy),
            lastErrorCode: 'media_not_found',
            lastErrorDetail: detail,
          },
          false,
        );
        return 'parked';
      }
      if (c.kind === 'final') {
        this.patch(item, { state: c.state, lastErrorCode: c.code, lastErrorDetail: detail, nextAttemptAt: null }, false);
        return 'parked';
      }
      const attempt = item.attemptCount + 1;
      const exhausted = attempt >= this.policy.maxTransientAttempts;
      this.patch(
        item,
        {
          state: exhausted ? 'needs_attention' : 'retry_wait',
          attemptCount: attempt,
          nextAttemptAt: exhausted ? null : this.now() + backoffDelayMs(attempt, this.d.random, this.policy, c.retryAfterMs),
          lastErrorCode: c.code,
          lastErrorDetail: detail,
        },
        false,
      );
      return 'parked';
    } catch (inner) {
      if (inner instanceof LeaseLost) return 'lost';
      throw inner;
    }
  }
}
