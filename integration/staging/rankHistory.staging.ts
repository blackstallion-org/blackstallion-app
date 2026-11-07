/**
 * @jest-environment node
 *
 * G11 rank history reads: the child's guardian and hub staff see the safe columns; other families, grooms and the
 * signed-out key see nothing; the approver's reason and staff ids never reach a client.
 */
import { seedWorld, signIn, sql, appClient, type World } from './stack';

jest.setTimeout(60_000);
let w: World;
let hist = '';
beforeAll(async () => {
  w = await seedWorld();
  sql(`update public.cadets set current_rank = 'CADET_RIDER' where id = '${w.cadetA}'`); // trusted promotion → history row
  hist = sql(`select id from public.rank_history where cadet_id = '${w.cadetA}' order by promoted_at desc limit 1`);
});

test('guardian A reads own child’s rank history (safe columns)', async () => {
  const r = await (await signIn(w.guardianA)).from('rank_history').select('id, from_rank, to_rank, promoted_at').eq('cadet_id', w.cadetA);
  expect(r.error).toBeNull();
  expect(r.data?.map((x) => x.id)).toEqual([hist]);
  expect(r.data?.[0]?.to_rank).toBe('CADET_RIDER');
});

test('hub A instructor reads it too', async () => {
  const r = await (await signIn(w.instructorA)).from('rank_history').select('id').eq('cadet_id', w.cadetA);
  expect(r.data?.map((x) => x.id)).toEqual([hist]);
});

test('other family, other hub, groom and signed-out see no rows (the row exists)', async () => {
  expect(sql(`select count(*) from public.rank_history where id = '${hist}'`)).toBe('1');
  for (const a of [w.guardianB, w.instructorB, w.groomA]) {
    const r = await (await signIn(a)).from('rank_history').select('id').eq('cadet_id', w.cadetA);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([]);
  }
  const anon = await appClient().from('rank_history').select('id').eq('cadet_id', w.cadetA);
  expect(anon.data ?? []).toEqual([]);
});

test('the approver’s reason and staff ids are not readable by a guardian', async () => {
  const g = await signIn(w.guardianA);
  for (const col of ['reason', 'promoted_by', '*']) {
    const r = await g.from('rank_history').select(col).eq('cadet_id', w.cadetA);
    expect(r.error?.code).toBe('42501');
  }
});
