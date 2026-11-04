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
};

export type FieldScope = { subjectId: string; experience: 'field' };

export interface FieldTodayRepository {
  getToday(scope: FieldScope): Promise<FieldTodayData>;
}
