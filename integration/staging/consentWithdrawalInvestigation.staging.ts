/**
 * @jest-environment node
 *
 * EMPIRICAL INVESTIGATION: Current behavior when a parent withdraws session_video consent.
 * Probing what happens to existing sessions, storage objects, orphaned videos, and client repos.
 */
import { randomUUID } from 'node:crypto';
import { appClient, clipUri, seedWorld, signIn, sql, type World } from './stack';
import { placeObject } from './seedScreens';

jest.setTimeout(120_000);

let w: World;

beforeAll(async () => {
  w = await seedWorld();
});

// Pre-G13 investigation: probes behavior WITHOUT the consent-withdrawal migration.
// Skipped when G13 is applied to staging (which it now is via load_staging.sh).
const g13 = () => { try { return sql(`select to_regclass('app_private.consent_withdrawal_policy') is not null`) === 't'; } catch { return false; } };
const describeUnlessG13 = g13() ? describe.skip : describe;

describeUnlessG13('Consent withdrawal current behavior investigation', () => {
  test('empirical probe of current behavior on consent withdrawal', async () => {
    const gaClient = await signIn(w.guardianA, appClient());
    const instClient = await signIn(w.instructorA, appClient());

    // 1. Grant initial consent
    const grantRes = await gaClient.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });
    expect(grantRes.error).toBeNull();

    // 2. Upload two clips: one to be published in a session, one orphaned (never published)
    const clipPublished = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const clipOrphan = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');

    // Instructor uploads both
    const up1 = await instClient.storage.from('session-videos').upload(clipPublished, bytes, { contentType: 'video/mp4' });
    expect(up1.error).toBeNull();
    const up2 = await instClient.storage.from('session-videos').upload(clipOrphan, bytes, { contentType: 'video/mp4' });
    expect(up2.error).toBeNull();

    // 3. Publish a training session referencing clipPublished
    const sessId = sql(
      `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
       VALUES ('${w.cadetA}', '${w.instructorA.id}', 8, 8, 8, '${clipPublished}', true) RETURNING id`
    );

    // Verify initial state: both clips exist in storage
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${clipPublished}'`)).toBe('1');
    expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${clipOrphan}'`)).toBe('1');

    // Verify initial storage download works for Guardian
    const dlBeforeWithdrawGa = await gaClient.storage.from('session-videos').download(clipPublished);
    expect(dlBeforeWithdrawGa.error).toBeNull();

    // Verify initial storage download works for Instructor
    const dlBeforeWithdrawInst = await instClient.storage.from('session-videos').download(clipPublished);
    expect(dlBeforeWithdrawInst.error).toBeNull();

    // =========================================================================
    // 4. NOW GUARDIAN WITHDRAWS CONSENT
    // =========================================================================
    const withdrawRes = await gaClient.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetA,
      p_purpose: 'session_video',
      p_granted: false,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });
    expect(withdrawRes.error).toBeNull();

    // FINDING 1: What happens to training_sessions row?
    // video_log_s3_url is NOT nulled or modified
    const currentVideoRef = sql(`SELECT video_log_s3_url FROM public.training_sessions WHERE id = '${sessId}'`);
    expect(currentVideoRef).toBe(clipPublished);

    // FINDING 2: Can guardian still read the training_sessions row via PostgREST?
    const sessReadGa = await gaClient.from('training_sessions').select('id, video_log_s3_url').eq('id', sessId).single();
    expect(sessReadGa.error).toBeNull();
    expect(sessReadGa.data?.video_log_s3_url).toBe(clipPublished);

    // FINDING 3: Can guardian still download the existing video directly from Storage?
    // mobile_can_read_object does NOT check consent!
    const dlAfterWithdrawGa = await gaClient.storage.from('session-videos').download(clipPublished);
    const guardianCanStillDownload = dlAfterWithdrawGa.error === null;

    // FINDING 4: Can instructor still download the existing video directly from Storage?
    const dlAfterWithdrawInst = await instClient.storage.from('session-videos').download(clipPublished);
    const instructorCanStillDownload = dlAfterWithdrawInst.error === null;

    // FINDING 5: What happens to the orphan video?
    // It remains in storage.objects!
    const orphanCount = sql(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'session-videos' AND name = '${clipOrphan}'`);
    expect(orphanCount).toBe('1');

    // FINDING 6: Can guardian or instructor download the orphan video?
    const dlOrphanGa = await gaClient.storage.from('session-videos').download(clipOrphan);
    const dlOrphanInst = await instClient.storage.from('session-videos').download(clipOrphan);
    const orphanDownloadableByGa = dlOrphanGa.error === null;
    const orphanDownloadableByInst = dlOrphanInst.error === null;

    // FINDING 7: Can a new session be published using the orphan video?
    // G10 trigger blocks it!
    let triggerBlocked = false;
    try {
      sql(
        `INSERT INTO public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score, video_log_s3_url, brass_stamp_verified)
         VALUES ('${w.cadetA}', '${w.instructorA.id}', 7, 7, 7, '${clipOrphan}', true)`
      );
    } catch (e: any) {
      triggerBlocked = String(e?.stderr ?? e?.message ?? e).includes('session video consent is not allowed for this cadet');
    }
    expect(triggerBlocked).toBe(true);

    // FINDING 8: Can a new video be uploaded after withdrawal?
    // G10 restrictive INSERT policy blocks it!
    const newClipPath = `${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`;
    const upAfterWithdraw = await instClient.storage.from('session-videos').upload(newClipPath, bytes, { contentType: 'video/mp4' });
    const newUploadBlocked = upAfterWithdraw.error !== null;
    expect(newUploadBlocked).toBe(true);

    // Output all empirical findings for reporting:
    console.log('EMPIRICAL PROBE RESULTS:', {
      currentVideoRefStillInDb: currentVideoRef === clipPublished,
      guardianPostgrestStillReturnsVideoRef: sessReadGa.data?.video_log_s3_url === clipPublished,
      guardianCanStillDownloadDirectFromStorage: guardianCanStillDownload,
      instructorCanStillDownloadDirectFromStorage: instructorCanStillDownload,
      orphanVideoRemainsInStorage: orphanCount === '1',
      orphanDownloadableByGuardian: orphanDownloadableByGa,
      orphanDownloadableByInstructor: orphanDownloadableByInst,
      publishingOrphanBlockedByG10Trigger: triggerBlocked,
      uploadingNewClipBlockedByG10StoragePolicy: newUploadBlocked,
    });
  });
});
