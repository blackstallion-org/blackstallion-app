/**
 * G14 push notification infrastructure (D05: flag OFF during pilot).
 * Device token registration and notification outbox types.
 */
export type DeviceTokenRecord = {
  tokenId: string;
  expoToken: string;
  platform: 'ios' | 'android' | 'web';
  createdAt: string;
};

export type RegisterTokenResult = { tokenId: string; created: boolean };
export type UnregisterTokenResult = { deleted: boolean };

export class TokenShapeError extends Error {
  constructor(readonly field: string) {
    super(`Unexpected token response shape (${field})`);
    this.name = 'TokenShapeError';
  }
}

type Obj = Record<string, unknown>;
const PLATFORMS = ['ios', 'android', 'web'] as const;

export function parseRegisterResult(raw: unknown): RegisterTokenResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TokenShapeError('reply');
  const o = raw as Obj;
  if (typeof o.token_id !== 'string') throw new TokenShapeError('token_id');
  if (typeof o.created !== 'boolean') throw new TokenShapeError('created');
  return { tokenId: o.token_id, created: o.created };
}

export function parseUnregisterResult(raw: unknown): UnregisterTokenResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TokenShapeError('reply');
  const o = raw as Obj;
  if (typeof o.deleted !== 'boolean') throw new TokenShapeError('deleted');
  return { deleted: o.deleted };
}

export function parseTokenRecord(row: Obj): DeviceTokenRecord {
  if (typeof row.id !== 'string') throw new TokenShapeError('id');
  if (typeof row.expo_token !== 'string') throw new TokenShapeError('expo_token');
  if (typeof row.platform !== 'string' || !(PLATFORMS as readonly string[]).includes(row.platform)) throw new TokenShapeError('platform');
  if (typeof row.created_at !== 'string') throw new TokenShapeError('created_at');
  return { tokenId: row.id, expoToken: row.expo_token, platform: row.platform as DeviceTokenRecord['platform'], createdAt: row.created_at };
}
