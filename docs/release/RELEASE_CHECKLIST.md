# Release Checklist

Pre-submission checklist for BSAH's first app store release. Each item must
be completed or explicitly marked N/A before submitting for review.

---

## 1. Legal & Privacy

- [ ] ⚖️ Privacy policy reviewed and approved by lawyer
- [ ] ⚖️ COPPA compliance confirmed (verifiable parental consent method)
- [ ] ⚖️ Data retention periods (D12) defined with legal basis
- [ ] ⚖️ Children's data declarations reviewed for Google Families Policy
- [ ] Privacy policy published at `[DOMAIN]/privacy`
- [ ] Account deletion web page published at `[DOMAIN]/account/delete`
- [ ] Terms of service published (if required)
- [ ] `[PLACEHOLDER]` values in privacy policy replaced with real details
- [ ] `[PRIVACY CONTACT EMAIL]` set in all documents

## 2. Store Listings

### Google Play
- [ ] App name, short description, full description entered
- [ ] Screenshots uploaded (phone, 7-inch tablet, 10-inch tablet)
- [ ] Feature graphic (1024×500) uploaded
- [ ] App category set (Education)
- [ ] Content rating questionnaire completed
- [ ] Data Safety form completed (see `DATA_SAFETY_ANSWERS.md`)
- [ ] Privacy policy URL entered
- [ ] Account deletion URL entered
- [ ] Target audience and content settings configured
- [ ] ⚖️ Families Policy self-declaration reviewed (if applicable)

### Apple App Store
- [ ] App name, subtitle, description entered
- [ ] Screenshots uploaded (6.7", 6.5", 5.5" iPhones; iPad Pro)
- [ ] App Privacy nutrition labels completed (see `DATA_SAFETY_ANSWERS.md`)
- [ ] Privacy policy URL entered
- [ ] App category set (Education)
- [ ] Age rating set (4+)
- [ ] Keywords entered (100 char max)
- [ ] Account deletion URL entered in App Review notes

## 3. App Configuration

- [ ] Bundle identifier set for production (`dev.bsah.mobile` or final ID)
- [ ] App icons at all required sizes
- [ ] Splash screen configured
- [ ] `app.json` permission strings match `PERMISSION_STRINGS.md`
- [ ] Microphone permission remains OFF (`microphonePermission: false`)
- [ ] Background location remains OFF
- [ ] Live Supabase project URL and publishable key set in env
- [ ] Service-role key is NOT in the app bundle
- [ ] Deep link scheme (`bsah://`) registered

## 4. Backend (Supabase)

- [ ] Live database backed up (Dashboard → Database → Backups)
- [ ] pg_cron extension enabled
- [ ] Schema migrations applied (see `server/live-delta/RUNBOOK.md`)
- [ ] All 19 security probes pass against live
- [ ] `session-videos` storage bucket exists and is NOT public
- [ ] pg_cron jobs running: `purge_expired_signed_urls`, `cascade_completed_deletions`
- [ ] Exposed schemas confirmed (`public` listed in API settings)
- [ ] RLS enabled on every public table
- [ ] No service-role key exposed in client code

## 5. Security

- [ ] All RLS policies tested (19 probes — see security matrix)
- [ ] Stranger cannot read stall camera links (S7a)
- [ ] Cross-hub access denied (W1, W3, W5)
- [ ] Role self-promotion blocked (OK4)
- [ ] Consent history deletion blocked (W7)
- [ ] `brass_stamp_verified` cannot be set by client (W2)
- [ ] Video upload requires valid consent (W11)
- [ ] Signed URLs expire correctly
- [ ] No hardcoded secrets in the codebase
- [ ] TLS 1.2+ enforced on all connections

## 6. Consent & Deletion

- [ ] D09 consent flow works: grant → record → withdraw → stops recording
- [ ] Consent version tracking works: changed wording → needs_review
- [ ] Consent audit trail cannot be deleted by parent (W7)
- [ ] SH-10 deletion flow works: request → in_review → completed
- [ ] Deletion reference number displayed to user
- [ ] Pending deletion can be cancelled
- [ ] Video clips queued for deletion on account deletion
- [ ] Account deactivated immediately on deletion request

## 7. Permissions

- [ ] Camera permission primer shows before OS dialog
- [ ] Camera denied state shows recovery message
- [ ] Location permission primer shows before OS dialog
- [ ] Location denied state shows recovery message
- [ ] Location collected only on button press (foreground)
- [ ] No microphone permission requested at any point
- [ ] No photo library access requested

## 8. Build & Distribution

- [ ] EAS Build configured for production profile
- [ ] iOS provisioning profile and certificates set up
- [ ] Android signing keystore configured
- [ ] `eas build --platform all --profile production` succeeds
- [ ] `npx expo lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] App tested on physical iOS device
- [ ] App tested on physical Android device
- [ ] OTA update channel configured for production

## 9. Testing

- [ ] Family flow: sign up → add cadet → view sessions → watch clip
- [ ] Instructor flow: punch in → check in cadet → score → record clip → publish
- [ ] Groom flow: punch in → log care → submit photo proof
- [ ] Consent flow: grant → instructor records → parent views → withdraw → no more recording
- [ ] Deletion flow: request → see reference → cancel (or complete)
- [ ] Cross-hub isolation verified (manual test)
- [ ] Offline behaviour acceptable (no crashes)
- [ ] Deep links work (`bsah://` scheme)

## 10. Post-Submission

- [ ] Monitor store review status
- [ ] Prepare responses for common review rejection reasons
- [ ] ⚖️ If Google requests Families Policy compliance — consult lawyer
- [ ] First OTA update tested via `eas update`
- [ ] Crash monitoring configured (if applicable)

---

**Items marked ⚖️ require lawyer review before proceeding.**

**The privacy policy, data safety answers, and permission strings in
`docs/release/` are DRAFTS — not legal advice. Every section with a
`NEEDS LAWYER REVIEW` marker must be approved by qualified counsel.**
