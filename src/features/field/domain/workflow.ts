import type { ValidAssessment } from './assessment';

/** First field workflow (NAVIGATION_MAP §6): passport → check-in → assess → publish. Online-only in slice 1. */
export type CheckInRequest = { passportCode: string; observedAt: Date; operationId: string };

export type CheckInResult = {
  checkInId: string;
  /** The check-in row's own operation id; publish needs THIS, not checkInId (MIG:404). */
  checkInOperationId: string;
  cadetId: string;
  cadetName: string;
  sessionDate: string;
  receivedAt: string;
  /** True when the cadet was already checked in that day by an EARLIER, different request (any instructor). */
  duplicate: boolean;
  /** False when the check-in is filed under a day other than today's hub date by the server's clock. Don't assess it. */
  isToday: boolean;
};

export type PublishRequest = { checkInOperationId: string; assessment: ValidAssessment; operationId: string };
export type PublishResult = { sessionId: string; version: number; sessionDate: string; duplicate: boolean };

export interface FieldWorkflowRepository {
  checkIn(req: CheckInRequest): Promise<CheckInResult>;
  publish(req: PublishRequest): Promise<PublishResult>;
}
