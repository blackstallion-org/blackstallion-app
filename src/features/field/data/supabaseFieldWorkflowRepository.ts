import type { SupabaseClient } from '@supabase/supabase-js';

import { ScopedLoadError } from '@/core/data/useScopedResource';
import { hubDate } from '@/core/format/hubTime';

import { CLOCK_MESSAGE, CLOCK_MESSAGE_KEY, FieldCommandError, toCommandError } from '../domain/commandErrors';
import { isUuid } from '../domain/operation';
import type { CheckInRequest, CheckInResult, FieldWorkflowRepository, PublishRequest, PublishResult } from '../domain/workflow';
import { OFFLINE_REFERENCE, withTimeout } from './net';
import { createServerClock, MAX_CLOCK_SKEW_MS, type ServerClock } from './serverClock';
import { voidedCheckIns } from './voids';

const VOIDED_TODAY = 'This cadet’s check-in today was voided, so they can’t be checked in again today. Ask your hub admin.';

/** Only the two client surfaces the repositories use; tests pass a fake. Created with the publishable key only. */
export type DataClient = Pick<SupabaseClient, 'rpc' | 'from'>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const SHAPE = 'The academy sent an answer this app doesn’t understand. Nothing is confirmed.';
export const SHAPE_KEY = 'errors.shape';
const str = (o: Obj, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) throw new FieldCommandError('unexpected', SHAPE, `SHAPE-${k}`, SHAPE_KEY);
  return v;
};
const bool = (o: Obj, k: string): boolean => {
  if (typeof o[k] !== 'boolean') throw new FieldCommandError('unexpected', SHAPE, `SHAPE-${k}`, SHAPE_KEY);
  return o[k] as boolean;
};

export type WorkflowOptions = { clock?: ServerClock; timeoutMs?: number; localNow?: () => number };

/**
 * Field commands over the merged live-schema delta (foundations/live-delta, MIG:335-441). Contract: SLICE_CONTRACT.md §A.
 * Never returns success unless the server answered with a well-formed success payload.
 */
export function createSupabaseFieldWorkflowRepository(client: DataClient, opts: WorkflowOptions = {}): FieldWorkflowRepository {
  const localNow = opts.localNow ?? Date.now;
  const clock = opts.clock ?? createServerClock(client, localNow, opts.timeoutMs);

  return {
    async checkIn(req: CheckInRequest): Promise<CheckInResult> {
      if (!isUuid(req.operationId)) throw new FieldCommandError('unexpected', 'Internal error: bad operation id.', 'CLIENT-OPID');
      // The server files the session under the PHONE's date (MIG:356). Refuse before writing if the phone clock is off.
      const offset = await clock.offsetMs();
      if (Math.abs(offset) > MAX_CLOCK_SKEW_MS) throw new FieldCommandError('invalid', CLOCK_MESSAGE, 'CLOCK-SKEW', CLOCK_MESSAGE_KEY);

      let res;
      try {
        res = await withTimeout(
          client.rpc('field_record_check_in', {
            p_passport_code: req.passportCode,
            p_observed_at: req.observedAt.toISOString(),
            p_operation_id: req.operationId,
          }),
          opts.timeoutMs,
        );
      } catch (e) {
        throw toCommandError(e, 'checkIn');
      }
      if (res.error) throw toCommandError(res.error, 'checkIn', res.status);
      if (!isObj(res.data)) throw toCommandError(null, 'checkIn');
      const d = res.data;
      const name = typeof d.cadet_name === 'string' && d.cadet_name.trim() ? d.cadet_name.trim() : 'Cadet';
      const sessionDate = str(d, 'session_date');
      let checkInOperationId = req.operationId;

      if (bool(d, 'duplicate')) {
        // A same-day check-in returns the EXISTING row, whose operation id may not be ours (SLICE_CONTRACT H3).
        let row;
        try {
          row = await withTimeout(client.from('cadet_check_ins').select('client_operation_id').eq('id', str(d, 'check_in_id')).maybeSingle(), opts.timeoutMs);
        } catch (e) {
          throw toCommandError(e, 'checkIn');
        }
        if (row.error) throw toCommandError(row.error, 'checkIn', row.status);
        const op = isObj(row.data) ? row.data.client_operation_id : undefined;
        if (!isUuid(op)) {
          throw new FieldCommandError('unexpected', 'This cadet is checked in, but the check-in can’t be opened. Try again from Today.', 'CHECKIN-OPID');
        }
        checkInOperationId = op;
        // the day's check-in was voided (G9, SD-05 draft): never report it as "already checked in" with Assess
        let voided: Set<string>;
        try {
          voided = await voidedCheckIns(client, [str(d, 'check_in_id')], opts.timeoutMs);
        } catch (e) {
          // a lost read is a network failure (safe to repeat the same request), anything else is unexpected
          const offline = e instanceof ScopedLoadError && e.reference === OFFLINE_REFERENCE;
          throw toCommandError(offline ? new TypeError('Network request failed') : e, 'checkIn');
        }
        if (voided.size > 0) {
          throw new FieldCommandError('conflict', VOIDED_TODAY, 'CHECKIN-VOIDED', 'errors.known.checkInVoidedToday');
        }
      }

      return {
        checkInId: str(d, 'check_in_id'),
        checkInOperationId,
        cadetId: str(d, 'cadet_id'),
        cadetName: name,
        sessionDate,
        receivedAt: str(d, 'received_at'),
        // Our own replayed request is not "already checked in"; someone else's earlier scan is.
        duplicate: checkInOperationId !== req.operationId,
        isToday: sessionDate === hubDate(new Date(localNow() + offset)),
      };
    },

    async publish(req: PublishRequest): Promise<PublishResult> {
      if (!isUuid(req.operationId) || !isUuid(req.checkInOperationId)) {
        throw new FieldCommandError('unexpected', 'Internal error: bad operation id.', 'CLIENT-OPID');
      }
      const a = req.assessment;
      let res;
      try {
        res = await withTimeout(
          client.rpc('field_publish_session', {
            p_check_in_operation_id: req.checkInOperationId,
            p_riding_score: a.riding,
            p_ground_score: a.ground,
            p_stable_score: a.stable,
            p_skill_ids: a.skillIds,
            p_notes: a.notes,
            // Only sent after FO-03 checked recording consent and the upload finished; the server checks the object exists.
            p_video_object: req.videoObject ?? null,
            p_operation_id: req.operationId,
          }),
          opts.timeoutMs,
        );
      } catch (e) {
        throw toCommandError(e, 'publish');
      }
      if (res.error) throw toCommandError(res.error, 'publish', res.status);
      if (!isObj(res.data)) throw toCommandError(null, 'publish');
      const d = res.data;
      const version = d.version;
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-version', SHAPE_KEY);
      }
      return { sessionId: str(d, 'session_id'), version, sessionDate: str(d, 'session_date'), duplicate: bool(d, 'duplicate') };
    },
  };
}
