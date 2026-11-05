import { ScopedLoadError } from '@/core/data/useScopedResource';
import { createFakeSupabase, pgError } from '@/testing/fakeSupabase';

import { createSupabaseFamilyHomeRepository } from '../data/supabaseFamilyHomeRepository';

const tables = {
  school_hubs: [{ id: 'hub-a', school_name: 'Sovereign Hub A' }],
  training_sessions: [
    { id: 'ts-old', cadet_id: 'c1', session_date: '2026-10-28', riding_score: 4, ground_score: 4, stable_score: 4, version: 1, brass_stamp_verified: true },
    { id: 'ts-new', cadet_id: 'c1', session_date: '2026-11-04', riding_score: 7, ground_score: 6, stable_score: 8, version: 2, brass_stamp_verified: true },
    { id: 'ts-legacy', cadet_id: 'c1', session_date: '2026-11-05', riding_score: null, ground_score: null, stable_score: null, version: 1, brass_stamp_verified: true },
    // Not published (seal false): never shown to the family, even though it is newer.
    { id: 'ts-unsealed', cadet_id: 'c1', session_date: '2026-11-06', riding_score: 2, ground_score: 2, stable_score: 2, version: 1, brass_stamp_verified: false },
    { id: 'ts-other', cadet_id: 'c2', session_date: '2026-11-04', riding_score: 9, ground_score: 9, stable_score: 9, version: 1, brass_stamp_verified: true },
  ],
  session_skills: [{ session_id: 'ts-new', skill_id: 'sk1' }, { session_id: 'ts-new', skill_id: 'sk2' }],
  skills: [{ id: 'sk1', name: 'Rising trot' }, { id: 'sk2', name: 'Grooming' }],
};
const scope = {
  subjectId: 'g1',
  experience: 'family' as const,
  displayName: 'Anita Rao',
  children: [{ cadetId: 'c1', firstName: 'Aarav', hubId: 'hub-a' }],
};

it('shows the newest complete published session of the selected child, flagged when corrected', async () => {
  const { client } = createFakeSupabase({ tables });
  const d = await createSupabaseFamilyHomeRepository(client).getHome(scope);
  expect(d).toMatchObject({
    source: 'server',
    guardianFirstName: 'Anita',
    hubName: 'Sovereign Hub A',
    children: [{ id: 'c1', name: 'Aarav' }],
    selectedChildId: 'c1',
    nextSession: null, // no schedule source exists; the card is hidden
    recentAttendance: [],
    latestAssessment: { sessionId: 'ts-new', dateLabel: '4 Nov 2026', riding: 7, ground: 6, stable: 8, skills: ['Grooming', 'Rising trot'], corrected: true },
  });
});

it('never requests a child that is not linked to this guardian, even if asked by id', async () => {
  const { client, calls } = createFakeSupabase({ tables });
  const d = await createSupabaseFamilyHomeRepository(client).getHome(scope, 'c2');
  expect(d.selectedChildId).toBe('c1');
  const asked = calls.flatMap((c) => (c.kind === 'from' ? c.ops : [])).filter((o) => o[0] === 'eq' && o[1] === 'cadet_id');
  expect(asked).toEqual([['eq', 'cadet_id', 'c1']]);
});

it('makes no request when the guardian has no linked child', async () => {
  const { client, calls } = createFakeSupabase({ tables });
  const d = await createSupabaseFamilyHomeRepository(client).getHome({ ...scope, children: [] });
  expect(d.selectedChildId).toBeNull();
  expect(d.latestAssessment).toBeNull();
  expect(calls).toHaveLength(0);
});

it('still shows scores when skill names can’t be read, and surfaces session read failures', async () => {
  const noSkills = createFakeSupabase({ tables, failTables: { skills: pgError('42501', 'permission denied for table skills', 403) } });
  const d = await createSupabaseFamilyHomeRepository(noSkills.client).getHome(scope);
  expect(d.latestAssessment).toMatchObject({ riding: 7, skills: [] });
  const broken = createFakeSupabase({ tables, failTables: { training_sessions: pgError('PGRST301', 'JWT expired', 401) } });
  const e = await createSupabaseFamilyHomeRepository(broken.client).getHome(scope).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ScopedLoadError);
  expect((e as ScopedLoadError).message).toMatch(/session ended/);
});
