import type { AccessSnapshot } from '@/features/identity/domain/access';

/**
 * Replaceable access adapter. G2 ships two implementations:
 *  - `unconnectedAccessAdapter` (all non-development builds): always signed out;
 *  - a development-only synthetic preview adapter in src/dev.
 * G3 replaces both with the real provider + server-built access snapshot.
 */
export interface AccessAdapter {
  /** Short name for diagnostics/About; never shown as an authorization claim. */
  readonly name: string;
  /** Cold start / resume: read session, validate it, fetch the access snapshot. */
  load(): Promise<AccessSnapshot>;
  /** Clear the session (and, in G3, tokens and private caches). */
  signOut(): Promise<void>;
  /** Notifies when the session changes outside load() (sign-in, expiry, revocation). */
  subscribe(listener: () => void): () => void;
}

export const unconnectedAccessAdapter: AccessAdapter = {
  name: 'unconnected',
  load: async () => ({ kind: 'signedOut' }),
  signOut: async () => undefined,
  subscribe: () => () => undefined,
};
