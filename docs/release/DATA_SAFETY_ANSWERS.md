# Data Safety & App Privacy — Store questionnaire answers

> **STATUS: DRAFT — NEEDS LAWYER REVIEW**
>
> These answers are prepared for the owner to enter into the Google Play Data
> Safety form and the Apple App Privacy questionnaire. Review with counsel
> before submission.

---

## Google Play Data Safety

### Does your app collect or share any of the required user data types?

**Yes.**

### Data collected

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| **Email address** | Yes | No | Account management, authentication | No (required for sign-in) |
| **Name** | Yes | No | App functionality (display, session records) | No |
| **Photos** | Yes | No | App functionality (care proof photos) | Yes (staff only) |
| **Videos** | Yes | No | App functionality (session clips for parents) | Yes (requires parental consent) |
| **Precise location** | Yes | No | App functionality (staff punch-in, care proof verification) | Yes (staff only, foreground only) |
| **Other user-generated content** | Yes | No | App functionality (session notes, assessment scores) | No |

### Data NOT collected

| Data type | Collected |
|---|---|
| Financial / payment info | No (handled by app store) |
| Health & fitness | No |
| Messages / SMS | No |
| Audio / voice recordings | No (microphone is off) |
| Files and docs | No |
| Calendar | No |
| Contacts | No |
| App activity / web browsing | No |
| Device identifiers / advertising ID | No |

### Security

- Data encrypted in transit: **Yes** (TLS 1.2+)
- Data encrypted at rest: **Yes** (Supabase managed encryption)
- Users can request data deletion: **Yes** (in-app, SH-10)
- Deletion request mechanism: **In-app account deletion (Settings → Delete Account)**

### Children's data

- App directed at children under 13: **No** — the app is used BY parents/guardians and staff; children do not have accounts or direct app access.
- Collects data from children under 13: **Yes, indirectly** — parents and instructors enter data about children (name, session scores, video clips with consent).

⚖️ **NEEDS LAWYER REVIEW:** Google may classify this as a "teacher/family
app" that handles children's data. Verify the correct Data Safety
declarations and whether the Families Policy applies.

---

## Apple App Privacy (App Store Connect)

### Data Linked to You (the user)

| Data type | Used for tracking | Linked to identity |
|---|---|---|
| Contact Info — Email Address | No | Yes |
| Contact Info — Name | No | Yes |
| Location — Precise Location | No | Yes |
| Photos or Videos | No | Yes |
| User Content — Other (session notes) | No | Yes |

### Data Not Linked to You

None collected.

### Data Used to Track You

**None.** BSAH does not track users across other companies' apps or websites.

### Data Not Collected

- Health & Fitness
- Financial Info
- Sensitive Info
- Browsing History
- Search History
- Identifiers (no advertising ID, no device ID collected)
- Usage Data (no analytics SDK)
- Diagnostics
- Purchases (handled by Apple)

---

### Nutrition label summary (for Apple)

**Data types collected:**
1. Contact Info (email, name)
2. Location (precise, when-in-use only)
3. Photos or Videos
4. User Content

**All data is:**
- Used for App Functionality only
- Not used for Tracking
- Linked to the user's identity

⚖️ **NEEDS LAWYER REVIEW:** Confirm these categories match Apple's current
taxonomy. If Expo or any SDK collects diagnostic/crash data automatically,
that must be declared.
