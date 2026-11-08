/**
 * @jest-environment node
 *
 * G12 care scheduler on staging: pg_cron jobs exist with the agreed schedules, and running the daily job's command
 * produces the next days' care tasks for the assigned groom (seen through the app's own care repository).
 */
import { createSupabaseAccessAdapter } from '@/core/auth/supabase/supabaseAccessAdapter';
import { createServerRepositories } from '@/shell/serverRepositories';

import { seedScreens } from './seedScreens';
import { appClient, seedWorld, signIn, sql } from './stack';

jest.setTimeout(60_000);

test('pg_cron jobs are scheduled: daily generation 00:05 IST, overdue check every 5 minutes', () => {
  expect(sql(`select string_agg(jobname || '=' || schedule, ';' order by jobname) from cron.job where jobname like 'bsah-care-%'`)).toBe(
    'bsah-care-generate=35 18 * * *;bsah-care-overdue=*/5 * * * *',
  );
  expect(sql(`select schedule from cron.job where jobname = 'bsah-cron-history-purge'`)).toBe('50 18 * * *');
  expect(sql(`select count(*) from cron.job where jobname like 'bsah-%'`)).toBe('4'
  );
});

test('the daily job command creates the day-after-tomorrow tasks the groom then sees', async () => {
  const sw = await seedScreens(await seedWorld());
  const hubToday = sql(`select (now() at time zone field.hub_tz('${sw.hubA}'))::date`);
  const plus2 = sql(`select ('${hubToday}'::date + 2)::text`);
  expect(sql(`select count(*) from field.care_task_occurrences where hub_id = '${sw.hubA}' and local_date = '${plus2}'`)).toBe('0');
  sql(`select field.cron_generate_all()`);
  const n = Number(sql(`select count(*) from field.care_task_occurrences where hub_id = '${sw.hubA}' and local_date = '${plus2}'`));
  expect(n).toBeGreaterThan(0);
  sql(`select field.cron_generate_all()`); // idempotent: a second run adds nothing
  expect(Number(sql(`select count(*) from field.care_task_occurrences where hub_id = '${sw.hubA}' and local_date = '${plus2}'`))).toBe(n);
  const client = await signIn(sw.groomA, appClient());
  const snap = (await createSupabaseAccessAdapter(client).load()) as { subjectId: string; scope: { hubId: string; role: string } };
  const repos = createServerRepositories(client as never);
  const tl = await repos.fieldOps!.care.timeline({ subjectId: snap.subjectId, experience: 'field', hubId: snap.scope.hubId, role: snap.scope.role }, plus2, plus2);
  if (tl.kind !== 'ok') throw new Error(`timeline ${tl.kind}`);
  expect(tl.occurrences.length).toBe(n);
});
