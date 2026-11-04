/** Field Ops "Today" view model (13 W01). Provisional until D31/G4 contracts. */
export type FieldTodayData = {
  source: 'synthetic-preview' | 'server';
  staffFirstName: string;
  roleLabel: string;
  hubName: string;
  dateLabel: string;
  pendingSyncCount: number;
  overdueCareCount: number;
  sessions: { id: string; time: string; title: string; cadetCount: number }[];
  care: { id: string; time: string; horse: string; task: string; state: 'done' | 'due' | 'overdue' }[];
  cadets: { id: string; name: string; group: string }[];
  /** Server builds: today's check-ins at this hub (no schedule tables exist yet, 16 §3). */
  checkIns?: {
    checkInId: string;
    checkInOperationId: string;
    cadetId: string;
    cadetName: string;
    time: string;
    /** null when this role can't read sessions (only instructors can, MIG:198-201). */
    published: boolean | null;
  }[];
  /** False when care tasks are not connected in this build, so the screen must not claim "no tasks". */
  careAvailable?: boolean;
};

export type FieldScope = {
  subjectId: string;
  experience: 'field';
  /** From the server access snapshot; never chosen by the user. */
  hubId?: string | null;
  role?: string;
  displayName?: string;
};

export interface FieldTodayRepository {
  getToday(scope: FieldScope): Promise<FieldTodayData>;
}
