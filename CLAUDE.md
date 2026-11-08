# CLAUDE.md — PR Guardian Rules

## Project

BSAH (Black Stallion Academy Hub) — Expo SDK 58 / React Native 0.88 / TypeScript 6 equestrian management app with two experiences (Family + Field), Supabase backend, offline-first sync via expo-sqlite, and an amber liquid-glass design system.

## Commands

```bash
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx jest                    # unit tests
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## PR Guardian — Hourly Review Loop

Target branch: `feat/visual-redesign`

1. List open PRs targeting `feat/visual-redesign`.
2. For each PR: checkout, run lint + typecheck + tests, read the full diff.
3. Flag changes in sensitive areas (see below). Comment with concrete fixes.
4. Merge only PRs where all checks are green.
5. After each merge, re-run checks on `feat/visual-redesign`.
6. `/learn` for repeated mistakes. `/handoff` at end of day.

## Sensitive Areas — Always Review

| Area | Key paths |
|---|---|
| Auth | `src/core/auth/` (supabaseClient, accessAdapter, chunkedSecureStorage, keystore, signOutCleanup), `src/features/identity/` (AccessProvider, otp, SignInScreen, VerifyCodeScreen, updateGate) |
| Storage / RLS | `**/data/server.ts` in every feature, `src/core/auth/supabase/supabaseAccess.ts`, `integration/staging/security.staging.ts` |
| Consent | `src/features/family/domain/consent.ts`, `src/features/family/consent/`, `src/features/family/components/PrivateClip.tsx`, `src/features/capture/contract.ts` |
| Billing / Money | `src/features/billing/domain/` (paymentState, orders, autopay), `src/features/billing/data/server.ts`, `src/features/billing/data/CONTRACT.md` |
| Env / Secrets | `src/core/auth/supabaseClient.ts` (isSecretKey, LIVE_PROJECT_REF), `src/features/account/config.ts` |

## Security Invariants — Never Merge If Broken

- No service-role keys or secrets in client code.
- `isSecretKey()` guard stays intact; rejects service-role JWTs and secret keys.
- Access snapshots come from the `app_access_snapshot` server RPC, never derived client-side.
- Billing: the app never sends price, amount, or payer ID. The server uses `auth.uid()`.
- Consent: fail-closed — no consent means hidden, not shown.
- Signed URLs: short TTL (120 s), never cached past expiry.
- OTP: error messages never reveal whether an account exists.
- Sign-out: `runSignOutCleanups()` always called; no stale user data leaks across sessions.
- Delete account: request-only flow, replay-safe with operation IDs.
- No `.env` files committed. All `EXPO_PUBLIC_*` values validated before use.
- Dev builds cannot point at the live Supabase project (`LIVE_PROJECT_REF` guard).

## Architecture Rules

- Expo Router for all navigation; routes live in `src/app/`.
- Clean architecture: `domain/` (pure TS) → `data/` (server/repo) → screens.
- Repository pattern via `RepositoryProvider` + `useScopedResource`.
- Offline-first: sync outbox in `src/features/sync/` with SQLite, retry, conflict resolution.
- Two UI layers: `src/ui/components/` (original) and `src/ui/glass/` (liquid-glass design system).
- Design tokens in `src/ui/tokens/` (brand, colors, contrast, layout, motion, typography).
