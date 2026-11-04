/**
 * Access bootstrap rules (07 "Boot and session state machine"). Pure TypeScript:
 * no React, Expo or transport imports.
 *
 * The client never grants itself access. `allowedExperiences` comes from the
 * access adapter (in G3: a server-built snapshot). Choosing an experience only
 * selects navigation and query scope among what the snapshot already allows.
 */
export type Experience = 'family' | 'field';

export const EXPERIENCES: readonly Experience[] = ['family', 'field'];

export type UnavailableReason = 'unknownAccount' | 'disabled' | 'noExperience' | 'bootError';

/** What an adapter reports. G3 builds this on the server. */
export type AccessSnapshot =
  | { kind: 'signedOut' }
  | { kind: 'unavailable'; reason: Exclude<UnavailableReason, 'noExperience' | 'bootError'> }
  | {
      kind: 'authorized';
      subjectId: string;
      displayName: string;
      allowedExperiences: readonly Experience[];
      /** Provenance shown to the user: synthetic previews must never look real. */
      source: 'synthetic-preview' | 'server';
      /**
       * Server-provided scope for G3 (role, hub, linked children, capability
       * flags from app_access_snapshot). Used for query scoping and deep-link
       * checks only; the client never derives new access from it.
       */
      scope?: {
        role?: string;
        hubId?: string | null;
        children?: readonly { cadetId: string; firstName: string; hubId: string | null }[];
        capabilities?: Readonly<Record<string, boolean>>;
      };
    };

export type AuthorizedSession = Extract<AccessSnapshot, { kind: 'authorized' }>;

export type AccessState =
  | { phase: 'loading' }
  | { phase: 'signedOut' }
  | { phase: 'unavailable'; reason: UnavailableReason }
  | { phase: 'authorized'; session: AuthorizedSession; experience: Experience };

const isExperience = (value: unknown): value is Experience => value === 'family' || value === 'field';

/** Keeps only known experiences, in canonical order, without duplicates. */
export const sanitizeExperiences = (input: readonly unknown[]): Experience[] =>
  EXPERIENCES.filter((e) => input.includes(e));

/**
 * Turns an adapter snapshot into app state. `lastChoice` is the device-local
 * last selection for this subject; it is honoured only if still allowed.
 */
export const resolveAccess = (
  snapshot: AccessSnapshot,
  lastChoice?: { subjectId: string; experience: string } | null,
): AccessState => {
  if (snapshot.kind === 'signedOut') return { phase: 'signedOut' };
  if (snapshot.kind === 'unavailable') return { phase: 'unavailable', reason: snapshot.reason };
  const allowed = sanitizeExperiences(snapshot.allowedExperiences);
  const first = allowed[0];
  if (!first) return { phase: 'unavailable', reason: 'noExperience' };
  const session: AuthorizedSession = { ...snapshot, allowedExperiences: allowed };
  const remembered =
    lastChoice && lastChoice.subjectId === snapshot.subjectId && isExperience(lastChoice.experience)
      ? lastChoice.experience
      : null;
  const experience = remembered && allowed.includes(remembered) ? remembered : first;
  return { phase: 'authorized', session, experience };
};

export const canSwitchExperience = (state: AccessState): boolean =>
  state.phase === 'authorized' && state.session.allowedExperiences.length > 1;

/**
 * Switching changes navigation and query scope only. A target outside the
 * snapshot's allowed set is refused; the allowed set itself never changes.
 */
export const switchExperience = (state: AccessState, target: Experience): AccessState => {
  if (state.phase !== 'authorized') return state;
  if (!state.session.allowedExperiences.includes(target)) return state;
  return { ...state, experience: target };
};

/**
 * Cache/data scope key: subject + experience (+ hub for Field Ops when the
 * snapshot carries one). Every scoped read is keyed by it,
 * so data from another person or experience can never satisfy a read.
 */
export const contextKeyOf = (state: AccessState): string | null => {
  if (state.phase !== 'authorized') return null;
  const base = `${state.session.subjectId}:${state.experience}`;
  // Field data is hub-scoped: a hub move must not let old-hub data satisfy reads.
  if (state.experience === 'field' && state.session.scope?.hubId !== undefined) {
    return `${base}:hub=${state.session.scope.hubId ?? 'none'}`;
  }
  return base;
};

export const homeHrefFor = (experience: Experience): '/family' | '/field' =>
  experience === 'family' ? '/family' : '/field';
