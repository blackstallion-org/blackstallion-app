import { ScopedLoadError } from '@/core/data/useScopedResource';
import { readRows, withTimeout } from '@/features/field/data/net';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';
import { FieldCommandError, toCommandError } from '@/features/field/domain/commandErrors';
import { isUuid } from '@/features/field/domain/operation';

import { readAccountConfig, type AccountConfig } from '../config';
import { DeletionShapeError, MAX_DELETION_REASON, parseDeletionRequest } from '../domain/deletion';
import { NotificationShapeError, parseCategoryRow, parsePreferenceAck } from '../domain/notifications';
import { roleKeyFromServer, type ProfileDetails } from '../domain/profile';
import type { AccountRepositories, AccountScope } from './repositories';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const SHAPE = 'The academy sent an answer this app doesn’t understand. Nothing is confirmed.';

export type AccountServerOptions = { timeoutMs?: number; config?: AccountConfig };

/**
 * Server implementation over BACKEND_CONTRACT_V2 §3.4 (SH-08) and §3.5 (SH-10), MIG9
 * `server/live-delta/g9-app-surfaces/migrations/20261105000100_app_surfaces.sql`. Every argument is sent (no SQL
 * defaults); commands carry a client operation id and are replay-safe; success is reported only for a well-formed
 * server reply. The server derives the caller from `auth.uid()`: the `AccountScope` argument is not sent.
 *
 * Not server-backed (no contract exists): the minimum supported version (SH-12 → `versionPolicy` stays undefined,
 * so the gate fails open), support contact and update links (build configuration), unsent work (composition root).
 */
export function createAccountServer(client: DataClient, opts: AccountServerOptions = {}): AccountRepositories {
  const ms = opts.timeoutMs;
  const config = opts.config ?? readAccountConfig();

  /** A read; any failure is a ScopedLoadError with a safe message and the SQLSTATE/HTTP reference. */
  const readOne = async (q: Parameters<typeof readRows>[0]): Promise<unknown> => (await readRows(q, ms))[0] ?? null;

  /** A command; resolves only with a well-formed jsonb object from the server. */
  const command = async (fn: string, args: Record<string, unknown>): Promise<Obj> => {
    if (!isUuid(args.p_operation_id)) throw new FieldCommandError('unexpected', 'Internal error: bad operation id.', 'CLIENT-OPID');
    let res;
    try {
      res = await withTimeout(client.rpc(fn, args), ms);
    } catch (e) {
      throw toCommandError(e, 'load');
    }
    if (res.error) throw toCommandError(res.error, 'load', res.status);
    if (!isObj(res.data)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-REPLY');
    return res.data;
  };

  const shaped = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof DeletionShapeError || e instanceof NotificationShapeError) {
        throw new FieldCommandError('unexpected', SHAPE, `SHAPE-${e.field}`);
      }
      throw e;
    }
  };
  const shapedRead = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof DeletionShapeError || e instanceof NotificationShapeError) throw new ScopedLoadError(SHAPE, `SHAPE-${e.field}`, true);
      throw e;
    }
  };

  return {
    profile: {
      async get(subject: AccountScope): Promise<ProfileDetails> {
        const role = roleKeyFromServer(subject.scope?.role);
        const staffRole = role && role !== 'guardian' ? role : null;
        const hubId = subject.scope?.hubId ?? null;
        let hubName: string | null = null;
        if (staffRole && hubId) {
          // school_hubs: any signed-in user may read id + school_name (SLICE_CONTRACT B); `select *` is refused.
          const row = await readOne(client.from('school_hubs').select('id, school_name').eq('id', hubId).maybeSingle());
          hubName = isObj(row) && typeof row.school_name === 'string' && row.school_name.trim() ? row.school_name.trim() : null;
        }
        return {
          staffRole,
          hubName,
          childFirstNames: (subject.scope?.children ?? []).map((c) => c.firstName).filter((n) => !!n),
          source: 'server',
        };
      },
    },

    notifications: {
      async list() {
        const rows = await readRows(client.rpc('app_notification_preferences', {}), ms);
        return shapedRead(() => rows.map(parseCategoryRow));
      },
      async set(_subject, req) {
        const data = await command('app_set_notification_preference', {
          p_category: req.category,
          p_enabled: req.enabled,
          p_operation_id: req.operationId,
        });
        return shaped(() => parsePreferenceAck(data));
      },
    },

    deletion: {
      async status() {
        const data = await readOne(client.rpc('app_account_deletion_status', {}));
        if (!isObj(data) || !('request' in data)) throw new ScopedLoadError(SHAPE, 'SHAPE-request', true);
        return data.request === null ? null : shapedRead(() => parseDeletionRequest(data.request));
      },
      async request(_subject, req) {
        if (req.reason !== null && req.reason.length > MAX_DELETION_REASON) {
          throw new FieldCommandError('invalid', `The reason is limited to ${MAX_DELETION_REASON} characters.`, 'CLIENT-REASON');
        }
        const data = await command('app_request_account_deletion', { p_reason: req.reason, p_operation_id: req.operationId });
        return shaped(() => ({ ...parseDeletionRequest(data), alreadyOpen: data.already_open === true, duplicate: data.duplicate === true }));
      },
      async cancel(_subject, req) {
        const data = await command('app_cancel_account_deletion', { p_request_id: req.requestId, p_operation_id: req.operationId });
        return shaped(() => ({ ...parseDeletionRequest(data), alreadyCancelled: data.already_cancelled === true, duplicate: data.duplicate === true }));
      },
    },

    support: {
      contact: async () => config.support,
      updateDestinations: async () => config.update,
    },
  };
}
