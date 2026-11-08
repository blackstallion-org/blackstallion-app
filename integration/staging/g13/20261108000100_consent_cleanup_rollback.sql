-- G13 consent-cleanup rollback: reverses 20261108000100_consent_cleanup.sql

BEGIN;

SELECT cron.unschedule('bsah-consent-cleanup');

DROP TRIGGER IF EXISTS g13_on_consent_withdrawal ON public.consent_records;
DROP FUNCTION IF EXISTS public.g13_nullify_withdrawn_clips();
DROP FUNCTION IF EXISTS app_private.g13_run_consent_cleanup();
DROP TABLE IF EXISTS app_private.consent_cleanup_queue;
DROP TABLE IF EXISTS app_private.consent_cleanup_settings;

COMMIT;
