import { ScopedLoadError } from '@/core/data/useScopedResource';

import { toCommandError, type FieldCommandError } from '../domain/commandErrors';

/** Upper bound for one request. Android's default HTTP client has no read timeout, so a half-open socket would hang. */
export const REQUEST_TIMEOUT_MS = 20_000;

type Abortable<T> = PromiseLike<T> & { abortSignal?: (s: AbortSignal) => PromiseLike<T> };

/** Resolves like the query, or rejects with a network-class error after `ms` (and aborts the fetch when possible). */
export async function withTimeout<T>(q: Abortable<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const target = ctrl && typeof q.abortSignal === 'function' ? q.abortSignal(ctrl.signal) : q;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(target),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl?.abort();
          reject(new TypeError('Network request timed out'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: unknown; status: number };

/** Runs a read and returns rows; any failure becomes a ScopedLoadError with a user-safe message and a reference. */
export async function readRows(q: Abortable<QueryResult>, ms?: number): Promise<Row[]> {
  let r: QueryResult;
  try {
    r = await withTimeout(q, ms);
  } catch (e) {
    throw loadError(toCommandError(e, 'load'));
  }
  if (r.error) throw loadError(toCommandError(r.error, 'load', r.status));
  return Array.isArray(r.data) ? (r.data as Row[]) : r.data ? [r.data as Row] : [];
}

/** Reference carried by load errors that come from no connection, so screens can show the offline state. */
export const OFFLINE_REFERENCE = 'OFFLINE';
/** Neutral "not found or not at your hub" (the server makes both look the same on purpose). */
export const NOT_FOUND_REFERENCE = 'NOT-FOUND';

export function loadError(ce: FieldCommandError): ScopedLoadError {
  if (ce.kind === 'network') return new ScopedLoadError(ce.message, OFFLINE_REFERENCE, true);
  if (ce.kind === 'notFound') return new ScopedLoadError(ce.message, NOT_FOUND_REFERENCE, true);
  return new ScopedLoadError(ce.message, ce.reference, true);
}
