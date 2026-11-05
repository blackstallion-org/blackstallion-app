/**
 * Shared access/profile/settings (SH-02,03,04,06,08,09,10,12,13): repository contract.
 * Implementations: fixtures in `src/dev/fixtures/account.ts` (development only, synthetic), server in `./server.ts`
 * (BACKEND_CONTRACT_V2 §3.4–3.5 over supabase-js). Screens read `useRepositories().account`; when it is undefined they
 * show an honest "not connected" state.
 *
 * The OTP boundary (SH-02) is NOT here: it belongs to the access adapter (`core/auth`, real `verifyOtp`), with a
 * synthetic preview exported by the dev fixtures for development builds only.
 */
import type { AuthorizedSession, Experience } from '@/features/identity/domain/access';

import type { SupportContact, UpdateDestinations } from '../config';
import type { DeletionRequest } from '../domain/deletion';
import type { NotificationCategory, NotificationPreferenceAck, OsNotificationPermission } from '../domain/notifications';
import type { ProfileDetails } from '../domain/profile';
import type { VersionPolicy } from '../domain/version';

/**
 * Whose account a call is for. The SERVER ignores this (it reads `auth.uid()` on every call, §1); fixtures use it to
 * scope synthetic data exactly as the server would, and refuse any other subject.
 */
export type AccountScope = {
  subjectId: string;
  displayName: string;
  allowedExperiences: readonly Experience[];
  scope?: AuthorizedSession['scope'];
};

export interface ProfileRepository {
  /** Display details for the header (role line, hub name, children). Display only; grants nothing. */
  get(subject: AccountScope): Promise<ProfileDetails>;
}

export interface NotificationPreferencesRepository {
  /** `app_notification_preferences()`: only categories offered to the caller. */
  list(subject: AccountScope): Promise<NotificationCategory[]>;
  /** `app_set_notification_preference`: replay-safe by operation id; resolves only after server acknowledgement. */
  set(subject: AccountScope, req: { category: string; enabled: boolean; operationId: string }): Promise<NotificationPreferenceAck>;
}

export type DeletionCommandResult = DeletionRequest & { duplicate: boolean };

export interface AccountDeletionRepository {
  /** `app_account_deletion_status()`: the caller's latest request, or null. Visible after reinstall. */
  status(subject: AccountScope): Promise<DeletionRequest | null>;
  /** `app_request_account_deletion`: a request only — nothing is deleted by it. One open request per person. */
  request(subject: AccountScope, req: { reason: string | null; operationId: string }): Promise<DeletionCommandResult & { alreadyOpen: boolean }>;
  /** `app_cancel_account_deletion`: only while `requested`. */
  cancel(subject: AccountScope, req: { requestId: string; operationId: string }): Promise<DeletionCommandResult & { alreadyCancelled: boolean }>;
}

export interface VersionPolicyRepository {
  /** Minimum supported build (SH-12). No server contract exists yet; absent → the gate fails open. */
  get(): Promise<VersionPolicy>;
}

export interface SupportDirectory {
  /** Academy contact (SH-09) and update links (SH-12). Build configuration, not a server read. */
  contact(): Promise<SupportContact>;
  updateDestinations(): Promise<UpdateDestinations>;
}

/**
 * Unsent local work (SH-06, SH-10, SH-12). Injected by the composition root from the sync outbox when one is wired;
 * absent = this build keeps no unsent work on the phone.
 */
export interface PendingWorkPort {
  /** Items queued on this phone by `subjectId` that the server has not acknowledged. */
  count(subjectId: string): Promise<number>;
  /** Deletes them from this phone (SH-06 "Discard"). Absent = discarding is not offered. */
  discard?(subjectId: string): Promise<void>;
  /** false = the queue lives in memory only (lost when the app closes): copy must not promise it stays on the phone. */
  durable?: boolean;
}

/** OS notification permission (SH-08). Absent or `unknown` = the build cannot read it; the screen says so. */
export interface NotificationPermissionPort {
  status(): Promise<OsNotificationPermission>;
}

export interface AccountRepositories {
  profile: ProfileRepository;
  notifications: NotificationPreferencesRepository;
  deletion: AccountDeletionRepository;
  support: SupportDirectory;
  versionPolicy?: VersionPolicyRepository;
  pendingWork?: PendingWorkPort;
  notificationPermission?: NotificationPermissionPort;
}
