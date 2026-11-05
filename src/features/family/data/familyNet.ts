import { ScopedLoadError } from '@/core/data/useScopedResource';
import { withTimeout } from '@/features/field/data/net';
import { classifyCommandError } from '@/features/field/domain/commandErrors';

import { FamilyCommandError } from './repositories';

/**
 * Load failures carry a machine reference so screens can pick the right state without parsing text:
 *   OFFLINE            no connection / timeout / 5xx  → OfflineState (Try again)
 *   DENIED-<code>      42501 / 401 / 403              → neutral "not available", no retry
 *   NOTFOUND-<code>    PT404 or an id outside scope   → neutral "not available", no retry, no hint a record exists
 *   OFF-PT403          feature switched off by policy → UnavailableState
 *   ERR-<code>         anything else                  → ErrorState (Retry + Details)
 */
export type LoadFailure = 'offline' | 'denied' | 'notFound' | 'off' | 'error';

export function loadFailureOf(reference: string | undefined): LoadFailure {
  if (!reference) return 'error';
  if (reference === 'OFFLINE') return 'offline';
  if (reference.startsWith('DENIED')) return 'denied';
  if (reference.startsWith('NOTFOUND')) return 'notFound';
  if (reference.startsWith('OFF')) return 'off';
  return 'error';
}

const MESSAGES: Record<LoadFailure, string> = {
  offline: 'You’re offline or the academy can’t be reached. Connect and try again.',
  denied: 'This isn’t available to your account.',
  notFound: 'This isn’t available.',
  off: 'This isn’t switched on yet.',
  error: 'This information could not be loaded. Try again.',
};

type Err = { code?: unknown; message?: unknown; status?: unknown; name?: unknown };

export function toLoadError(e: unknown, status?: number): ScopedLoadError {
  if (e instanceof ScopedLoadError) return e;
  const err = (e ?? {}) as Err;
  const code = typeof err.code === 'string' ? err.code : '';
  if (code === 'PT403') return new ScopedLoadError(MESSAGES.off, 'OFF-PT403', true);
  const kind = classifyCommandError(err, status);
  if (kind === 'network') return new ScopedLoadError(MESSAGES.offline, 'OFFLINE', true);
  if (kind === 'forbidden' || kind === 'signedOut') return new ScopedLoadError(MESSAGES.denied, `DENIED-${code || status || 'AUTH'}`, true);
  if (kind === 'notFound') return new ScopedLoadError(MESSAGES.notFound, `NOTFOUND-${code}`, true);
  return new ScopedLoadError(MESSAGES.error, `ERR-${code || (status ? `HTTP-${status}` : 'UNKNOWN')}`, true);
}

/** Refusal raised by the CLIENT before any request (id outside the snapshot, malformed id). */
export const outOfScope = (what = 'SCOPE') => new ScopedLoadError(MESSAGES.notFound, `NOTFOUND-${what}`, true);
export const shapeError = (field: string) => new ScopedLoadError('The academy sent an answer this app doesn’t understand.', `ERR-SHAPE-${field}`, true);

type QueryResult = { data: unknown; error: unknown; status: number };
type Abortable = PromiseLike<QueryResult> & { abortSignal?: (s: AbortSignal) => PromiseLike<QueryResult> };

/** Runs a read (table select or read RPC); returns `data` or throws a classified ScopedLoadError. */
export async function loadData(q: Abortable): Promise<unknown> {
  let r: QueryResult;
  try {
    r = await withTimeout(q);
  } catch (e) {
    throw toLoadError(e);
  }
  if (r.error) throw toLoadError(r.error, r.status);
  return r.data;
}

export type Row = Record<string, unknown>;
export const asRows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : data && typeof data === 'object' ? [data as Row] : []);
export const loadRows = async (q: Abortable): Promise<Row[]> => asRows(await loadData(q));

/** Runs a command RPC; returns the JSON object or throws FamilyCommandError (kind from the SQLSTATE). */
export async function runCommand(q: Abortable): Promise<Row> {
  let r: QueryResult;
  try {
    r = await withTimeout(q);
  } catch (e) {
    throw new FamilyCommandError('network', e instanceof Error ? e.message : '', undefined);
  }
  if (r.error) {
    const err = r.error as Err;
    const code = typeof err.code === 'string' ? err.code : '';
    const message = typeof err.message === 'string' ? err.message : '';
    throw new FamilyCommandError(code === 'PT403' ? 'forbidden' : classifyCommandError(err, r.status), message, code || (r.status ? `HTTP-${r.status}` : undefined));
  }
  if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) throw new FamilyCommandError('unexpected', 'unexpected response shape', 'SHAPE');
  return r.data as Row;
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
export const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
export const score = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);
