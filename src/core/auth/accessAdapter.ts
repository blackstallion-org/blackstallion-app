import type { AccessSnapshot } from '@/features/identity/domain/access';

/** Outcome of a credential sign-in. Never says whether an account exists. */
export type SignInResult = { ok: true } | { ok: false; reason: 'invalid' | 'network' | 'unavailable' };
/** Sending a code: success never reveals whether an account exists for the address. */
export type CodeRequestResult = { ok: true } | { ok: false; reason: 'network' | 'unavailable' };
export type ResetResult = { ok: true } | { ok: false; reason: 'invalid' | 'weakPassword' | 'network' | 'unavailable' };

/**
 * Replaceable access adapter. Implementations:
 *  - `unconnectedAccessAdapter`: always signed out (builds with no backend configured);
 *  - a development-only synthetic preview adapter in src/dev (dev builds with no backend configured);
 *  - the Supabase adapter (src/core/auth/supabase, G3): real provider + server-built access snapshot.
 */
export interface AccessAdapter {
  /** Short name for diagnostics/About; never shown as an authorization claim. */
  readonly name: string;
  /** Cold start / resume: read session, validate it, fetch the access snapshot. */
  load(): Promise<AccessSnapshot>;
  /** Clear the session: server sign-out for this device, stored tokens and private caches. */
  signOut(): Promise<void>;
  /** Notifies when the session changes outside load() (sign-in, expiry, revocation). */
  subscribe(listener: () => void): () => void;
  /**
   * E-mail + password sign-in, offered only by adapters connected to a real backend. Other methods (phone or
   * e-mail code, Google) wait for Q6/D07. Success is reported through `subscribe`, which triggers `load()`.
   */
  signInWithPassword?(email: string, password: string): Promise<SignInResult>;
  /** E-mail one-time code (D07, signed 4 Nov 2026). Never creates an account. */
  requestEmailCode?(email: string): Promise<CodeRequestResult>;
  verifyEmailCode?(email: string, code: string): Promise<SignInResult>;
  /** Recovery by e-mail code (D07). The new password is set in the app; success signs the person in. */
  requestPasswordReset?(email: string): Promise<CodeRequestResult>;
  completePasswordReset?(email: string, code: string, newPassword: string): Promise<ResetResult>;
}

export const unconnectedAccessAdapter: AccessAdapter = {
  name: 'unconnected',
  load: async () => ({ kind: 'signedOut' }),
  signOut: async () => undefined,
  subscribe: () => () => undefined,
};
