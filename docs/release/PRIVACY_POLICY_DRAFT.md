# BSAH Privacy Policy — DRAFT

> **STATUS: DRAFT — NEEDS LAWYER REVIEW**
>
> This document is a working draft prepared for the app owner's review. It is
> **not legal advice**. Every section marked ⚖️ must be reviewed and approved
> by a qualified attorney before publication. Bracketed `[PLACEHOLDER]` values
> must be filled in with real business details.

**Last updated:** [DATE]
**Effective:** [DATE]

---

## 1. Who we are

BSAH is a mobile application operated by [LEGAL ENTITY NAME], [ADDRESS].
Contact: [PRIVACY CONTACT EMAIL].

We provide a horse-riding education platform connecting families (parents/
guardians and their children — "cadets") with riding schools ("hubs"),
instructors, and grooms.

## 2. Children's data — COPPA & age restrictions ⚖️

> **NEEDS LAWYER REVIEW** — COPPA compliance, GDPR-K (if serving EU), and
> any state-specific child privacy laws (e.g. California's CCPA/CPRA
> amendments for minors).

BSAH collects data about children ("cadets") **only through their parent or
guardian's account**. Children do not create their own accounts or directly
interact with the app.

**Data collected about cadets:**

| Data | Source | Purpose | Retention |
|---|---|---|---|
| First name, last name | Parent registration via hub | Identity, session records | Until account deletion + [D12 RETENTION PERIOD — NEEDS LAWYER REVIEW] |
| Passport code (BSAH-issued ID) | Hub assignment | QR scan check-in at sessions | Same as above |
| Assigned horse | Hub assignment | Session pairing | Same as above |
| Current rank & rank history | Instructor assessment | Progress tracking | Same as above |
| Training session scores (riding, ground, stable) | Instructor after session | Progress tracking, guardian view | Same as above |
| Session video clips | Instructor camera, **only with parental consent** (D09) | Session review by guardian | [D12 RETENTION PERIOD — NEEDS LAWYER REVIEW] |
| Achievements | Instructor/system | Progress & motivation | Same as above |
| Hub assignment (which riding school) | Hub registration | Operational | Same as above |

**Parental consent (D09):**
- Video recording of a child's session requires **explicit, prior, informed
  consent** from the parent/guardian, granted in-app per child per purpose.
- Consent can be withdrawn at any time. Withdrawal takes effect immediately:
  no new recordings are made.
- Consent versions are tracked. When wording changes, existing consent is
  treated as "needs review" and recording stops until the parent re-consents
  under the new wording.
- Consent history (grant, withdrawal, review events) is retained as an
  audit trail and **cannot be deleted by the parent** (required for
  accountability).

⚖️ **NEEDS LAWYER REVIEW:** Verify that the in-app consent mechanism meets
COPPA's "verifiable parental consent" standard. A higher-assurance method
(e.g. signed consent form via the hub, credit card verification) may be
required depending on the age of cadets and jurisdiction.

## 3. Video data ⚖️

> **NEEDS LAWYER REVIEW** — video handling, storage location, access
> controls, and retention.

- **What:** Short silent video clips (≈10 seconds) of a child's riding
  session, recorded by the instructor using the app's camera.
- **Audio:** The camera is configured with microphone OFF
  (`microphonePermission: false`). No audio is captured.
- **Storage:** Videos are uploaded to a private Supabase Storage bucket
  (`session-videos`). Access is controlled by Row Level Security:
  - Only the instructor at the child's hub can upload.
  - Only the child's parent/guardian can view (via time-limited signed URLs).
  - No public access. No CDN. No third-party processing.
- **Retention:** [D12 RETENTION PERIOD — NEEDS LAWYER REVIEW]. After the
  retention period, clips are permanently deleted by an automated job
  (pg_cron).
- **Deletion on request:** When a parent requests account deletion (SH-10),
  all associated video clips are queued for deletion within the retention
  processing window.

## 4. Location data ⚖️

> **NEEDS LAWYER REVIEW** — location data handling, precision, and retention.

- **What:** Approximate GPS coordinates, collected **only** at specific
  moments:
  - **Staff punch-in:** When an instructor or groom clocks in at the yard,
    to verify they are physically at the hub.
  - **Care proof:** When a groom submits proof of horse care (photo + GPS),
    to verify the work was done at the yard.
- **When:** Location is collected **only when the user presses the button**
  (foreground only). There is no background location tracking.
- **Precision:** The app requests standard accuracy (not high-precision).
  The coordinates are compared against the hub's known location.
- **Storage:** Coordinates are stored in `staff_attendance` and
  `groom_daily_logs` tables.
- **Retention:** [D12 RETENTION PERIOD — NEEDS LAWYER REVIEW].
- **Children:** No location data is collected from or about children.
  Location is a staff-only feature.
- **Permissions:** `locationWhenInUsePermission` only. No background
  location (`isIosBackgroundLocationEnabled: false`,
  `isAndroidBackgroundLocationEnabled: false`).

## 5. Camera data

- **What:** The camera is used for:
  1. Scanning a cadet's passport QR code (check-in).
  2. Recording a short silent session clip (with parental consent).
  3. Taking care-proof photos (groom workflow).
- **Audio:** Microphone access is not requested. Clips are silent.
- **Storage:** Photos and clips are uploaded to the private Supabase Storage
  bucket. No local persistent storage of media.

## 6. Account data

| Data | Purpose | Retention |
|---|---|---|
| Email address | Authentication (OTP sign-in) | Until deletion + [D12] |
| Full name | Display, session records | Until deletion + [D12] |
| Role (parent/instructor/groom) | Access control | Until deletion + [D12] |
| Hub assignment (staff) | Operational scope | Until deletion + [D12] |

## 7. Data retention (D12) ⚖️

> **NEEDS LAWYER REVIEW** — define specific retention periods and legal
> basis for each data category.

| Category | Proposed retention | Legal basis |
|---|---|---|
| Account data | Active + [X] days after deletion request | [LEGAL BASIS] |
| Session records (scores, notes) | [X] years from session date | [LEGAL BASIS] |
| Video clips | [X] days from session date | Parental consent (D09) |
| Location records (punch-in, care proof) | [X] months | Legitimate interest |
| Consent audit trail | [X] years (regulatory minimum) | Legal obligation |

After the retention period expires, data is permanently deleted by automated
jobs. Deletion requests (SH-10) are processed within [X] business days.

## 8. Account deletion (SH-10)

Any user can request account deletion from within the app. The process:

1. User navigates to Settings → Delete Account.
2. User types "DELETE" to confirm.
3. An optional reason can be provided (up to 1,000 characters).
4. The request is submitted and assigned a reference number.
5. The request enters the "in review" stage (staff review for data
   dependencies — e.g. a cadet with active sessions).
6. Once completed, the account and associated data are permanently removed
   per the retention schedule.

Users can cancel a pending deletion request before it is completed.

## 9. Third parties

| Party | Purpose | Data shared |
|---|---|---|
| Supabase (backend) | Database, auth, storage | All app data (hosted) |
| Expo / EAS (build) | App distribution, OTA updates | Device metadata (standard) |
| Apple / Google (stores) | App distribution, payments | Standard store data |

⚖️ **NEEDS LAWYER REVIEW:** Enumerate all sub-processors. Supabase's DPA
and data residency (region) must be documented.

## 10. Security

- All data in transit: TLS 1.2+.
- Row Level Security on every database table.
- Publishable API key only in the app (no service-role key in the bundle).
- Session tokens stored in device secure storage (Keychain / Keystore).
- Staff roles assigned by trusted activation only (not self-assignable).

## 11. Your rights ⚖️

> **NEEDS LAWYER REVIEW** — enumerate rights per jurisdiction (GDPR, CCPA,
> COPPA, Indian DPDPA if applicable).

- Access, correction, deletion, portability, objection, withdrawal of
  consent.
- Contact: [PRIVACY CONTACT EMAIL].

## 12. Changes to this policy

We will notify you of material changes via [in-app notification / email].
Continued use after the effective date constitutes acceptance.

---

⚖️ **Entire document NEEDS LAWYER REVIEW before publication.**
