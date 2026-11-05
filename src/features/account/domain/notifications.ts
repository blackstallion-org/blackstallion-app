/**
 * SH-08 notification preferences (BACKEND_CONTRACT_V2 §3.4; categories are data, PROPOSED under D05/M15).
 * Pure. The server offers only the categories that apply to the caller; the app never adds or hides one by role.
 */
export type NotificationAudience = 'family' | 'field' | 'all';

export type NotificationCategory = {
  category: string;
  /** Server title (English). Known keys get a translated title in the app catalogue. */
  title: string;
  audience: NotificationAudience;
  enabled: boolean;
  /** No stored choice yet: the category's default applies. */
  isDefault: boolean;
  updatedAt: string | null;
};

export type NotificationPreferenceAck = { category: string; enabled: boolean; updatedAt: string; duplicate: boolean };

export class NotificationShapeError extends Error {
  constructor(readonly field: string) {
    super(`Unexpected notification preference shape (${field})`);
    this.name = 'NotificationShapeError';
  }
}

type Obj = Record<string, unknown>;
const AUDIENCES: readonly NotificationAudience[] = ['family', 'field', 'all'];

export function parseCategoryRow(row: Obj): NotificationCategory {
  const { category, title, audience, enabled, is_default: isDefault, updated_at: updatedAt } = row;
  if (typeof category !== 'string' || !/^[a-z][a-z0-9_]{2,40}$/.test(category)) throw new NotificationShapeError('category');
  if (typeof title !== 'string') throw new NotificationShapeError('title');
  if (typeof audience !== 'string' || !AUDIENCES.includes(audience as NotificationAudience)) throw new NotificationShapeError('audience');
  if (typeof enabled !== 'boolean') throw new NotificationShapeError('enabled');
  if (typeof isDefault !== 'boolean') throw new NotificationShapeError('is_default');
  if (updatedAt !== null && updatedAt !== undefined && typeof updatedAt !== 'string') throw new NotificationShapeError('updated_at');
  return { category, title, audience: audience as NotificationAudience, enabled, isDefault, updatedAt: (updatedAt as string | null | undefined) ?? null };
}

export function parsePreferenceAck(raw: unknown): NotificationPreferenceAck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new NotificationShapeError('reply');
  const o = raw as Obj;
  if (typeof o.category !== 'string') throw new NotificationShapeError('category');
  if (typeof o.enabled !== 'boolean') throw new NotificationShapeError('enabled');
  if (typeof o.updated_at !== 'string') throw new NotificationShapeError('updated_at');
  return { category: o.category, enabled: o.enabled, updatedAt: o.updated_at, duplicate: o.duplicate === true };
}

/** Family first, then work, then anything for everyone; server order is kept inside each group. */
export function groupCategories(rows: readonly NotificationCategory[]): { audience: NotificationAudience; rows: NotificationCategory[] }[] {
  return AUDIENCES.map((audience) => ({ audience, rows: rows.filter((r) => r.audience === audience) })).filter((g) => g.rows.length > 0);
}

/** Replaces one category's state after the server acknowledged it (never before). */
export const applyAck = (rows: readonly NotificationCategory[], ack: NotificationPreferenceAck): NotificationCategory[] =>
  rows.map((r) => (r.category === ack.category ? { ...r, enabled: ack.enabled, isDefault: false, updatedAt: ack.updatedAt } : r));

/** OS permission as far as this build can tell. `unknown` = the build has no way to read it (no expo-notifications). */
export type OsNotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unknown';
