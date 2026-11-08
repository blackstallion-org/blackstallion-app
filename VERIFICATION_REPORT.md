# Post-Integration Verification Report

**Date:** 2026-11-08
**Branch under review:** `main` (7 commits, all direct pushes — no feat/visual-redesign branch exists)
**Reviewer:** Automated post-integration review

---

## 1. Commit History

7 commits on main (all direct pushes, no merge commits):

```
e697df2 feat(field): field-ops outbox with durable queue, location evidence, and idempotent sync
de73eab feat(billing): G7 billing contract, server adapter, order lifecycle, and test checkout
25b31f3 feat(family): family app server with progress, sessions, passport, media, consent, events, and spark
11a8e9e feat(field): field app server with cadets, sessions, roster, consent, commands, and clock
7c4f9ea feat(identity): access snapshot, experience routing, and context-scoped caching
bca5eb9 feat(auth): Supabase auth adapter with OTP, password, and session lifecycle
26d3ea1 chore: initial project scaffold (Expo SDK 58, navigation, dev preview, staging harness)
```

---

## 2. Typecheck & Lint

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** — zero errors |
| `npx expo lint` | **PASS** — zero warnings |

---

## 3. Unit Tests

| Metric | Value |
|--------|-------|
| Test suites | 54 total |
| Passed suites | 48 |
| Failed suites | 6 |
| Tests | 750 total, 749 passed, 1 skipped |

### Failed suites (all same root cause)

All 6 failures are `ENOENT` reading SQL migration files from sibling repositories that do not exist in this checkout:

- `accountServer.contract.test.ts` — reads `foundations/live-delta/*.sql`
- `billingServer.contract.test.ts` — reads `server/live-delta/*.sql`
- `familyServer.test.ts` — reads `server/reference/*.sql`
- `fieldAppServer.test.ts` — reads `server/reference/*.sql`
- `supabaseFieldWorkflow.test.ts` — reads `server/reference/*.sql`
- `fieldOps/server.test.ts` — reads `server/reference/*.sql`

**Verdict:** These are **contract tests** that validate client-server API agreement against SQL migration files living in a monorepo structure (`foundations/`, `server/`). They cannot pass in a standalone app checkout. **Not a code defect — infrastructure dependency.**

---

## 4. Staging / Security Probes

**Could not run.** The 19-probe staging suite (`npm run test:staging`) requires:
1. Supabase CLI (`supabase`) — not installed
2. Local Docker-based Supabase stack on `127.0.0.1:55421/55422`
3. The `backend-local/` directory with migrations

The harness hard-refuses any target other than the local stack (good safety measure).

**Verdict:** Requires human execution on a machine with Docker + Supabase CLI.

---

## 5. Security Audit (Auth, RLS, Storage, Consent, Money, Secrets, Outbox)

### Files reviewed

| File | Domain | Finding |
|------|--------|---------|
| `src/core/auth/supabaseClient.ts` | Auth config | No hardcoded secrets. Secret key detection (`isSecretKey`). Dev-guard blocks live project ref. Config from env vars only. **Sound.** |
| `src/core/auth/supabase/supabaseAccessAdapter.ts` | Auth flows | OTP + password. `TransientAccessError` preserves sessions on non-auth failures. Code request never reveals account existence. Password reset signs out on failure. **Sound.** |
| `src/features/identity/domain/access.ts` | Access rules | Pure TS. "Client never grants itself access." Hub-scoped context keys. **Sound.** |
| `src/features/fieldOps/data/outbox.ts` | Durable outbox | Owner-scoped reads. Idempotent via `operationId`. Location evidence required. `discardAllFor()` on sign-out. Durability explicitly reported. **Sound.** |
| `src/features/billing/data/server.ts` | Billing | Family-scope enforced. Server-only RPCs. No provider calls from app. Operation IDs validated. Payment ID regex-checked. **Sound.** |
| `src/features/billing/data/CONTRACT.md` | Billing contract | App never sends payer ID/price/total. Replay-safe. Client success is hint only. No webhook code in app (asserted by contract test). **Sound.** |
| `src/features/billing/data/testCheckout.ts` | Test checkout | Test-only gateway. No real provider. Fake `pay_TEST*` IDs. **Sound.** |
| `src/features/family/data/server.ts` | Family server | `requireChild()` on every child operation. Clip paths validated (regex + no `..`). Consent checked before clip URL. Safe columns only for horse data (no camera/microchip per S7a). **Sound.** |
| `src/features/field/data/server.ts` | Field server | `requireHub()` on every operation. Hub filter as defense-in-depth with RLS. Consent fails closed. Clip upload path deterministic. Role check before session reads. **Sound.** |
| `src/features/family/domain/consent.ts` | Consent logic | `allowed` (not just `granted`) is the gate. Policy version mismatch → "Needs review." **Sound.** |
| `src/dev/preview.ts` / `preview.release.ts` | Dev isolation | Release stub throws on any access. Metro config routes non-dev builds to stub. **Sound.** |
| `metro.config.js` | Build config | Release bundle replaces dev preview with inert stubs. **Sound.** |
| `integration/staging/stack.ts` | Staging harness | Hard-refuses non-local targets. Service key from `supabase status`, not hardcoded. **Sound.** |
| `integration/staging/security.staging.ts` | 19 security probes | Comprehensive RLS/cross-hub/consent/self-promotion coverage. **Sound.** |
| `src/testing/fakeSupabase.ts` | Test double | Records calls for assertion. Not used in production. **Sound.** |

### No issues found

- No hardcoded secrets or `.env` files committed
- No secret keys in bundle (verified by release-bundle check)
- Live project ref `tgwadczrfbljnepoaqtb` appears only as a dev-guard (blocks dev builds from hitting production)
- No direct RLS manipulation — all server calls go through Supabase RPC or table reads under RLS
- Storage paths validated with regex and `..` traversal blocked
- Consent is fail-closed throughout

---

## 6. Lane Conflict Analysis

### Duplicate type definitions (maintenance risk, no runtime conflict)

| Type | Locations |
|------|-----------|
| `Rank` / `RankCode` | `identity/domain/access.ts`, `field/data/server.ts`, `field/data/repositories.ts` |
| `ScoreKey` | `family/domain/passportLive.ts`, `fieldOps/domain/session.ts` |

These are string literal unions with identical values defined independently. No import conflict or runtime issue — they're structurally compatible. A future refactor could extract shared types to a common module.

### No other conflicts

- No duplicate migration files
- No token/key collisions
- No inconsistent naming that would cause runtime errors

---

## 7. PR / Push Discipline

**All 7 commits were pushed directly to main.** No merge commits, no PRs.

This is flagged as a process concern — the team's 15 lanes all pushed directly rather than going through pull requests. No code quality issue was found as a result, but this bypasses code review and CI gates.

---

## 8. Release Bundle Check

| Platform | Result |
|----------|--------|
| iOS | **PASS** |
| Android | **PASS** |

**Fix applied:** The original `check-release-bundle.sh` had a false positive on `sb_secret_` — the literal string appears in guard/validation code (`supabaseClient.ts` `isSecretKey()` and the Supabase SDK's key-type detection), not as an actual secret value. Fixed by replacing the broad string match with a regex that only matches real key values: `sb_secret_[A-Za-z0-9_-]{10,}`.

Dev preview markers (`DevPreviewPanel`, `ComponentGallery`, `devAccessAdapter`, `devRepositories`, `createDevAccessAdapter`, `createFixtureRepositories`) are correctly absent from both bundles.

---

## 9. Summary

### Passed

- Typecheck (zero errors)
- Lint (zero warnings)
- 749/750 unit tests (1 skipped intentionally)
- Release bundle check (both platforms, after fix)
- Security audit — all auth, RLS, storage, consent, billing, outbox, and secret handling is sound
- No hardcoded secrets or credentials
- Dev preview properly isolated from production builds
- No runtime-breaking lane conflicts

### Failed / Could not verify

| Item | Status | Action |
|------|--------|--------|
| 6 contract test suites | FAIL (missing sibling repos) | **Human decision:** run in monorepo environment |
| 19 staging security probes | NOT RUN (no Supabase CLI/Docker) | **Human decision:** run on machine with local Supabase stack |

### Needs human decision

1. **Direct pushes to main:** All 7 commits bypassed PR review. Decide whether to enforce PR-based workflow going forward.
2. **Contract tests:** These require `foundations/` and `server/` sibling repos. Decide whether to add these as git submodules, run in CI with the full monorepo, or accept that they only run in certain environments.
3. **Staging probes:** Must be run manually on a machine with Docker and Supabase CLI before any production deployment.
4. **Duplicate types (`Rank`, `ScoreKey`):** Low priority. Consider extracting to a shared module in a future cleanup pass.

### Fixed

- `scripts/check-release-bundle.sh`: False positive on `sb_secret_` guard code (committed with this report)
