# Live-delta runbook (owner's copy)

One page. Read before you start; each heading is one step.

---

## 1. Back up the live database

1. Open **Supabase Dashboard → your project → Database → Backups**.
2. Click **Create a backup** (or confirm the daily automatic backup ran today).
3. Wait for the backup to show status **Completed**. Note the timestamp.
4. *Optional but recommended*: download the backup locally via **Download**.

> If anything goes wrong below, you restore from this backup. That is your
> undo button for every step that follows.

## 2. Take a schema-only dump (for comparison)

On your machine (not in the app's CI):

```bash
REHEARSAL_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  ./server/live-delta/rehearse.sh dump
```

This writes a timestamped `.sql` file to `server/live-delta/_dumps/`.
Keep it — you will diff it against the post-apply dump.

## 3. Enable pg_cron (one-time, if not already on)

1. **Dashboard → Database → Extensions**.
2. Search for **pg_cron**.
3. Click **Enable**. Schema: `extensions` (the default).
4. Wait for the green "Enabled" badge.

## 4. Confirm Exposed Schemas

1. **Dashboard → Settings → API → Exposed schemas**.
2. Confirm `public` is listed. It is by default; just verify.

## 5. Run the rehearsal against the LOCAL stack first

```bash
# Start the local Supabase stack (backend-local/)
cd backend-local && supabase start && bash load_staging.sh && cd ..

# Full rehearsal: dump → apply → 19 probes
REHEARSAL_DB_URL="postgresql://supabase_admin:postgres@127.0.0.1:55422/postgres" \
  ./server/live-delta/rehearse.sh full
```

All 19 probes must pass. If any fail: fix, rollback, re-apply, re-probe.

```bash
# Rollback (if needed)
REHEARSAL_DB_URL="postgresql://supabase_admin:postgres@127.0.0.1:55422/postgres" \
  ./server/live-delta/rehearse.sh rollback
```

## 6. Apply to live

Once the local rehearsal passes and you are ready:

```bash
REHEARSAL_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  ./server/live-delta/rehearse.sh apply
```

The script stops on the first error. If it stops:

1. Read the error.
2. Fix the SQL file.
3. **Do not re-run the full apply** — run only the failed step and those after it.
4. Or: rollback everything and start over (step 5).

## 7. Run probes against live

```bash
REHEARSAL_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  ./server/live-delta/rehearse.sh probe
```

All 19 must pass. If any fail, rollback immediately:

```bash
REHEARSAL_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  ./server/live-delta/rehearse.sh rollback
```

Then investigate on local.

## 8. Confirm Storage bucket

1. **Dashboard → Storage**.
2. Confirm `session-videos` bucket exists and is **not public** (no globe icon).

## 9. Confirm pg_cron jobs

1. **Dashboard → Database → Extensions → pg_cron**.
2. Or run: `SELECT * FROM cron.job;`
3. You should see two jobs:
   - `purge_expired_signed_urls` — daily
   - `cascade_completed_deletions` — weekly

## 10. Post-apply schema dump (diff)

```bash
REHEARSAL_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  ./server/live-delta/rehearse.sh dump
```

Diff the before/after dumps to verify only the expected objects were created:

```bash
diff server/live-delta/_dumps/schema-BEFORE.sql server/live-delta/_dumps/schema-AFTER.sql
```

---

## If things go wrong

| Situation | Action |
|---|---|
| Apply stopped mid-way | Fix and resume from the failed step, or rollback all |
| Probes fail after apply | Rollback immediately, investigate on local |
| Need to undo everything | Rollback script, or restore the backup from step 1 |
| Rollback script fails | Restore the backup from step 1 (your nuclear option) |

**The backup from step 1 is always your safety net.**
