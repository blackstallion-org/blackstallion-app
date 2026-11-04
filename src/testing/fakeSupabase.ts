/**
 * Test double for the two supabase-js surfaces the repositories use (rpc, from). It records every call so tests can
 * assert the exact contract, and applies eq/in/order/limit filters in memory. It is NOT a substitute for running
 * against the real stack; it verifies the client side of the contract only.
 */
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';

type Row = Record<string, unknown>;
export type FakeResult = { data: unknown; error: unknown; status: number };
export type FakeCall =
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }
  | { kind: 'from'; table: string; ops: unknown[][] };

export function createFakeSupabase(opts: {
  tables?: Record<string, Row[]>;
  rpc?: Record<string, (args: Record<string, unknown>) => FakeResult | Promise<FakeResult>>;
  failTables?: Record<string, FakeResult | Error>;
} = {}) {
  const calls: FakeCall[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ kind: 'rpc', fn, args });
      const h = opts.rpc?.[fn];
      return Promise.resolve(h ? h(args) : { data: null, error: { code: 'PGRST202', message: 'function not found' }, status: 404 });
    },
    from(table: string) {
      const ops: unknown[][] = [];
      calls.push({ kind: 'from', table, ops });
      let rows = [...(opts.tables?.[table] ?? [])];
      let single = false;
      let lim = Number.POSITIVE_INFINITY;
      const orders: [string, number][] = [];
      const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
      const b = {
        select(cols: string) { ops.push(['select', cols]); return b; },
        eq(c: string, v: unknown) { ops.push(['eq', c, v]); rows = rows.filter((r) => r[c] === v); return b; },
        in(c: string, vs: unknown[]) { ops.push(['in', c, vs]); rows = rows.filter((r) => vs.includes(r[c])); return b; },
        order(c: string, o?: { ascending?: boolean }) {
          ops.push(['order', c, o]); // like PostgREST: the first order() is the primary key
          orders.push([c, o?.ascending === false ? -1 : 1]);
          return b;
        },
        limit(n: number) { ops.push(['limit', n]); lim = n; return b; },
        abortSignal(_s: AbortSignal) { return b; }, // accepted like the real builder; not recorded
        maybeSingle() { ops.push(['maybeSingle']); single = true; return b; },
        then<T1, T2>(res: (v: FakeResult) => T1, rej?: (e: unknown) => T2) {
          const fail = opts.failTables?.[table];
          if (fail instanceof Error) return Promise.reject(fail).then(res, rej);
          if (orders.length) {
            rows.sort((x, y) => {
              for (const [c, dir] of orders) {
                const d = cmp(x[c], y[c]);
                if (d) return dir * d;
              }
              return 0;
            });
          }
          const tooMany = single && rows.length > 1; // real maybeSingle() errors on more than one row
          const out: FakeResult = fail ?? (tooMany
            ? { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 }
            : { data: single ? (rows[0] ?? null) : rows.slice(0, lim), error: null, status: 200 });
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
  return { client: client as unknown as DataClient, calls };
}

export const ok = (data: unknown): FakeResult => ({ data, error: null, status: 200 });
export const pgError = (code: string, message: string, status = 400): FakeResult => ({ data: null, error: { code, message }, status });

/** What supabase-js 2.x actually resolves with when fetch fails (it does not reject): status 0, empty code. */
export const networkFailure = (): FakeResult => ({
  data: null,
  error: { code: '', message: 'TypeError: Network request failed', details: '', hint: '' },
  status: 0,
});
