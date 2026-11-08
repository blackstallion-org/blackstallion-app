# Live-delta apply order

Steps below are applied in numbered order. Each step is a SQL file in
`server/live-delta/` (or a named Supabase dashboard action). The rehearsal
script (`rehearse.sh`) applies them automatically and stops on the first
failure.

## Pre-flight

| # | File / action | What it does |
|---|---|---|
| 0 | **dashboard** | Enable the `pg_cron` extension (Database → Extensions → pg_cron → Enable). |

## Schema & data

| # | File | What it does | Rollback |
|---|---|---|---|
| 1 | `001_enums.sql` | Creates `user_role`, `consent_purpose`, `consent_state`, `rank_name`, `care_log_type`, `achievement_type`, `deletion_status` enums. | `001_enums_rollback.sql` |
| 2 | `002_tables.sql` | Creates `school_hubs`, `equine_fleet`, `users` (extends auth.users), `cadets`, `skills`, `training_sessions`, `session_skills`, `session_corrections`, `rank_history`, `achievements`, `consent_records`, `consent_purposes`, `groom_daily_logs`, `staff_attendance`, `deletion_requests`, `operation_log`. | `002_tables_rollback.sql` |
| 3 | `003_functions.sql` | Creates `app_access_snapshot`, `app_set_media_consent`, `field_record_check_in`, `field_punch_in`, `field_correct_session`, `field_publish_session`, `app_request_deletion`. | `003_functions_rollback.sql` |
| 4 | `004_rls.sql` | Enables RLS on every public table and creates the policies (permission matrix 07). | `004_rls_rollback.sql` |
| 5 | `005_storage.sql` | Creates the `session-videos` bucket with RLS policies: instructors upload to `hubId/cadetId/*` only for consented cadets in their hub; guardians download their own child's clips via signed URLs. | `005_storage_rollback.sql` |
| 6 | `006_triggers.sql` | `rank_history` auto-insert trigger on `cadets.current_rank` change; `brass_stamp_verified` protection trigger; `operation_log` idempotency trigger. | `006_triggers_rollback.sql` |
| 7 | `007_seed.sql` | Seeds `consent_purposes` (session_video, training_media — D09 list) with initial policy versions. No user data. | `007_seed_rollback.sql` |
| 8 | `008_cron.sql` | `pg_cron` jobs: purge expired signed URLs (daily), cascade completed deletion requests after retention period (weekly — D12). | `008_cron_rollback.sql` |

## Post-apply

| # | Action | What it does |
|---|---|---|
| 9 | **dashboard** | Expose schemas: Settings → API → Exposed schemas → confirm `public` is listed (default). |
| 10 | **dashboard** | Confirm Storage bucket `session-videos` is private (not public). |

## Rollback

Roll back in **reverse order** (8 → 1). Each rollback file drops only what
its forward file created, using `IF EXISTS` / `CASCADE` where safe. The
rollback files are idempotent.

## Probes

After a successful apply, `rehearse.sh` runs the 19 read-only probes from
`integration/staging/security.staging.ts` (adapted for the target DB) to
confirm the permission matrix holds. All 19 must pass before the apply is
considered successful.
