/**
 * G14 server implementation: device token registration RPCs.
 * Follows the `createAccountServer` pattern: withTimeout, shaped response parsing, FieldCommandError.
 * The server derives the caller from `auth.uid()`.
 */
import { withTimeout } from '@/features/field/data/net';
import { FieldCommandError, toCommandError } from '@/features/field/domain/commandErrors';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';

import { TokenShapeError, parseRegisterResult, parseUnregisterResult } from '../domain/types';
import type { NotificationRepositories } from './repositories';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const SHAPE = "The academy sent an answer this app doesn't understand. Nothing is confirmed.";

export type NotificationServerOptions = { timeoutMs?: number };

export function createNotificationServer(client: DataClient, opts: NotificationServerOptions = {}): NotificationRepositories {
  const ms = opts.timeoutMs;

  const command = async (fn: string, args: Record<string, unknown>): Promise<Obj> => {
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
      if (e instanceof TokenShapeError) throw new FieldCommandError('unexpected', SHAPE, `SHAPE-${e.field}`);
      throw e;
    }
  };

  return {
    deviceTokens: {
      async register(token, platform, appBuild) {
        const data = await command('app_register_device_token', {
          p_expo_token: token,
          p_platform: platform,
          p_app_build: appBuild ?? null,
        });
        return shaped(() => parseRegisterResult(data));
      },
      async unregister(token) {
        const data = await command('app_unregister_device_token', { p_expo_token: token });
        return shaped(() => parseUnregisterResult(data));
      },
    },
    pushFlag: {
      async enabled() {
        try {
          const res = await withTimeout(
            client.rpc('app_policy_flags', {}),
            ms,
          );
          if (res.error || !Array.isArray(res.data)) return false;
          const row = (res.data as Obj[]).find((r) => r.key === 'push_notifications');
          return row?.enabled === true;
        } catch {
          return false;
        }
      },
    },
  };
}
