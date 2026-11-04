/** Family home view model (13 F01). Shapes are provisional until D31/G4 contracts. */
export type FamilyHomeData = {
  source: 'synthetic-preview' | 'server';
  guardianFirstName: string;
  hubName: string;
  children: { id: string; name: string }[];
  selectedChildId: string | null;
  nextSession: { label: string; detail: string } | null;
  latestAssessment: {
    dateLabel: string;
    riding: number;
    ground: number;
    stable: number;
    skills: string[];
    corrected: boolean;
  } | null;
  /** Last five sessions, oldest first: true = attended. */
  recentAttendance: boolean[];
};

export type FamilyScope = { subjectId: string; experience: 'family' };

export interface FamilyHomeRepository {
  getHome(scope: FamilyScope, childId?: string): Promise<FamilyHomeData>;
}
