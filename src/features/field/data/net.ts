import { ScopedLoadError } from '@/core/data/useScopedResource';

import { toCommandError } from '../domain/commandErrors';

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
    const ce = toCommandError(e, 'load');
    throw new ScopedLoadError(ce.message, ce.reference, true);
  }
  if (r.error) {
    const ce = toCommandError(r.error, 'load', r.status);
    throw new ScopedLoadError(ce.message, ce.reference, true);
  }
  return Array.isArray(r.data) ? (r.data as Row[]) : r.data ? [r.data as Row] : [];
}
