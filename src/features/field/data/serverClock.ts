import { FieldCommandError, toCommandError } from '../domain/commandErrors';
import { withTimeout } from './net';
import type { DataClient } from './supabaseFieldWorkflowRepository';

/** Beyond this, the phone clock is not trusted for check-ins (the server accepts at most +5 min, MIG:112-118). */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const TTL_MS = 10 * 60_000;

export interface ServerClock {
  /** Server time minus phone time, in ms. Throws a FieldCommandError when the server can't be asked. */
  offsetMs(): Promise<number>;
}

/** Postgres timestamptz JSON may carry microseconds; trim to milliseconds before Date.parse (Hermes-safe). */
export const parseServerTime = (v: unknown): number =>
  typeof v === 'string' ? Date.parse(v.replace(/(\.\d{3})\d+/, '$1')) : Number.NaN;

/**
 * Measures the phone's clock against the server's (`issuedAt` = server now() in app_access_snapshot, MIG:645),
 * using the round-trip midpoint. The server derives session_date from the phone's observed time (MIG:356), so a
 * wrong phone date would file a session on the wrong day; this is what lets the app refuse that.
 */
export function createServerClock(client: DataClient, localNow: () => number = Date.now, timeoutMs?: number): ServerClock {
  let cached: { offset: number; at: number } | null = null;
  return {
    async offsetMs() {
      const t0 = localNow();
      if (cached && t0 >= cached.at && t0 - cached.at < TTL_MS) return cached.offset;
      let res;
      try {
        res = await withTimeout(client.rpc('app_access_snapshot'), timeoutMs);
      } catch (e) {
        throw toCommandError(e, 'checkIn');
      }
      if (res.error) throw toCommandError(res.error, 'checkIn', res.status);
      const t1 = localNow();
      const data = res.data as Record<string, unknown> | null;
      const issued = parseServerTime(data?.issuedAt);
      if (Number.isNaN(issued)) {
        throw new FieldCommandError('unexpected', 'The academy’s time couldn’t be checked. Nothing was recorded; try again.', 'SHAPE-issuedAt');
      }
      const offset = issued - (t0 + t1) / 2;
      cached = { offset, at: t1 };
      return offset;
    },
  };
}
