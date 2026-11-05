// Copied from foundations/client-auth/src (G3, 4 Nov 2026), import extensions removed; keep both in step.
// Supabase adapter: real provider results → the pure state machine's events (session.ts) and the validated
// snapshot (access.ts). Type-only import, so this core stays dependency-free at runtime; in the app the client is
// created once with the project URL and the publishable anon key only (never a service-role key).
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSnapshot, SnapshotError, type AccessSnapshot } from './access';

export type FailureKind = 'auth' | 'network' | 'forbidden' | 'invalid';
export type SnapshotResult = { ok: true; snapshot: AccessSnapshot } | { ok: false; kind: FailureKind; detail: string };

interface ErrLike { code?: string; message?: string; status?: number; name?: string }

/** HTTP/PostgREST/GoTrue failure → one of four kinds. Unknown errors are never treated as success. */
export function classify(error: ErrLike | null | undefined, status?: number): FailureKind {
  const s = status ?? error?.status ?? 0;
  const msg = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (s === 0 || msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnrefused')) return 'network';
  if (s >= 500 || s === 408 || s === 429) return 'network';               // transient: bounded retry in session.ts
  if (s === 401 || (error?.code ?? '').startsWith('PGRST30') || msg.includes('jwt')) return 'auth';
  if (s === 403 || error?.code === '42501') return 'forbidden';
  return 'invalid';
}

/** Fetch and validate the trusted snapshot for the client's current session user. */
export async function loadSnapshot(client: SupabaseClient, sessionUserId: string): Promise<SnapshotResult> {
  try {
    const { data, error, status } = await client.rpc('app_access_snapshot');
    if (error) return { ok: false, kind: classify(error, status), detail: `${status} ${error.code ?? ''} ${error.message}` };
    return { ok: true, snapshot: parseSnapshot(data, sessionUserId) };
  } catch (e) {
    if (e instanceof SnapshotError) return { ok: false, kind: 'invalid', detail: e.message };
    return { ok: false, kind: classify(e as ErrLike), detail: String(e) };
  }
}

/** One refresh attempt. Callers must not loop: session.ts turns an 'auth' failure into signed_out. */
export async function refreshOnce(client: SupabaseClient): Promise<{ ok: true; userId: string } | { ok: false; kind: 'auth' | 'network' }> {
  try {
    const { data, error } = await client.auth.refreshSession();
    if (error || !data.session) return { ok: false, kind: classify(error ?? { status: 401 }) === 'network' ? 'network' : 'auth' };
    return { ok: true, userId: data.session.user.id };
  } catch (e) {
    return { ok: false, kind: classify(e as ErrLike) === 'network' ? 'network' : 'auth' };
  }
}

/**
 * Sign out this device only ('local' revokes this session's refresh token on the server; other devices stay signed
 * in). The caller must also evict caches (scope.ts keysToEvict), delete this device's push token row and apply the
 * drafts decision (signout.ts) before showing the sign-in screen.
 */
export async function signOutThisDevice(client: SupabaseClient): Promise<void> {
  await client.auth.signOut({ scope: 'local' });
}

/**
 * Mapping onto the G2 shell's AccessAdapter snapshot (mobile/src/features/identity/domain/access.ts): the server
 * snapshot fills G2's optional `scope`. `no_access` maps to authorized-with-no-experiences, which G2's resolveAccess()
 * turns into unavailable/noExperience; `no_profile` → unavailable/unknownAccount.
 */
export function toShellSnapshot(s: AccessSnapshot, displayName: string) {
  if (s.status === 'no_profile') return { kind: 'unavailable' as const, reason: 'unknownAccount' as const };
  return {
    kind: 'authorized' as const, subjectId: s.userId, displayName, allowedExperiences: s.experiences, source: 'server' as const,
    scope: {
      role: s.role ?? undefined,
      hubId: s.hubId,
      children: s.children.map((c) => ({ cadetId: c.cadetId, firstName: c.firstName, hubId: c.hubId })),
      capabilities: { ...s.capabilities },
    },
  };
}
