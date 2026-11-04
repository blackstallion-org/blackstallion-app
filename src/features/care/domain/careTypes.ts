// Field Ops care model as delivered by field.my_care_timeline (server/live-delta/g5-field-care).
export type CareTaskType = 'feed' | 'water' | 'grooming_hoof' | 'tack_check' | 'medication';

export interface ServerCareOccurrence {
  occurrenceId: string;
  horseId: string;
  horseName: string;
  taskType: CareTaskType;
  slotKey: string;
  /** hub-local calendar day, YYYY-MM-DD */
  localDate: string;
  /** epoch ms */
  dueAt: number;
  timezone: string;
  /** hub-entered text; data, not translated by the app */
  instructions: string;
  status: 'pending' | 'submitted' | 'completed' | 'cancelled';
  scheduleVersion: number;
  latestSubmissionState: 'received' | 'review_required' | 'accepted' | 'rejected' | null;
  /** server-detected overdue (authoritative); never computed client-side */
  overdue: boolean;
}

/**
 * What the staff member sees about their evidence. Deliberately has no "verified" value:
 * received ≠ accepted, and only a hub reviewer can accept or reject.
 */
export type EvidenceDisplayState =
  | 'none'
  | 'captured'
  | 'sending'
  | 'received'
  | 'review_required'
  | 'accepted'
  | 'rejected'
  | 'needs_action';
