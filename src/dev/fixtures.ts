/**
 * DEVELOPMENT-ONLY synthetic fixtures. All names are invented and marked
 * "(sample)". Each record belongs to exactly one subject and one experience;
 * the fixture repositories refuse any other scope, mirroring server scoping.
 */
import { ScopedLoadError } from '@/core/data/useScopedResource';
import { createAccountFixtures } from './fixtures/account';
import { createBillingFixtures } from './fixtures/billing';
import { createFamilyAppFixtures } from './fixtures/familyApp';
import { createFieldAppFixtures } from './fixtures/fieldApp';
import { createFieldOpsFixtures } from './fixtures/fieldOps';
import { createOutboxPendingWork } from '@/features/fieldOps/data/pendingWork';
import type { FieldOpsRepositories } from '@/features/fieldOps/data/repositories';
import type { AccountRepositories } from '@/features/account/data/repositories';
import type { Repositories } from '@/core/data/RepositoryProvider';
import type { FamilyHomeData } from '@/features/family/types';
import type { FieldTodayData } from '@/features/field/types';

import { createSparkFixture } from './sparkFixture';

type FamilyRecord = Omit<FamilyHomeData, 'selectedChildId' | 'latestAssessment' | 'nextSession' | 'recentAttendance'> & {
  perChild: Record<string, Pick<FamilyHomeData, 'latestAssessment' | 'nextSession' | 'recentAttendance'>>;
};

const FAMILY: Record<string, FamilyRecord> = {
  'syn-guardian-a': {
    source: 'synthetic-preview',
    guardianFirstName: 'Priya (sample)',
    hubName: 'Demo Hub One',
    children: [
      { id: 'syn-cadet-a1', name: 'Aarav (sample)' },
      { id: 'syn-cadet-a2', name: 'Meera (sample)' },
    ],
    perChild: {
      'syn-cadet-a1': {
        nextSession: { label: 'Tue 10 Nov · 9:30', detail: 'Riding A · horse Badal (sample)' },
        latestAssessment: { dateLabel: 'Sat 7 Nov', riding: 8, ground: 6, stable: 8, skills: ['Rising trot', 'Tacking up'], corrected: true },
        recentAttendance: [true, true, false, true, true],
      },
      'syn-cadet-a2': {
        nextSession: { label: 'Wed 11 Nov · 16:00', detail: 'Ground B · horse Chetak (sample)' },
        latestAssessment: null,
        recentAttendance: [],
      },
    },
  },
  'syn-guardian-b': { source: 'synthetic-preview', guardianFirstName: 'Kiran (sample)', hubName: 'Demo Hub One', children: [], perChild: {} },
  'syn-dual': {
    source: 'synthetic-preview',
    guardianFirstName: 'Anil (sample)',
    hubName: 'Demo Hub Two',
    children: [{ id: 'syn-cadet-d1', name: 'Isha (sample)' }],
    perChild: {
      'syn-cadet-d1': {
        nextSession: { label: 'Thu 12 Nov · 7:00', detail: 'Riding C · horse Toofan (sample)' },
        latestAssessment: { dateLabel: 'Mon 9 Nov', riding: 7, ground: 7, stable: 9, skills: ['Mounting'], corrected: false },
        recentAttendance: [true, true, true, true, false],
      },
    },
  },
};

const FIELD: Record<string, FieldTodayData> = {
  'syn-instructor': {
    source: 'synthetic-preview',
    staffFirstName: 'Ravi (sample)',
    roleLabel: 'Instructor',
    hubName: 'Demo Hub One',
    dateLabel: 'Tue 10 Nov',
    pendingSyncCount: 2,
    overdueCareCount: 0,
    sessions: [],
    care: [{ id: 'syn-c1', time: '12:00', horse: 'Badal (sample)', task: 'Tack check', state: 'due' }],
    cadets: [
      { id: 'syn-f1', name: 'Kabir (sample)', group: 'Riding A' },
      { id: 'syn-f2', name: 'Diya (sample)', group: 'Riding A' },
      { id: 'syn-f3', name: 'Rohan (sample)', group: 'Ground B' },
    ],
  },
  'syn-groom': {
    source: 'synthetic-preview',
    staffFirstName: 'Suresh (sample)',
    roleLabel: 'Groom',
    hubName: 'Demo Hub One',
    dateLabel: 'Tue 10 Nov',
    pendingSyncCount: 0,
    overdueCareCount: 1,
    sessions: [],
    care: [
      { id: 'syn-g1', time: '06:00', horse: 'Badal (sample)', task: 'Morning feed', state: 'done' },
      { id: 'syn-g2', time: '09:00', horse: 'Chetak (sample)', task: 'Water', state: 'overdue' },
      { id: 'syn-g3', time: '12:00', horse: 'Badal (sample)', task: 'Water', state: 'due' },
    ],
    cadets: [],
  },
  'syn-hub-admin': {
    source: 'synthetic-preview',
    staffFirstName: 'Meena (sample)',
    roleLabel: 'Hub admin',
    hubName: 'Demo Hub One',
    dateLabel: 'Tue 10 Nov',
    pendingSyncCount: 0,
    overdueCareCount: 0,
    sessions: [],
    care: [],
    cadets: [],
  },
  'syn-field-offline': {
    source: 'synthetic-preview',
    staffFirstName: 'Kavya (sample)',
    roleLabel: 'Groom',
    hubName: 'Demo Hub One',
    dateLabel: 'Tue 10 Nov',
    pendingSyncCount: 0,
    overdueCareCount: 0,
    sessions: [],
    care: [],
    cadets: [],
  },
  'syn-dual': {
    source: 'synthetic-preview',
    staffFirstName: 'Anil (sample)',
    roleLabel: 'Instructor',
    hubName: 'Demo Hub Two',
    dateLabel: 'Tue 10 Nov',
    pendingSyncCount: 0,
    overdueCareCount: 0,
    sessions: [],
    care: [],
    cadets: [{ id: 'syn-f9', name: 'Tara (sample)', group: 'Riding C' }],
  },
};

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Unsent work = the account preview's synthetic count plus the Field Ops outbox on this phone (SH-06/SH-10/SH-12). */
function withOutbox(account: AccountRepositories, fieldOps: FieldOpsRepositories | undefined): AccountRepositories {
  const base = account.pendingWork;
  if (!fieldOps) return account;
  const outbox = createOutboxPendingWork(fieldOps.outbox);
  return {
    ...account,
    pendingWork: {
      durable: outbox.durable,
      count: async (subjectId) => (base ? await base.count(subjectId) : 0) + (await outbox.count(subjectId)),
      async discard(subjectId) {
        await base?.discard?.(subjectId);
        await outbox.discard?.(subjectId);
      },
    },
  };
}

export const createFixtureRepositories = ({ latencyMs = 450 }: { latencyMs?: number } = {}): Repositories => {
  const fieldOps = createFieldOpsFixtures();
  return {
  spark: createSparkFixture({ latencyMs }),
  account: withOutbox(createAccountFixtures({ latencyMs }), fieldOps),
  familyApp: createFamilyAppFixtures(),
  fieldApp: createFieldAppFixtures(),
  fieldOps,
  billing: createBillingFixtures(),
  familyHome: {
    async getHome(scope, childId) {
      await wait(latencyMs);
      if (scope.experience !== 'family') throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
      if (scope.subjectId === 'syn-guardian-err') throw new ScopedLoadError('Simulated failure', 'FIXTURE-500-0001');
      const rec = FAMILY[scope.subjectId];
      if (!rec) throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
      const { perChild, ...base } = rec;
      // A child ID that is not linked to this guardian is ignored, never served.
      const selected = rec.children.find((c) => c.id === childId) ?? rec.children[0] ?? null;
      const detail = selected ? perChild[selected.id] : undefined;
      return structuredClone({
        ...base,
        selectedChildId: selected?.id ?? null,
        nextSession: detail?.nextSession ?? null,
        latestAssessment: detail?.latestAssessment ?? null,
        recentAttendance: detail?.recentAttendance ?? [],
      });
    },
  },
  fieldToday: {
    async getToday(scope) {
      await wait(latencyMs);
      if (scope.experience !== 'field') throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
      const rec = FIELD[scope.subjectId];
      if (!rec) throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
      return structuredClone(rec);
    },
  },
  };
};
