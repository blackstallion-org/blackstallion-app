/**
 * @jest-environment node
 *
 * G13 consent-cleanup on staging: when a guardian withdraws session_video consent, clip references
 * are nulled immediately and orphan storage objects are physically deleted after the D12 grace period.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appClient, clipUri, seedWorld, signIn, sql, type World } from './stack';
import { placeObject } from './seedScreens';

jest.setTimeout(120_000);

const MIGRATION = path.resolve(__dirname, 'g13/20261108000100_consent_cleanup.sql');
const ROLLBACK = path.resolve(__dirname, 'g13/20261108000100_consent_cleanup_rollback.sql');
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

let w: World;

beforeAll(async () => {
  w = await seedWorld();
  // Apply G13 cleanup migration if not already present
  const hasCleanup = sql(`select to_regclass('app_private.consent_cleanup_queue') is not null`);
  if (hasCleanup !== 't') sql(fs.readFileSync(MIGRATION, 'utf8'));
});

describe('g13 consent-cleanup', () => {
  test('grant → upload → withdraw → references nulled → objects cleaned after grace', async () => {
    const g = await signIn(w.guardianA, appClient());

    // 1. Grant session_video consent
    await g.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // 2. Instructor uploads a clip via trusted path (placeObject uses service role)
    const clipPath = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    await placeObject('session-videos', clipPath, bytes, 'video/mp4');

    // 3. Create a training_session referencing the clip
    const sessionId = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 7, 7, 7, ${lit(clipPath)})
       RETURNING id`,
    );

    // 4. Verify the clip reference exists
    expect(sql(`SELECT video_log_s3_url FROM public.training_sessions WHERE id = '${sessionId}'`)).toBe(clipPath);

    // 5. Verify the storage object exists
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = ${lit(clipPath)}`)).toBe('1');

    // 6. Guardian withdraws consent
    await g.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: false,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // 7. Assert: video_log_s3_url is NULL (trigger fired immediately)
    expect(sql(`SELECT coalesce(video_log_s3_url, 'NULL') FROM public.training_sessions WHERE id = '${sessionId}'`)).toBe('NULL');

    // 8. Assert: cleanup queue has the clip path
    const queued = sql(
      `SELECT count(*) FROM app_private.consent_cleanup_queue
       WHERE cadet_id = '${w.cadetA}' AND object_path = ${lit(clipPath)} AND deleted_at IS NULL`,
    );
    expect(queued).toBe('1');

    // 9. Storage object still exists (grace period not expired)
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = ${lit(clipPath)}`)).toBe('1');

    // 10. Simulate grace period expiry
    sql(`UPDATE app_private.consent_cleanup_queue SET delete_after = now() - interval '1 second' WHERE cadet_id = '${w.cadetA}' AND object_path = ${lit(clipPath)}`);

    // 11. Run the cleanup job manually
    const cleaned = sql(`SELECT app_private.g13_run_consent_cleanup()`);
    expect(Number(cleaned)).toBeGreaterThanOrEqual(1);

    // 12. Storage object is gone
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = ${lit(clipPath)}`)).toBe('0');

    // 13. Queue row marked as deleted
    expect(sql(
      `SELECT count(*) FROM app_private.consent_cleanup_queue
       WHERE cadet_id = '${w.cadetA}' AND object_path = ${lit(clipPath)} AND deleted_at IS NOT NULL`,
    )).toBe('1');
  });

  test('withdrawal for one child does not affect another', async () => {
    const ga = await signIn(w.guardianA, appClient());
    const gb = await signIn(w.guardianB, appClient());

    // Grant consent for both cadets
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA, p_purpose: 'session_video', p_granted: true, p_policy_version: 'draft-1', p_operation_id: randomUUID(),
    });
    await gb.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetB, p_purpose: 'session_video', p_granted: true, p_policy_version: 'draft-1', p_operation_id: randomUUID(),
    });

    // Upload clips for both
    const clipA = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const clipB = `${w.hubB}/${w.cadetB}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    await placeObject('session-videos', clipA, bytes, 'video/mp4');
    await placeObject('session-videos', clipB, bytes, 'video/mp4');

    const sessA = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 6, 6, 6, ${lit(clipA)}) RETURNING id`,
    );
    const sessB = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url)
       VALUES ('${w.cadetB}', '${w.instructorB.id}', 6, 6, 6, ${lit(clipB)}) RETURNING id`,
    );

    // Withdraw only cadet A's consent
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA, p_purpose: 'session_video', p_granted: false, p_policy_version: 'draft-1', p_operation_id: randomUUID(),
    });

    // Cadet A's clip reference is nulled
    expect(sql(`SELECT coalesce(video_log_s3_url, 'NULL') FROM public.training_sessions WHERE id = '${sessA}'`)).toBe('NULL');

    // Cadet B's clip reference is intact
    expect(sql(`SELECT video_log_s3_url FROM public.training_sessions WHERE id = '${sessB}'`)).toBe(clipB);

    // Cadet B's storage object is intact
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = ${lit(clipB)}`)).toBe('1');
  });

  test('pg_cron job bsah-consent-cleanup is scheduled', () => {
    expect(sql(`SELECT count(*) FROM cron.job WHERE jobname = 'bsah-consent-cleanup'`)).toBe('1');
    expect(sql(`SELECT schedule FROM cron.job WHERE jobname = 'bsah-consent-cleanup'`)).toBe('20 19 * * *');
  });
});
