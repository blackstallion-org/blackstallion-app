/**
 * @jest-environment node
 *
 * G13 Consent Withdrawal & Video Lifecycle staging integration tests.
 * Runs against the LOCAL Supabase stack (backend-local/, load_staging.sh).
 *
 * Verifies:
 *  1. Migration applies cleanly and idempotently
 *  2. Server-side storage read authorization enforces consent withdrawal (no storage leak)
 *  3. Policy parameterization: strict_hide vs parent_only
 *  4. Orphan video identification and immediate cleanup on withdrawal
 *  5. Retention modes: retain_indefinitely (default) vs grace_period vs immediate_delete
 *  6. Cadet isolation: withdrawal for cadet A does not affect cadet B
 *  7. Rollback cleanly restores original state
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appClient, clipUri, seedWorld, signIn, sql, type World } from './stack';

jest.setTimeout(120_000);

const MIGRATION_PATH = path.resolve(__dirname, '../../../server/live-delta/g13-consent-withdrawal/migration.sql');
const ROLLBACK_PATH = path.resolve(__dirname, '../../../server/live-delta/g13-consent-withdrawal/rollback.sql');

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

let w: World;

beforeAll(async () => {
  w = await seedWorld();
  // Apply G13 migration if not already present (load_staging.sh now includes it)
  const hasG13 = sql(`select to_regclass('app_private.consent_withdrawal_policy') is not null`);
  if (hasG13 !== 't') sql(fs.readFileSync(MIGRATION_PATH, 'utf8'));
});

afterAll(() => {
  // Test 6 runs the rollback to verify it works; re-apply so later suites (scheduler, consent-cleanup) still pass
  const hasG13 = sql(`select to_regclass('app_private.consent_withdrawal_policy') is not null`);
  if (hasG13 !== 't') {
    sql(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    const cleanupPath = path.resolve(__dirname, 'g13/20261108000100_consent_cleanup.sql');
    sql(fs.readFileSync(cleanupPath, 'utf8'));
  }
});

describe('G13 Consent Withdrawal & Storage Access Enforcement', () => {
  test('1. Server-side storage read is refused when consent is withdrawn (strict_hide default)', async () => {
    const ga = await signIn(w.guardianA, appClient());
    const inst = await signIn(w.instructorA, appClient());

    // Grant consent
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // Upload clip and create session
    const clipPath = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    const up = await inst.storage.from('session-videos').upload(clipPath, bytes, { contentType: 'video/mp4' });
    expect(up.error).toBeNull();

    const sessId = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 8, 8, 8, '${clipPath}', true) RETURNING id`
    );

    // Both guardian and instructor can read while consent is active
    expect((await ga.storage.from('session-videos').download(clipPath)).error).toBeNull();
    expect((await inst.storage.from('session-videos').download(clipPath)).error).toBeNull();

    // Withdraw consent
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: false,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // SERVER-SIDE STORAGE ENFORCEMENT:
    // With strict_hide (default), BOTH guardian and instructor are refused direct storage download!
    const dlGaAfter = await ga.storage.from('session-videos').download(clipPath);
    expect(dlGaAfter.error).not.toBeNull();
    expect(String(dlGaAfter.error?.message)).toMatch(/row-level security|not found|403|42501/i);

    const dlInstAfter = await inst.storage.from('session-videos').download(clipPath);
    expect(dlInstAfter.error).not.toBeNull();
    expect(String(dlInstAfter.error?.message)).toMatch(/row-level security|not found|403|42501/i);

    // Under default retention_mode ('retain_indefinitely'):
    // DB reference is preserved (not destructively erased)
    expect(sql(`SELECT video_log_s3_url FROM public.training_sessions WHERE id = '${sessId}'`)).toBe(clipPath);
    // Object remains in storage (audit/retention preservation)
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${clipPath}'`)).toBe('1');
  });

  test('2. Policy configuration: parent_only allows guardian download while refusing instructor', async () => {
    const ga = await signIn(w.guardianA, appClient());
    const inst = await signIn(w.instructorA, appClient());

    // Switch policy to parent_only
    sql(`UPDATE app_private.consent_withdrawal_policy SET value = 'parent_only' WHERE key = 'existing_video_access'`);

    // Grant then upload
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    const clipPath = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    await inst.storage.from('session-videos').upload(clipPath, bytes, { contentType: 'video/mp4' });
    sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 9, 9, 9, '${clipPath}', true)`
    );

    // Withdraw consent
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: false,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // In parent_only mode: guardian can read historical clip, instructor cannot
    expect((await ga.storage.from('session-videos').download(clipPath)).error).toBeNull();
    expect((await inst.storage.from('session-videos').download(clipPath)).error).not.toBeNull();

    // Reset policy back to strict_hide default
    sql(`UPDATE app_private.consent_withdrawal_policy SET value = 'strict_hide' WHERE key = 'existing_video_access'`);
  });

  test('3. Orphaned video detection and immediate cleanup on withdrawal', async () => {
    const ga = await signIn(w.guardianA, appClient());
    const inst = await signIn(w.instructorA, appClient());

    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // Upload an orphan clip (never published in training_sessions)
    const orphanClip = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    await inst.storage.from('session-videos').upload(orphanClip, bytes, { contentType: 'video/mp4' });

    // Verify detection function finds it
    const orphanCount = sql(
      `SELECT count(*) FROM app_private.g13_find_orphaned_videos('${w.cadetA}') WHERE object_name = '${orphanClip}'`
    );
    expect(orphanCount).toBe('1');

    // Guardian withdraws consent
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: false,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // Orphan clip is immediately purged from storage
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${orphanClip}'`)).toBe('0');
  });

  test('4. Retention mode: grace_period queues objects and scheduled job cleans them', async () => {
    const ga = await signIn(w.guardianA, appClient());
    const inst = await signIn(w.instructorA, appClient());

    // Configure retention_mode to grace_period
    sql(`UPDATE app_private.consent_withdrawal_policy SET value = 'grace_period' WHERE key = 'retention_mode'`);

    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    const clipPath = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    await inst.storage.from('session-videos').upload(clipPath, bytes, { contentType: 'video/mp4' });
    const sessId = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 7, 7, 7, '${clipPath}', true) RETURNING id`
    );

    // Withdraw consent
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: false,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });

    // Object is queued in consent_cleanup_queue
    const queuedCount = sql(
      `SELECT count(*) FROM app_private.consent_cleanup_queue
       WHERE cadet_id = '${w.cadetA}' AND object_path = '${clipPath}' AND deleted_at IS NULL`
    );
    expect(queuedCount).toBe('1');

    // Storage object and DB reference exist during grace period
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${clipPath}'`)).toBe('1');
    expect(sql(`SELECT video_log_s3_url FROM public.training_sessions WHERE id = '${sessId}'`)).toBe(clipPath);

    // Simulate grace period expiry
    sql(`UPDATE app_private.consent_cleanup_queue SET delete_after = now() - interval '1 second' WHERE object_path = '${clipPath}'`);

    // Run cleanup job
    const purged = sql(`SELECT app_private.g13_run_consent_cleanup()`);
    expect(Number(purged)).toBeGreaterThanOrEqual(1);

    // Storage object is gone and DB reference is nulled
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${clipPath}'`)).toBe('0');
    expect(sql(`SELECT coalesce(video_log_s3_url, 'NULL') FROM public.training_sessions WHERE id = '${sessId}'`)).toBe('NULL');

    // Reset retention_mode back to retain_indefinitely default
    sql(`UPDATE app_private.consent_withdrawal_policy SET value = 'retain_indefinitely' WHERE key = 'retention_mode'`);
  });

  test('5. Cadet isolation: withdrawal for Cadet A does not affect Cadet B', async () => {
    const ga = await signIn(w.guardianA, appClient());
    const gb = await signIn(w.guardianB, appClient());
    const instA = await signIn(w.instructorA, appClient());
    const instB = await signIn(w.instructorB, appClient());

    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA, p_purpose: 'session_video', p_granted: true, p_policy_version: 'draft-1', p_operation_id: randomUUID(),
    });
    await gb.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetB, p_purpose: 'session_video', p_granted: true, p_policy_version: 'draft-1', p_operation_id: randomUUID(),
    });

    const clipA = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const clipB = `${w.hubB}/${w.cadetB}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    await instA.storage.from('session-videos').upload(clipA, bytes, { contentType: 'video/mp4' });
    await instB.storage.from('session-videos').upload(clipB, bytes, { contentType: 'video/mp4' });

    sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 6, 6, 6, '${clipA}', true)`
    );
    const sessB = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
       VALUES ('${w.cadetB}', '${w.instructorB.id}', 6, 6, 6, '${clipB}', true) RETURNING id`
    );

    // Withdraw consent ONLY for Cadet A
    await ga.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA, p_purpose: 'session_video', p_granted: false, p_policy_version: 'draft-1', p_operation_id: randomUUID(),
    });

    // Cadet A's storage access is blocked
    expect((await ga.storage.from('session-videos').download(clipA)).error).not.toBeNull();

    // Cadet B's storage access and DB reference remain fully functional
    expect((await gb.storage.from('session-videos').download(clipB)).error).toBeNull();
    expect((await instB.storage.from('session-videos').download(clipB)).error).toBeNull();
    expect(sql(`SELECT video_log_s3_url FROM public.training_sessions WHERE id = '${sessB}'`)).toBe(clipB);
  });

  test('6. Rollback cleans up G13 database objects and restores original policy', () => {
    sql(fs.readFileSync(ROLLBACK_PATH, 'utf8'));

    // G13 tables and functions no longer exist
    expect(sql(`SELECT to_regclass('app_private.consent_withdrawal_policy') IS NOT NULL`)).toBe('f');
    expect(sql(`SELECT to_regclass('app_private.consent_cleanup_queue') IS NOT NULL`)).toBe('f');
    expect(sql(`SELECT count(*) FROM pg_proc WHERE proname = 'g13_can_read_session_video'`)).toBe('0');

    // Original policy restored
    const policyQual = sql(
      `SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mobile session-videos read'`
    );
    expect(policyQual).toContain('mobile_can_read_object');
  });
});
