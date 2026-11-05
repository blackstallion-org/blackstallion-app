/**
 * DEVELOPMENT-ONLY synthetic fixtures for shared access/profile/settings (SH-02,04,06,08,09,10,12). Every name is
 * invented and marked "(sample)"; contact details use reserved, non-routable values and are never dialled or opened.
 * Each record belongs to exactly one synthetic subject; any other subject is refused like the server would
 * (`FIXTURE-SCOPE`). Behaviour mirrors MIG9 (offered categories, one open deletion request, replay by operation id).
 */
import { ScopedLoadError } from '@/core/data/useScopedResource';
import type { AccountRepositories, AccountScope } from '@/features/account/data/repositories';
import type { DeletionRequest } from '@/features/account/domain/deletion';
import type { NotificationCategory } from '@/features/account/domain/notifications';
import type { ProfileDetails } from '@/features/account/domain/profile';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { newOperationId } from '@/features/field/domain/operation';
import type { OtpBoundary } from '@/features/identity/otp';

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const PROFILES: Record<string, ProfileDetails> = {
  'syn-guardian-a': { staffRole: null, hubName: null, childFirstNames: ['Aarav (sample)', 'Meera (sample)'], source: 'synthetic-preview' },
  'syn-guardian-b': { staffRole: null, hubName: null, childFirstNames: [], source: 'synthetic-preview' },
  'syn-instructor': { staffRole: 'instructor', hubName: 'Demo Hub One', childFirstNames: [], source: 'synthetic-preview' },
  'syn-groom': { staffRole: 'groom', hubName: 'Demo Hub One', childFirstNames: [], source: 'synthetic-preview' },
  'syn-dual': { staffRole: 'instructor', hubName: 'Demo Hub Two', childFirstNames: ['Isha (sample)'], source: 'synthetic-preview' },
};

/** MIG9 seed (notification_categories), offered by the same rules: family = guardian of ≥1 child; field = role. */
const CATEGORIES = {
  check_in: { title: 'Arrival check-in', audience: 'family', default: true },
  assessment_published: { title: 'New assessment', audience: 'family', default: true },
  events: { title: 'Academy events', audience: 'family', default: true },
  spark_daily: { title: 'Daily Spark reminder', audience: 'family', default: false },
  care_reminders: { title: 'Care task reminders', audience: 'field', default: true },
  review_escalations: { title: 'Items waiting for review', audience: 'field', default: true },
} as const;
type CategoryKey = keyof typeof CATEGORIES;

const OFFERED: Record<string, readonly CategoryKey[]> = {
  'syn-guardian-a': ['check_in', 'assessment_published', 'events', 'spark_daily'],
  'syn-guardian-b': [], // no linked child → no family categories (server rule)
  'syn-instructor': ['care_reminders'],
  'syn-groom': ['care_reminders'],
  'syn-dual': ['check_in', 'assessment_published', 'events', 'spark_daily', 'care_reminders'],
};

/** Synthetic preview code for the SH-02 development path. No code is ever sent. */
export const SYNTHETIC_PREVIEW_CODE = '123456';
/** Entering this code simulates a lost connection. */
export const SYNTHETIC_OFFLINE_CODE = '000000';

/** SH-02 development boundary: accepts only the preview code; never says whether an account exists. */
export function createSyntheticOtpPreview({ latencyMs = 400, channel = 'phone' as OtpBoundary['channel'] } = {}): OtpBoundary {
  return {
    kind: 'synthetic-preview',
    channel,
    async request() {
      await wait(latencyMs);
      return { ok: true };
    },
    async verify(_address, code) {
      await wait(latencyMs);
      if (code === SYNTHETIC_OFFLINE_CODE) return { ok: false, reason: 'network' };
      return code === SYNTHETIC_PREVIEW_CODE ? { ok: true } : { ok: false, reason: 'invalid' };
    },
  };
}

/** One shared preview instance for SH-01 and SH-02 (development routes only). */
export const syntheticOtpPreview: OtpBoundary = createSyntheticOtpPreview();

export function createAccountFixtures({ latencyMs = 350 }: { latencyMs?: number } = {}): AccountRepositories {
  const prefs = new Map<string, Map<CategoryKey, { enabled: boolean; updatedAt: string }>>();
  const deletions = new Map<string, DeletionRequest[]>([
    // Kiran already asked: shows the pending/received state of SH-10.
    [
      'syn-guardian-b',
      [
        {
          requestId: '5a3e0c1d-7b2f-4c8e-9d10-2f6a8b4c0e11',
          status: 'requested',
          reason: null,
          requestedAt: '2026-11-03T09:12:00+05:30',
          statusChangedAt: '2026-11-03T09:12:00+05:30',
          statusNote: null,
          version: 1,
          canCancel: true,
        },
      ],
    ],
  ]);
  const replies = new Map<string, { subject: string; result: unknown }>();
  const pending = new Map<string, number>([['syn-instructor', 2]]);

  const known = (s: AccountScope) => {
    if (s.subjectId === 'syn-guardian-err') throw new ScopedLoadError('Simulated failure', 'FIXTURE-500-0002');
    if (!(s.subjectId in PROFILES)) throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
    return s.subjectId;
  };
  /** Same id + same caller → the original reply (duplicate: true); another caller → conflict (MIG9 §1). */
  const replay = <T>(subject: string, opId: string, run: () => T): T => {
    const prev = replies.get(opId);
    if (prev) {
      if (prev.subject !== subject) throw new FieldCommandError('conflict', 'This request clashed with an earlier one.', 'PT409');
      return { ...(prev.result as object), duplicate: true } as T;
    }
    const result = run();
    replies.set(opId, { subject, result });
    return result;
  };

  return {
    profile: {
      async get(s) {
        await wait(latencyMs);
        return structuredClone(PROFILES[known(s)]!);
      },
    },
    notifications: {
      async list(s) {
        await wait(latencyMs);
        const id = known(s);
        const stored = prefs.get(id);
        return (OFFERED[id] ?? []).map((key): NotificationCategory => {
          const c = CATEGORIES[key];
          const choice = stored?.get(key);
          return { category: key, title: c.title, audience: c.audience, enabled: choice?.enabled ?? c.default, isDefault: !choice, updatedAt: choice?.updatedAt ?? null };
        });
      },
      async set(s, req) {
        await wait(latencyMs);
        const id = known(s);
        if (!(OFFERED[id] ?? []).includes(req.category as CategoryKey)) {
          throw new FieldCommandError('invalid', 'category not available for this account', 'PT422');
        }
        return replay(id, req.operationId, () => {
          const updatedAt = new Date().toISOString();
          const m = prefs.get(id) ?? new Map();
          m.set(req.category as CategoryKey, { enabled: req.enabled, updatedAt });
          prefs.set(id, m);
          return { category: req.category, enabled: req.enabled, updatedAt, duplicate: false };
        });
      },
    },
    deletion: {
      async status(s) {
        await wait(latencyMs);
        const list = deletions.get(known(s)) ?? [];
        return list.length ? structuredClone(list[list.length - 1]!) : null;
      },
      async request(s, req) {
        await wait(latencyMs);
        const id = known(s);
        return replay(id, req.operationId, () => {
          const list = deletions.get(id) ?? [];
          const open = list.find((r) => r.status === 'requested' || r.status === 'in_review');
          if (open) return { ...structuredClone(open), alreadyOpen: true, duplicate: false };
          const now = new Date().toISOString();
          const r: DeletionRequest = { requestId: newOperationId(), status: 'requested', reason: req.reason, requestedAt: now, statusChangedAt: now, statusNote: null, version: 1, canCancel: true };
          deletions.set(id, [...list, r]);
          return { ...structuredClone(r), alreadyOpen: false, duplicate: false };
        });
      },
      async cancel(s, req) {
        await wait(latencyMs);
        const id = known(s);
        return replay(id, req.operationId, () => {
          const list = deletions.get(id) ?? [];
          const r = list.find((x) => x.requestId === req.requestId);
          if (!r) throw new FieldCommandError('notFound', 'request not found', 'PT404');
          if (r.status === 'cancelled') return { ...structuredClone(r), alreadyCancelled: true, duplicate: false };
          if (r.status !== 'requested') throw new FieldCommandError('conflict', `the request is ${r.status}`, 'PT409');
          Object.assign(r, { status: 'cancelled', canCancel: false, version: r.version + 1, statusChangedAt: new Date().toISOString() });
          return { ...structuredClone(r), alreadyCancelled: false, duplicate: false };
        });
      },
    },
    support: {
      async contact() {
        await wait(latencyMs);
        return {
          academyName: 'Demo academy office (sample)',
          phone: '+91 00000 00000',
          email: 'office@example.invalid',
          website: 'https://example.invalid',
          hours: 'Mon–Sat, 9:00–18:00 IST (sample)',
          privacyPolicyUrl: null,
          source: 'synthetic-preview',
        };
      },
      // Not configured in development: the update gate says so instead of offering an invented store link.
      updateDestinations: async () => ({ ios: null, android: null }),
    },
    // Equal to app.json's version, so the development build is never gated. SH-12 is previewed with `?preview=required`.
    versionPolicy: { get: async () => ({ minimumVersion: '0.1.0', source: 'synthetic-preview' }) },
    pendingWork: {
      async count(subjectId) {
        return pending.get(subjectId) ?? 0;
      },
      async discard(subjectId) {
        pending.delete(subjectId);
      },
    },
  };
}
