import { ScopedLoadError } from '@/core/data/useScopedResource';

import { readRows, type Row } from './net';
import type { DataClient } from './supabaseFieldWorkflowRepository';

/** Keeps `.in()` id lists well under URL limits (~37 chars per uuid). */
const IN_CHUNK = 100;
/** The voids table doesn't exist (G9 not applied): nothing can have been voided. */
const MISSING_TABLE = new Set(['PGRST205', '42P01']);

/**
 * Check-ins voided through G9 `field_void_check_in` (SD-05 draft), among `ids`. Only a missing table counts as "none
 * voided"; any other failure (offline, timeout, refused) is a load error, so a voided check-in is never shown as
 * assessable because a read failed.
 */
export async function voidedCheckIns(client: DataClient, ids: readonly string[], timeoutMs?: number): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const rows: Row[] = await readRows(client.from('cadet_check_in_voids').select('check_in_id').in('check_in_id', ids.slice(i, i + IN_CHUNK)), timeoutMs);
      for (const r of rows) if (typeof r.check_in_id === 'string') out.add(r.check_in_id);
    }
  } catch (e) {
    if (e instanceof ScopedLoadError && e.reference && MISSING_TABLE.has(e.reference)) return new Set();
    throw e;
  }
  return out;
}
