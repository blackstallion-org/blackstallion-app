/**
 * Field cadets/assessment/capture (FO-02..FO-07): repository contract.
 * Implementations: fixtures in `src/dev/fixtures/fieldApp.ts` (development only, synthetic), server in `./server.ts`
 * (SLICE_CONTRACT §A/B + BACKEND_CONTRACT_V2 §3.1, §3.8, §3.10). Every read takes the caller's FieldScope; the server
 * decides what the caller may see (RLS / SECURITY DEFINER functions) and the client adds hub filters only as defence in
 * depth. Reads reject with ScopedLoadError (reference `OFFLINE` for network failures, `NOT-FOUND` for neutral 404s).
 */
import type { CheckInRequest, CheckInResult, FieldWorkflowRepository, PublishRequest, PublishResult } from '../domain/workflow';
import type { FieldScope } from '../types';

export type DataSource = 'synthetic-preview' | 'server';
export type RankCode = 'CADET_SQUIRE' | 'CADET_RIDER' | 'CADET_KNIGHT' | 'SOVEREIGN_LANCER';

/** Today's state of one cadet at the caller's hub. `published: null` = this role can't read sessions. */
export type TodayCheckIn = {
  checkInId: string;
  checkInOperationId: string;
  cadetId: string;
  cadetName: string;
  /** HH:MM hub-local, server receipt time. */
  time: string;
  published: boolean | null;
};

export type HubCadet = {
  id: string;
  name: string;
  rank: RankCode | null;
  today: { checkInOperationId: string; time: string; published: boolean | null } | null;
};

export type CadetList = { source: DataSource; hubName: string; cadets: HubCadet[] };

/** `allowed` = granted under the current wording; `off` = not set, withdrawn or old wording; `unknown` = couldn't check (treated as off). */
export type ConsentValue = 'allowed' | 'off' | 'unknown';
export type MediaConsent = { sessionVideo: ConsentValue; carePhoto: ConsentValue; postureAnalysis: ConsentValue };
export const UNKNOWN_CONSENT: MediaConsent = { sessionVideo: 'unknown', carePhoto: 'unknown', postureAnalysis: 'unknown' };

export type Scores = { riding: number; ground: number; stable: number };

export type SessionSummary = {
  id: string;
  sessionDate: string;
  scores: Scores | null;
  version: number;
  /** Seal set by the server on publish (brass_stamp_verified). Legacy rows may lack it. */
  published: boolean;
  /** Who recorded it (only they or SUPER_ADMIN may correct, Q8 default). */
  instructorId: string | null;
};

export type CadetProfile = {
  source: DataSource;
  cadet: { id: string; name: string; firstName: string; rank: RankCode | null; passportHint: string | null; horseName: string | null };
  /** Today's check-in (a voided one is left out). `checkInId` is what FO-16 voids. */
  today: { checkInId: string; checkInOperationId: string; time: string; publishedSessionId: string | null } | null;
  /** Recent check-ins, newest first (voided ones left out). */
  attendance: { date: string; time: string; published: boolean | null }[];
  /** null = this role can't read assessments (only instructors can, MIG:198-201). */
  sessions: SessionSummary[] | null;
  consent: MediaConsent;
};

export type Skill = { id: string; name: string; category: string };

export type SessionCorrection = { id: string; versionBefore: number; reason: string; correctedAt: string; previous: Scores & { notes: string | null } };

export type SessionRecord = SessionSummary & {
  cadetId: string;
  cadetName: string;
  notes: string | null;
  skillIds: string[];
  hasClip: boolean;
  corrections: SessionCorrection[];
};

export type RosterRow = {
  cadetId: string;
  name: string;
  rank: RankCode | null;
  horseName: string | null;
  checkInId: string | null;
  checkedInAt: string | null;
  sessionId: string | null;
  published: boolean;
  sessionVideoAllowed: boolean;
};

export type FieldPolicyFlags = { sessionRoster: boolean };

export type CorrectRequest = {
  sessionId: string;
  /** The version the instructor loaded; a newer server version → PT409, never a silent overwrite. */
  expectedVersion: number;
  scores: Scores;
  notes: string | null;
  reason: string;
  operationId: string;
};
export type CorrectResult = { sessionId: string; version: number; correctionId: string; duplicate: boolean };

/** FO-06 → FO-16: void today's wrong check-in with a reason (G9 field_void_check_in, SD-05 draft). */
export type VoidCheckInRequest = { checkInId: string; reason: string; operationId: string };
export type VoidCheckInResult = { checkInId: string; voidedAt: string; duplicate: boolean };

/** A captured clip uploaded to the private `session-videos` bucket at `<hub>/<cadet>/<clipId>.mp4`. */
export type UploadClipRequest = { hubId: string; cadetId: string; clipId: string; uri: string; mimeType: string };
export type UploadClipResult = { objectPath: string };

export interface FieldCommandRepository extends FieldWorkflowRepository {
  checkIn(req: CheckInRequest): Promise<CheckInResult>;
  publish(req: PublishRequest): Promise<PublishResult>;
  correct(req: CorrectRequest): Promise<CorrectResult>;
  /** Absent when the server has no void function; FO-06 then hides the action. */
  voidCheckIn?: (req: VoidCheckInRequest) => Promise<VoidCheckInResult>;
  /** Absent when this build has no media upload path; FO-03 then publishes scores without the clip. */
  uploadClip?: (req: UploadClipRequest) => Promise<UploadClipResult>;
}

/** Development only: what a synthetic persona would get from the access snapshot (personas carry no server scope). */
export type PreviewFieldAccess = {
  role: 'INSTRUCTOR' | 'GROOM' | 'SCHOOL_ADMIN';
  hubId: string;
  capabilities: { recordAssessment: boolean; viewHubCadets: boolean; uploadSessionVideo: boolean };
};

export interface FieldAppRepositories {
  cadets: {
    list(scope: FieldScope): Promise<CadetList>;
    /** Rejects with ScopedLoadError reference `NOT-FOUND` for an unknown cadet or one at another hub (indistinguishable). */
    profile(scope: FieldScope, cadetId: string): Promise<CadetProfile>;
  };
  checkIns: { listToday(scope: FieldScope): Promise<TodayCheckIn[]> };
  sessions: {
    record(scope: FieldScope, sessionId: string): Promise<SessionRecord>;
    /** Active skills catalogue. Empty while D16 is unsigned and nothing is configured. */
    skills(scope: FieldScope): Promise<Skill[]>;
  };
  consent: { forCadet(scope: FieldScope, cadetId: string): Promise<MediaConsent> };
  policy: { flags(scope: FieldScope): Promise<FieldPolicyFlags> };
  roster: { forDate(scope: FieldScope, sessionDate: string): Promise<RosterRow[]> };
  /**
   * Commands for the signed-in caller. The server identifies the caller from the session token and ignores the scope
   * apart from the hub used in clip paths; fixtures use the scope's subject as the simulated caller.
   */
  commands(scope: FieldScope): FieldCommandRepository;
  /** Development fixtures only. */
  previewAccess?: (subjectId: string) => PreviewFieldAccess | null;
  /** Development fixtures only: synthetic passport codes for the controlled scan input. */
  previewPassportCodes?: (subjectId: string) => readonly { code: string; label: string }[];
}
