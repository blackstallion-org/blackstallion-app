// Copied from foundations/client-auth/src (G3, 4 Nov 2026), import extensions removed; keep both in step.
// Real AccessAdapter for the G2 shell (mobile/src/core/auth/accessAdapter.ts): same members, structurally
// typed so it is unit-tested here and dropped into mobile/ unchanged.
//   load()      stored session → app_access_snapshot() → validated → G2 snapshot (with scope)
//   signOut()   this device only; runs the injected cleanup (push token row, caches, drafts decision) FIRST, then
//               revokes the refresh token and removes the keystore copy (supabase-js does both in signOut)
//   subscribe() reloads only when the signed-in identity changes, never on routine token refresh
// Sign-out happens ONLY when the session itself is refused (refresh revoked/banned, or a 401 after one refresh)
// and only if that session still belongs to the user this load started with. Everything else (network, locked
// keystore, permission or schema errors on the snapshot) is a TransientAccessError: G2 shows "can't load" with
// Retry, nothing private renders, and the stored session is kept.
// The client is created by the app with the project URL and the publishable key only, and with
// `auth.storage = createChunkedSecureStorage(SecureStore)`, `persistSession: true`, `detectSessionInUrl: false`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { classify, loadSnapshot, refreshOnce, signOutThisDevice, toShellSnapshot } from './supabaseAccess';

export type SignInResult = { ok: true } | { ok: false; reason: 'invalid' | 'network' | 'unavailable' };
/** Sending a code: success never reveals whether an account exists for the address. */
export type CodeRequestResult = { ok: true } | { ok: false; reason: 'network' | 'unavailable' };
export type ResetResult = { ok: true } | { ok: false; reason: 'invalid' | 'weakPassword' | 'network' | 'unavailable' };

/** UX hint only (the server's password policy is authoritative); stops most weak choices before a code is spent. */
export const MIN_PASSWORD_LENGTH = 8;

interface AuthErr { status?: number; code?: string; message?: string }
function mapCodeRequest(error: AuthErr | null): CodeRequestResult {
  if (!error) return { ok: true };
  // 429 and 5xx before classify(), which treats them as transient "network": the service answered, it is not the connection
  if (error.status === 429 || (error.status ?? 0) >= 500) return { ok: false, reason: 'unavailable' };
  if (classify(error) === 'network') return { ok: false, reason: 'network' };
  // Unknown address, sign-ups not allowed for codes, etc.: answer exactly as for a real account (no enumeration).
  if (error.status !== undefined && error.status >= 400 && error.status < 500) return { ok: true };
  return { ok: false, reason: 'unavailable' };
}
function mapVerify(error: AuthErr | null): SignInResult {
  if (!error) return { ok: true };
  if (error.status === 429 || (error.status ?? 0) >= 500) return { ok: false, reason: 'unavailable' };
  if (classify(error) === 'network') return { ok: false, reason: 'network' };
  return { ok: false, reason: error.status !== undefined && error.status > 0 ? 'invalid' : 'unavailable' };
}

export class TransientAccessError extends Error {}   // G2 shows bootError with Retry; nothing private renders

type ShellSnapshot = ReturnType<typeof toShellSnapshot> | { kind: 'signedOut' };

export interface AdapterOptions {
  /** Called before the server sign-out, while the token still works (e.g. delete this device's push token row). */
  beforeSignOut?: (userId: string) => Promise<void>;
  /** Called after sign-out to drop query/image caches of that user. */
  afterSignOut?: (userId: string) => Promise<void> | void;
}

export function createSupabaseAccessAdapter(client: SupabaseClient, opts: AdapterOptions = {}) {
  let lastUserId: string | null = null;   // identity of the most recent load, for reload decisions
  let resetInProgress = false;            // suppresses reloads between recovery verify and password update
  const listeners = new Set<() => void>();
  const notifyAll = () => listeners.forEach((l) => l());

  const currentUserId = async (): Promise<string | null> => {
    try { return (await client.auth.getSession()).data.session?.user.id ?? null; } catch { return null; }
  };
  const signOut = async (): Promise<void> => {
    const userId = await currentUserId();
    try {
      if (userId && opts.beforeSignOut) await opts.beforeSignOut(userId).catch(() => undefined);
      await signOutThisDevice(client).catch(() => undefined);
      // auth-js 2.118 removes the stored session even when the server call fails (offline); make sure of it.
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    } finally {
      lastUserId = null;
      if (userId && opts.afterSignOut) await opts.afterSignOut(userId);
    }
  };
  /** Sign out only if the session still belongs to `userId`; otherwise this load is stale and must not act. */
  const endSessionOf = async (userId: string): Promise<ShellSnapshot> => {
    if ((await currentUserId()) !== userId) throw new TransientAccessError('session changed during load');
    await signOut();
    return { kind: 'signedOut' };
  };

  return {
    name: 'supabase',
    async load(): Promise<ShellSnapshot> {
      // getSession() refreshes an expired session by itself; a refused refresh (revoked, banned) arrives here.
      let got;
      try { got = await client.auth.getSession(); } catch (e) {
        throw new TransientAccessError(`session storage unavailable: ${String(e)}`); // e.g. keystore locked
      }
      if (got.error) {
        if (classify(got.error) === 'network') throw new TransientAccessError(got.error.message);
        await signOut(); return { kind: 'signedOut' };            // refused refresh: this session is over
      }
      const session = got.data.session;
      if (!session) { lastUserId = null; return { kind: 'signedOut' }; }
      const userId = session.user.id;
      const displayName = String(session.user.user_metadata?.full_name ?? session.user.email ?? '');
      let r = await loadSnapshot(client, userId);
      if (!r.ok && r.kind === 'auth') {                // exactly one refresh, then give up (no loop)
        const rf = await refreshOnce(client);
        if (!rf.ok && rf.kind === 'auth') return endSessionOf(userId);
        if (!rf.ok) throw new TransientAccessError('network during refresh');
        if (rf.userId !== userId) throw new TransientAccessError('session changed during load');
        r = await loadSnapshot(client, userId);
        if (!r.ok && r.kind === 'auth') return endSessionOf(userId);
      }
      if (r.ok) { lastUserId = userId; return toShellSnapshot(r.snapshot, displayName); }
      // network, forbidden, invalid (incl. a snapshot for another user after a switch mid-request, or a schema
      // mismatch): never render, never destroy a possibly newer session; let the person retry.
      throw new TransientAccessError(`${r.kind}: ${r.detail}`);
    },
    signOut,
    /**
     * E-mail + password: the method that already works on the website's project. Other methods wait for Q6/D07.
     * The result never says whether an account exists. On success, onAuthStateChange(SIGNED_IN) triggers load().
     */
    async signInWithPassword(email: string, password: string): Promise<SignInResult> {
      try {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (!error) return { ok: true };
        if (error.status === 429) return { ok: false, reason: 'unavailable' };   // rate limited: don't say "network"
        if (classify(error) === 'network') return { ok: false, reason: 'network' };
        return { ok: false, reason: error.status === 400 || error.status === 422 ? 'invalid' : 'unavailable' };
      } catch (e) {
        return { ok: false, reason: classify(e as { message?: string }) === 'network' ? 'network' : 'unavailable' };
      }
    },
    /** E-mail one-time code (D07). Never creates an account here: in-app sign-up is a separate flow. */
    async requestEmailCode(email: string): Promise<CodeRequestResult> {
      try {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
        return mapCodeRequest(error);
      } catch (e) {
        return mapCodeRequest({ ...(e as AuthErr), status: (e as AuthErr).status ?? 0 });
      }
    },
    async verifyEmailCode(email: string, code: string): Promise<SignInResult> {
      try {
        const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
        return mapVerify(error);
      } catch (e) {
        return mapVerify({ ...(e as AuthErr), status: (e as AuthErr).status ?? 0 });
      }
    },
    /** Recovery by e-mail code (D07). The result is the same whether or not the address has an account. */
    async requestPasswordReset(email: string): Promise<CodeRequestResult> {
      try {
        const { error } = await client.auth.resetPasswordForEmail(email.trim());
        return mapCodeRequest(error);
      } catch (e) {
        return mapCodeRequest({ ...(e as AuthErr), status: (e as AuthErr).status ?? 0 });
      }
    },
    /**
     * Verifies the recovery code, then sets the new password. The app does not reload in between (the code signs the
     * person in); if the new password is refused, this device is signed out again so nobody is left half-reset.
     */
    async completePasswordReset(email: string, code: string, newPassword: string): Promise<ResetResult> {
      if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weakPassword' };
      resetInProgress = true;
      let verified = false;   // only a verified code changes the session, so only then reload
      try {
        const v = mapVerify((await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' })).error);
        if (!v.ok) return v;
        verified = true;
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (!error) return { ok: true };
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
        if (classify(error) === 'network') return { ok: false, reason: 'network' };
        return { ok: false, reason: error.status === 422 || error.status === 400 ? 'weakPassword' : 'unavailable' };
      } catch (e) {
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
        return { ok: false, reason: classify(e as AuthErr) === 'network' ? 'network' : 'unavailable' };
      } finally {
        resetInProgress = false;
        if (verified) notifyAll();   // now let the shell reload: signed in with the new password, or signed out
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (resetInProgress) return; // the reset flow reloads once at the end
        const id = session?.user.id ?? null;
        // SIGNED_IN also fires on session recovery at start-up: reload only when the identity actually changes.
        if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && id !== lastUserId) listener();
        else if (event === 'SIGNED_OUT' && lastUserId !== null) { lastUserId = null; listener(); }
      });
      return () => { listeners.delete(listener); data.subscription.unsubscribe(); };
    },
  };
}
