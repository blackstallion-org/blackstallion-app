# Security Audit — G15 Hardening

**Date**: 2026-11-08
**Scope**: blackstallion-app (Expo/React Native) + Supabase backend (via staging harness)
**Branch**: `claude/vibrant-pasteur-dazdke`
**Method**: Staging test probes against local Supabase at `127.0.0.1:55421/55422`

---

## Summary

| Category | Probes | Status |
|---|---|---|
| Original probes (S3, S7, W1–W11, OK1–OK4) | 19 | Pre-existing, verified |
| G15 hardening probes | 22 | **New** — run against staging to classify |
| npm audit | — | No production vulnerabilities |

**Total probe count**: 41 (19 original + 22 new)

---

## npm audit

`npm audit --production` found **0 production runtime vulnerabilities**.

All moderate findings are in **jest/test toolchain only** (not shipped to users):
- `deepmerge` prototype poisoning (via jest-resolve)
- `glob` AbortSignal bypass (via jest-haste-map)
- `minimatch` ReDoS (via jest-haste-map)

Fixes require breaking changes (`jest@29.7.0` or `expo@52.0.49`). No action needed for production security.

---

## New G15 Hardening Probes

### RLS Coverage

| ID | What it tests | Fix track |
|---|---|---|
| **G15-R1** | Every `public` schema app table has `rowsecurity = true` | Track A: `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` |
| **G15-R2** | Every `field` schema table has `rowsecurity = true` | Track A: same |

**Recommended fix (if failing)**:
```sql
-- For each table listed in the failure:
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<table_name> FORCE ROW LEVEL SECURITY;
```

### SECURITY DEFINER

| ID | What it tests | Fix track |
|---|---|---|
| **G15-D1** | No `SECURITY DEFINER` function in `public`/`field` without pinned `search_path` | Track A |

**Recommended fix (if failing)**:
```sql
ALTER FUNCTION public.<func_name>(<args>) SET search_path = '';
```

### Anon Grants

| ID | What it tests | Fix track |
|---|---|---|
| **G15-A1** | `anon` cannot `SELECT` sensitive tables (users, cadets, training_sessions, etc.) | Track A: `REVOKE SELECT ON <t> FROM anon;` |
| **G15-A2** | `anon` cannot `EXECUTE` sensitive RPCs (`app_access_snapshot`, `field_punch_in`, etc.) | Track A: `REVOKE EXECUTE ON FUNCTION <f> FROM anon;` |
| **G15-A3** | `anon` cannot list or download from any storage bucket | Track A: storage policy audit |

### TRUNCATE

| ID | What it tests | Fix track |
|---|---|---|
| **G15-T1** | No `anon`/`authenticated`/`service_role` has `TRUNCATE` on app tables | Track A: `REVOKE TRUNCATE ON <t> FROM <role>;` |

### Storage Policies

| ID | What it tests | Fix track |
|---|---|---|
| **G15-S1** | `session-videos`, `proof-photos`, `app-content` each have ≥1 policy | Track A |
| **G15-S2** | Stranger cannot upload to `proof-photos` | Track A |
| **G15-S3** | Hub-A instructor cannot upload to `proof-photos` under hub-B path | Track A |
| **G15-S4** | Path traversal (`../`) blocked in `proof-photos` | Track A |
| **G15-S5** | `app-content` is read-only for authenticated users | Track A |

### Authenticated Function Allow-List

| ID | What it tests | Fix track |
|---|---|---|
| **G15-F1** | Functions executable by `authenticated` match the known 41 RPCs | Track A: `REVOKE EXECUTE` on any extra |

**Known allow-list** (41 functions):
`app_access_snapshot`, `app_notification_preferences`, `app_set_notification_preference`, `app_account_deletion_status`, `app_request_account_deletion`, `app_cancel_account_deletion`, `app_consent_centre`, `app_consent_history`, `app_set_media_consent`, `app_spark_today`, `app_ack_spark`, `app_stream_capability`, `app_list_events`, `app_event_detail`, `app_rsvp_event`, `app_cancel_rsvp`, `app_policy_flags`, `field_record_check_in`, `field_publish_session`, `field_correct_session`, `field_void_check_in`, `field_cadet_media_consent`, `field_session_roster`, `field_punch_in`, `field_punch_out`, `field_review_queue`, `field_review_item`, `field_review_decide`, `field_decide_rank_proposal`, `field_propose_rank`, `field_posture_capability`, `hub_horses`, `billing_checkout_status`, `billing_quote`, `billing_create_order`, `billing_get_order`, `billing_list_orders`, `billing_note_client_return`, `billing_cancel_order`, `field.my_care_timeline`, `field.submit_care_evidence`

### Billing Cross-Family Isolation

| ID | What it tests | Fix track |
|---|---|---|
| **G15-B1** | Guardian A cannot see guardian B's orders | Track A: RLS on `billing_orders` |
| **G15-B2** | Stranger cannot create orders for others' children | Track A: RPC ownership check |

### Consent Isolation

| ID | What it tests | Fix track |
|---|---|---|
| **G15-C1** | Stranger cannot read consent records | Track A: RLS on `consent_records` |
| **G15-C2** | Guardian A cannot modify consent for guardian B's child | Track A: RPC family check |

### Role-Based RPC Restrictions

| ID | What it tests | Fix track |
|---|---|---|
| **G15-P1** | Parent cannot `field_punch_in` | Track A: role check in function |
| **G15-P2** | Groom cannot `field_review_decide` | Track A: role check in function |
| **G15-P3** | Groom cannot `field_propose_rank` | Track A: role check in function |

### Users Table Protection

| ID | What it tests | Fix track |
|---|---|---|
| **G15-V1** | Authenticated cannot UPDATE another user's row | Track A: RLS UPDATE policy |
| **G15-V2** | Authenticated cannot read other users' email/phone | Track A: column-level security or view |

---

## Fix Tracks

### Track A — SQL Migrations (for `backend-local/`)

All DB-side fixes live in the backend-local repo. Each finding's recommended SQL is listed in its section above. General patterns:

```sql
-- Enable RLS on a missed table
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<table> FORCE ROW LEVEL SECURITY;

-- Pin search_path on SECURITY DEFINER functions
ALTER FUNCTION public.<func>(<args>) SET search_path = '';

-- Revoke excess grants
REVOKE SELECT ON public.<table> FROM anon;
REVOKE TRUNCATE ON public.<table> FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.<func> FROM anon;
```

### Track B — App-Side Guards (this repo)

The app already has strong client-side defenses:
- **Service-role key rejection** in `supabaseClient.ts` (`isSecretKey()`)
- **Live project ref block** prevents dev builds from hitting production
- **Release bundle scanner** (`check-release-bundle.sh`) catches leaked secrets
- **All writes via RPC** — no direct insert/update/delete from the client
- **Signed upload URLs** with short TTLs for storage operations
- **Path validation** via regex for clips, events, spark audio

No additional app-side fixes are needed at this time. All findings are DB-side (Track A).

---

## App-Side Security Posture (Verified)

| Control | Status | File |
|---|---|---|
| Service-role key rejection | ✅ | `src/core/auth/supabaseClient.ts` |
| Live project ref block | ✅ | `src/core/auth/supabaseClient.ts` |
| Release bundle secret scanner | ✅ | `scripts/check-release-bundle.sh` |
| All mutations via RPC | ✅ | `src/features/*/data/server.ts` |
| Signed storage URLs with TTL | ✅ | `src/features/fieldOps/data/server.ts`, `src/features/family/data/server.ts` |
| Offline queue with actor binding | ✅ | `src/features/sync/domain/types.ts` |
| Chunked secure storage for auth | ✅ | `src/core/auth/` |
| Auto-refresh only in foreground | ✅ | `src/core/auth/supabaseClient.ts` |

---

## How to Run

```bash
# Start the local Supabase stack
cd ../backend-local && supabase start

# Run all staging security probes (original 19 + G15 hardening 22)
cd blackstallion-app && npm run test:staging
```

Failing probes = confirmed security gaps requiring Track A fixes.
Passing probes = verified secure controls.
