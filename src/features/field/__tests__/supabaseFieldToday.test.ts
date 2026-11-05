import { ScopedLoadError } from '@/core/data/useScopedResource';
import { createFakeSupabase, pgError } from '@/testing/fakeSupabase';

import { createSupabaseFieldTodayRepository } from '../data/supabaseFieldTodayRepository';

const HUB = 'hub-a';
const opts = { localNow: () => Date.parse('2026-11-04T06:00:00Z'), timeoutMs: 50 }; // 11:30 IST
const tables = {
  school_hubs: [{ id: HUB, school_name: 'Sovereign Hub A' }, { id: 'hub-b', school_name: 'Other' }],
  cadet_check_ins: [
    { id: 'ci-1', cadet_id: 'c1', hub_id: HUB, session_date: '2026-11-04', received_at: '2026-11-04T04:30:00Z', client_operation_id: 'op-1' },
    { id: 'ci-2', cadet_id: 'c2', hub_id: HUB, session_date: '2026-11-04', received_at: '2026-11-04T05:10:00Z', client_operation_id: 'op-2' },
    { id: 'ci-x', cadet_id: 'c9', hub_id: HUB, session_date: '2026-11-03', received_at: '2026-11-03T05:00:00Z', client_operation_id: 'op-x' },
  ],
  cadets: [{ id: 'c1', first_name: 'Aarav', last_name: 'Rao' }, { id: 'c2', first_name: 'Meera', last_name: 'Iyer' }],
  training_sessions: [{ check_in_id: 'ci-1' }],
};
const scope = { subjectId: 'u1', experience: 'field' as const, hubId: HUB, role: 'INSTRUCTOR', displayName: 'Kiran Shah' };

it('lists today’s check-ins at the caller’s hub (hub-local day), newest first, with publish state', async () => {
  const { client, calls } = createFakeSupabase({ tables });
  const d = await createSupabaseFieldTodayRepository(client, opts).getToday(scope);
  expect(d.source).toBe('server');
  expect(d.hubName).toBe('Sovereign Hub A');
  expect(d.dateLabel).toBe('4 Nov 2026');
  expect(d.roleLabel).toBe('Instructor');
  expect(d.staffFirstName).toBe('Kiran');
  expect(d.checkIns).toEqual([
    { checkInId: 'ci-2', checkInOperationId: 'op-2', cadetId: 'c2', cadetName: 'Meera Iyer', time: '10:40', published: false },
    { checkInId: 'ci-1', checkInOperationId: 'op-1', cadetId: 'c1', cadetName: 'Aarav Rao', time: '10:00', published: true },
  ]);
  expect(d.careAvailable).toBe(false); // care is not connected; the screen must not say "no tasks"
  const checkInQuery = calls.find((c) => c.kind === 'from' && c.table === 'cadet_check_ins');
  expect(checkInQuery).toMatchObject({ ops: expect.arrayContaining([['eq', 'hub_id', HUB], ['eq', 'session_date', '2026-11-04']]) });
  // Only named columns are requested (revoked columns make `select *` fail on the live delta).
  for (const c of calls) if (c.kind === 'from') expect(String(c.ops[0]?.[1])).not.toContain('*');
});

it('needs a hub from the server snapshot and refuses other experiences', async () => {
  const { client, calls } = createFakeSupabase({ tables });
  const repo = createSupabaseFieldTodayRepository(client, opts);
  await expect(repo.getToday({ ...scope, hubId: null })).rejects.toMatchObject({ reference: 'NO-HUB' });
  await expect(repo.getToday({ ...scope, experience: 'family' as unknown as 'field' })).rejects.toBeInstanceOf(ScopedLoadError);
  expect(calls).toHaveLength(0);
});

it('turns a server or network failure into a retryable screen error', async () => {
  const { client } = createFakeSupabase({ tables, failTables: { cadet_check_ins: pgError('42501', 'permission denied for table cadet_check_ins', 403) } });
  await expect(createSupabaseFieldTodayRepository(client, opts).getToday(scope)).rejects.toMatchObject({ reference: '42501' });
  const offline = createFakeSupabase({ tables, failTables: { school_hubs: new TypeError('Network request failed') } });
  await expect(createSupabaseFieldTodayRepository(offline.client, opts).getToday(scope)).rejects.toMatchObject({ message: expect.stringMatching(/couldn’t reach/) });
});

it('uses the server clock for "today" and hides publish state from roles that can’t read sessions', async () => {
  const { client, calls } = createFakeSupabase({ tables });
  // Phone thinks it is 3 Nov; the server clock says 4 Nov.
  const repo = createSupabaseFieldTodayRepository(client, {
    localNow: () => Date.parse('2026-11-03T06:00:00Z'),
    clock: { offsetMs: async () => 24 * 3600_000 },
  });
  const d = await repo.getToday({ ...scope, role: 'SCHOOL_ADMIN' });
  expect(d.checkIns?.map((c) => [c.checkInId, c.published])).toEqual([['ci-2', null], ['ci-1', null]]);
  expect(calls.some((c) => c.kind === 'from' && c.table === 'training_sessions')).toBe(false);
});

describe('voided check-ins (G9 field_void_check_in, SD-05 draft)', () => {
  it('a voided check-in is not "checked in today" and offers no Assess', async () => {
    const { client } = createFakeSupabase({ tables: { ...tables, cadet_check_in_voids: [{ check_in_id: 'ci-2' }] } });
    const d = await createSupabaseFieldTodayRepository(client, opts).getToday(scope);
    expect(d.checkIns?.map((c) => c.checkInId)).toEqual(['ci-1']);
  });

  it('without the G9 table nothing can be voided, so the list is unchanged', async () => {
    const { client } = createFakeSupabase({ tables, failTables: { cadet_check_in_voids: pgError('PGRST205', "Could not find the table 'public.cadet_check_in_voids' in the schema cache", 404) } });
    const d = await createSupabaseFieldTodayRepository(client, opts).getToday(scope);
    expect(d.checkIns?.map((c) => c.checkInId)).toEqual(['ci-2', 'ci-1']);
  });

  it('a failed voids read is an error, never "none voided" (no stale Assess for a voided check-in)', async () => {
    const { client } = createFakeSupabase({ tables, failTables: { cadet_check_in_voids: new TypeError('Network request failed') } });
    await expect(createSupabaseFieldTodayRepository(client, opts).getToday(scope)).rejects.toMatchObject({ reference: 'OFFLINE' });
  });
});
