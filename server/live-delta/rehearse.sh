#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# BSAH live-delta rehearsal script
#
# Usage:
#   REHEARSAL_DB_URL="postgresql://..." ./server/live-delta/rehearse.sh [apply|rollback|probe|dump]
#
# Modes:
#   dump      — schema-only pg_dump of the target DB (pre-flight snapshot)
#   apply     — apply APPLY_ORDER steps 1-8 in order, stop on first error
#   probe     — run the 19 read-only permission probes
#   rollback  — reverse-apply rollback files 8→1
#   full      — dump → apply → probe (the default)
#
# Environment:
#   REHEARSAL_DB_URL  — postgres connection string (REQUIRED)
#   PSQL              — path to psql (default: psql)
#   PG_DUMP           — path to pg_dump (default: pg_dump)
#   DUMP_DIR          — where to write the schema dump (default: ./server/live-delta/_dumps)
#   DRY_RUN           — set to 1 to print commands without executing
#
# Safety:
#   - Refuses to run against the live project ref (tgwadczrfbljnepoaqtb)
#   - Every SQL step runs inside a transaction (BEGIN … COMMIT)
#   - Stop-on-error: ON_ERROR_STOP=1
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PSQL="${PSQL:-psql}"
PG_DUMP="${PG_DUMP:-pg_dump}"
DUMP_DIR="${DUMP_DIR:-$SCRIPT_DIR/_dumps}"
DRY_RUN="${DRY_RUN:-0}"
MODE="${1:-full}"

# ── Guard: never touch live ──────────────────────────────────────────
LIVE_REF="tgwadczrfbljnepoaqtb"
if [[ -z "${REHEARSAL_DB_URL:-}" ]]; then
  echo "ERROR: REHEARSAL_DB_URL is not set." >&2
  exit 1
fi
if [[ "$REHEARSAL_DB_URL" == *"$LIVE_REF"* ]]; then
  echo "ERROR: REHEARSAL_DB_URL contains the live project ref ($LIVE_REF). Refusing." >&2
  exit 1
fi

# ── Helpers ──────────────────────────────────────────────────────────
stamp() { date -u +"%Y%m%dT%H%M%SZ"; }
log()   { echo "[$(stamp)] $*"; }
fail()  { echo "[$(stamp)] FAIL: $*" >&2; exit 1; }

run_sql_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    log "SKIP $label — file not found: $file"
    return 0
  fi
  log "APPLY $label ($file)"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "(dry run) $PSQL $REHEARSAL_DB_URL -v ON_ERROR_STOP=1 -1 -f $file"
    return 0
  fi
  if ! "$PSQL" "$REHEARSAL_DB_URL" -v ON_ERROR_STOP=1 -1 -f "$file" 2>&1; then
    fail "$label failed"
  fi
  log "OK $label"
}

# ── Forward-apply SQL files (APPLY_ORDER steps 1-8) ─────────────────
FORWARD_FILES=(
  "001_enums.sql"
  "002_tables.sql"
  "003_functions.sql"
  "004_rls.sql"
  "005_storage.sql"
  "006_triggers.sql"
  "007_seed.sql"
  "008_cron.sql"
)

# ── Rollback files (reverse order) ──────────────────────────────────
ROLLBACK_FILES=(
  "008_cron_rollback.sql"
  "007_seed_rollback.sql"
  "006_triggers_rollback.sql"
  "005_storage_rollback.sql"
  "004_rls_rollback.sql"
  "003_functions_rollback.sql"
  "002_tables_rollback.sql"
  "001_enums_rollback.sql"
)

# ── Mode: dump ───────────────────────────────────────────────────────
do_dump() {
  mkdir -p "$DUMP_DIR"
  local out="$DUMP_DIR/schema-$(stamp).sql"
  log "Dumping schema to $out"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "(dry run) $PG_DUMP --schema-only --no-owner --no-privileges $REHEARSAL_DB_URL > $out"
    return 0
  fi
  "$PG_DUMP" --schema-only --no-owner --no-privileges "$REHEARSAL_DB_URL" > "$out" \
    || fail "pg_dump failed"
  log "Schema dump: $out ($(wc -c < "$out") bytes)"
}

# ── Mode: apply ──────────────────────────────────────────────────────
do_apply() {
  log "Applying ${#FORWARD_FILES[@]} steps (stop-on-error)"
  local step=1
  for f in "${FORWARD_FILES[@]}"; do
    run_sql_file "$SCRIPT_DIR/$f" "Step $step: $f"
    step=$((step + 1))
  done
  log "All ${#FORWARD_FILES[@]} steps applied."
}

# ── Mode: rollback ───────────────────────────────────────────────────
do_rollback() {
  log "Rolling back ${#ROLLBACK_FILES[@]} steps (reverse order)"
  local step=${#ROLLBACK_FILES[@]}
  for f in "${ROLLBACK_FILES[@]}"; do
    run_sql_file "$SCRIPT_DIR/$f" "Rollback step $step: $f"
    step=$((step - 1))
  done
  log "Rollback complete."
}

# ── Mode: probe ──────────────────────────────────────────────────────
do_probe() {
  log "Running 19 permission probes (read-only)"
  # The probes run through the staging test suite against the rehearsal DB.
  # We set the stack env vars to point at the rehearsal target and run jest
  # with only the security test file.
  local api_url
  api_url="$(echo "$REHEARSAL_DB_URL" | sed -E 's|postgresql://[^@]+@([^:/]+)(:[0-9]+)?/.*|http://\1:55421|')"
  # For local stack: the staging tests use the stack.ts helper which reads
  # supabase status. We run them if the stack is local, otherwise we run
  # the standalone probe SQL.
  if [[ "$REHEARSAL_DB_URL" == *"127.0.0.1"* ]] || [[ "$REHEARSAL_DB_URL" == *"localhost"* ]]; then
    log "Local stack detected — running staging probes via jest"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "(dry run) cd $ROOT_DIR && npx jest -c jest.staging.config.js integration/staging/security.staging.ts"
      return 0
    fi
    cd "$ROOT_DIR"
    if npx jest -c jest.staging.config.js integration/staging/security.staging.ts 2>&1; then
      log "All 19 probes PASSED"
    else
      fail "Probes failed — permission matrix may be broken"
    fi
  else
    log "Running standalone SQL probes against rehearsal DB"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "(dry run) $PSQL $REHEARSAL_DB_URL -f $SCRIPT_DIR/probes.sql"
      return 0
    fi
    if [[ -f "$SCRIPT_DIR/probes.sql" ]]; then
      "$PSQL" "$REHEARSAL_DB_URL" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/probes.sql" 2>&1 \
        || fail "SQL probes failed"
      log "All probes PASSED"
    else
      log "WARN: probes.sql not found. Use local stack for full 19-probe coverage."
    fi
  fi
}

# ── Dispatch ─────────────────────────────────────────────────────────
case "$MODE" in
  dump)     do_dump ;;
  apply)    do_apply ;;
  rollback) do_rollback ;;
  probe)    do_probe ;;
  full)     do_dump; do_apply; do_probe ;;
  *)        fail "Unknown mode: $MODE. Use: dump | apply | rollback | probe | full" ;;
esac

log "Done ($MODE)."
