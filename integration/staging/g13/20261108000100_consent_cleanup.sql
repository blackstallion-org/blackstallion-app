-- G13 consent-cleanup migration
-- When a guardian withdraws session_video consent, clip references are nulled immediately and
-- orphan storage objects are physically deleted after the D12 grace period.
--
-- Retention length is decision D12 (UNSIGNED). The default is stored in a settings table so it
-- can be changed without a migration. See: app_private.consent_cleanup_settings.

BEGIN;

-- 1. Settings table: D12 retention grace period (configurable, no migration needed to change)
CREATE TABLE IF NOT EXISTS app_private.consent_cleanup_settings (
  key   TEXT PRIMARY KEY,
  value INTERVAL NOT NULL,
  description TEXT
);
INSERT INTO app_private.consent_cleanup_settings (key, value, description) VALUES
  ('withdrawal_grace_period', INTERVAL '30 days',
   'D12 PROPOSED DEFAULT: time after session_video withdrawal before orphan clips are physically deleted. Decision D12 is unsigned — this default awaits review.')
ON CONFLICT (key) DO NOTHING;

-- 2. Cleanup queue: deferred physical deletion of storage objects
CREATE TABLE IF NOT EXISTS app_private.consent_cleanup_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadet_id     UUID NOT NULL,
  bucket       TEXT NOT NULL DEFAULT 'session-videos',
  object_path  TEXT NOT NULL,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cleanup_queue_pending
  ON app_private.consent_cleanup_queue (delete_after)
  WHERE deleted_at IS NULL;

-- 3. Trigger function: fires on INSERT to consent_records.
--    When the RPC app_set_media_consent records a withdrawal of session_video, this:
--    a) Nulls video_log_s3_url on all training_sessions for that cadet
--    b) Queues the old paths for deferred physical deletion
CREATE OR REPLACE FUNCTION public.g13_nullify_withdrawn_clips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  grace INTERVAL;
BEGIN
  IF NEW.consent_type <> 'MEDIA_SESSION_VIDEO' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_active THEN
    RETURN NEW;
  END IF;

  -- Skip if a newer record already exists (this INSERT is not the latest).
  IF EXISTS (
    SELECT 1 FROM public.consent_records cr
    WHERE cr.cadet_id = NEW.cadet_id
      AND cr.consent_type = 'MEDIA_SESSION_VIDEO'
      AND cr.id <> NEW.id
      AND cr.consented_at > NEW.consented_at
  ) THEN
    RETURN NEW;
  END IF;

  -- Safe on grants too: if no clips exist the statements are no-ops.
  SELECT value INTO grace
  FROM app_private.consent_cleanup_settings
  WHERE key = 'withdrawal_grace_period';
  grace := coalesce(grace, INTERVAL '30 days');

  INSERT INTO app_private.consent_cleanup_queue (cadet_id, bucket, object_path, delete_after)
  SELECT NEW.cadet_id, 'session-videos', ts.video_log_s3_url, now() + grace
  FROM public.training_sessions ts
  WHERE ts.cadet_id = NEW.cadet_id
    AND ts.video_log_s3_url IS NOT NULL;

  UPDATE public.training_sessions
  SET video_log_s3_url = NULL
  WHERE cadet_id = NEW.cadet_id
    AND video_log_s3_url IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS g13_on_consent_withdrawal ON public.consent_records;
CREATE TRIGGER g13_on_consent_withdrawal
  AFTER INSERT ON public.consent_records
  FOR EACH ROW
  EXECUTE FUNCTION public.g13_nullify_withdrawn_clips();

-- 4. Cleanup job function: physically deletes storage objects past the grace period
CREATE OR REPLACE FUNCTION app_private.g13_run_consent_cleanup()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, storage
AS $$
DECLARE
  rec RECORD;
  deleted_count INTEGER := 0;
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  FOR rec IN
    SELECT id, bucket, object_path
    FROM app_private.consent_cleanup_queue
    WHERE delete_after <= now()
      AND deleted_at IS NULL
    ORDER BY queued_at
    FOR UPDATE SKIP LOCKED
  LOOP
    DELETE FROM storage.objects
    WHERE bucket_id = rec.bucket
      AND name = rec.object_path;

    UPDATE app_private.consent_cleanup_queue
    SET deleted_at = now()
    WHERE id = rec.id;

    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$;

-- 5. pg_cron job: daily at 19:20 UTC (adjacent to bsah-cron-history-purge at 18:50)
SELECT cron.schedule(
  'bsah-consent-cleanup',
  '20 19 * * *',
  $$SELECT app_private.g13_run_consent_cleanup()$$
);

COMMIT;
