/**
 * Family screens (FA-02..FA-13): repository contract.
 * Implementations: fixtures in `src/dev/fixtures/familyApp.ts` (development only, synthetic, labelled), server in
 * `./server.ts` (BACKEND_CONTRACT_V2 G9 RPCs + SLICE_CONTRACT §B reads under RLS).
 *
 * Scope rule (every method): the child id must be one of `scope.children` from the ACCESS SNAPSHOT. Implementations
 * refuse any other id before making a request, so a guessed or deep-linked id of another family's child is never sent
 * (server RLS/RPC checks remain the authority: 91_g9_family_tests.sql, 80_mobile_authorization_tests.sql).
 */
import type { CommandErrorKind } from '@/features/field/domain/commandErrors';

import type { ConsentState } from '../domain/consent';
import type { PassportInput } from '../domain/passportTypes';
import type { Scores } from '../domain/progress';
import type { StreamGrant } from '../domain/stallcam';
import type { StreamCapability } from '../domain/stream';
import type { SparkFeature } from '../spark/types';
import type { FamilyScope } from '../types';

export type DataSource = 'synthetic-preview' | 'server';

/** A child linked to the signed-in guardian (access snapshot). */
export type FamilyChild = { id: string; firstName: string; hubId: string | null };

// ------------------------------------------------------------------ FA-02 / FA-04
export type SessionSummary = {
  id: string;
  childId: string;
  /** Hub-local YYYY-MM-DD. */
  date: string;
  scores: Scores;
  /** training_sessions.version > 1: corrected after publication. */
  corrected: boolean;
  hasClip: boolean;
};

export type ProgressData = {
  source: DataSource;
  childId: string;
  /** cadets.current_rank exactly as the server reports it (null when unreadable). */
  currentRank: string | null;
  /** Newest first, current revisions of published sessions only. */
  sessions: SessionSummary[];
  /** Opaque keyset cursor for older sessions; null when there are none. */
  nextCursor: string | null;
};

export type SessionPage = { sessions: SessionSummary[]; nextCursor: string | null };

// ------------------------------------------------------------------ FA-03
/** Server-side handle for a private clip. Never put in a URL or cached past its signed-URL lifetime. */
export type ClipRef = { sessionId: string; childId: string; date: string; objectPath: string };

export type SessionDetail = {
  source: DataSource;
  id: string;
  childId: string;
  date: string;
  scores: Scores;
  skills: { id: string; name: string; category: 'RIDING' | 'GROUND' | 'STABLE' | null }[];
  notes: string | null;
  version: number;
  /** Correction notices, newest first (training_session_corrections). */
  corrections: { at: string; reason: string | null }[];
  clip: ClipRef | null;
};

export type SignedMedia = { uri: string; expiresAt: number };

export type ClipEntry = SessionSummary & { clip: ClipRef };

// ------------------------------------------------------------------ FA-05
export type PassportData = {
  source: DataSource;
  childId: string;
  passportCode: string | null;
  input: PassportInput;
};

// ------------------------------------------------------------------ FA-07 / FA-08
export type HorseInfo = {
  source: DataSource;
  childId: string;
  hubName: string | null;
  horse: { id: string; name: string; breed: string | null; heightHands: number | null; temperament: string | null; active: boolean } | null;
  /** Guardian care visibility is undecided (SD-04) and has no read grant: always unavailable for now. */
  care: { status: 'unavailable'; decisionRef: string };
};

// ------------------------------------------------------------------ FA-09 / FA-10 / FA-11
export type EventChild = { childId: string; firstName: string; status: 'confirmed' | 'not_going' };

export type FamilyEvent = {
  id: string;
  hubId: string;
  title: string;
  description: string | null;
  venue: string;
  startsAt: string;
  endsAt: string | null;
  rsvpClosesAt: string;
  capacity: number;
  seatsLeft: number;
  status: 'published' | 'cancelled';
  image: { bucket: string; path: string } | null;
  rsvpOpen: boolean;
  /** Only the detail RPC reports it; null on list rows. */
  cancellationOpen: boolean | null;
  /** The caller's own children at this event's hub (never other families). */
  children: EventChild[];
};

export type EventList = { source: DataSource; events: FamilyEvent[] };
export type EventDetail = { source: DataSource; event: FamilyEvent };

export type RsvpCommand = { eventId: string; childId: string; operationId: string };
export type RsvpResult = { status: 'confirmed' | 'cancelled'; seatsLeft: number; already: boolean; duplicate: boolean };

// ------------------------------------------------------------------ FA-12
export type ConsentPurpose = { purpose: string; title: string; description: string | null; policyVersion: string };
export type ConsentCentre = {
  source: DataSource;
  purposes: ConsentPurpose[];
  children: { childId: string; firstName: string; consents: ConsentState[] }[];
};
export type ConsentHistoryEntry = { id: string; purpose: string; granted: boolean; policyVersion: string; recordedAt: string; byCurrentGuardian: boolean };
export type ConsentCommand = { childId: string; purpose: string; granted: boolean; policyVersion: string; operationId: string };
export type ConsentResult = { granted: boolean; recordedAt: string | null; changed: boolean; duplicate: boolean };

/** A command the server refused or could not confirm. `serverMessage` is for machine prefixes only, never shown raw. */
export class FamilyCommandError extends Error {
  constructor(
    readonly kind: CommandErrorKind,
    readonly serverMessage: string,
    readonly reference?: string,
  ) {
    super(serverMessage || kind);
    this.name = 'FamilyCommandError';
  }
}

export interface FamilyAppRepositories {
  /** Children from the access snapshot (server) or the synthetic persona (development). Synchronous: no request. */
  linkedChildren(scope: FamilyScope): readonly FamilyChild[];
  progress: {
    get(scope: FamilyScope, childId: string): Promise<ProgressData>;
    older(scope: FamilyScope, childId: string, cursor: string): Promise<SessionPage>;
    /** FA-04/FA-13: published sessions that have a private clip, newest first (handles only; no media is fetched). */
    clips(scope: FamilyScope, childId: string): Promise<{ source: DataSource; clips: ClipEntry[] }>;
  };
  sessions: {
    /** Unknown, malformed, or another family's id → ScopedLoadError with reference NOTFOUND (neutral). */
    get(scope: FamilyScope, recordId: string): Promise<SessionDetail>;
  };
  media: {
    /** Fails closed: refuses unless the child's current session_video consent is allowed. Short-lived URL. */
    clipUrl(scope: FamilyScope, clip: ClipRef): Promise<SignedMedia>;
    /** Event artwork from the private app-content bucket. */
    imageUrl(scope: FamilyScope, image: { bucket: string; path: string }): Promise<SignedMedia>;
    /** False when this build has no private media boundary (no storage client). */
    readonly available: boolean;
  };
  passport: { get(scope: FamilyScope, childId: string): Promise<PassportData> };
  horse: { get(scope: FamilyScope, childId: string): Promise<HorseInfo> };
  stream: {
    capability(scope: FamilyScope, childId: string): Promise<StreamCapability>;
    /** Absent until a stream provider and issuing boundary exist (D23/C03). */
    requestGrant?: (scope: FamilyScope, childId: string) => Promise<StreamGrant>;
  };
  events: {
    list(scope: FamilyScope): Promise<EventList>;
    detail(scope: FamilyScope, eventId: string): Promise<EventDetail>;
    rsvp(scope: FamilyScope, cmd: RsvpCommand): Promise<RsvpResult>;
    cancel(scope: FamilyScope, cmd: RsvpCommand): Promise<RsvpResult>;
  };
  consent: {
    centre(scope: FamilyScope): Promise<ConsentCentre>;
    history(scope: FamilyScope, childId: string): Promise<ConsentHistoryEntry[]>;
    set(scope: FamilyScope, cmd: ConsentCommand): Promise<ConsentResult>;
  };
  /** FA-06 wired to the G9 Spark contract (per child, acknowledgement). */
  spark?: SparkFeature;
}
