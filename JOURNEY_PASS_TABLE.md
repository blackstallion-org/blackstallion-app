# Journey Pass Table

J01–J38 × {repo, web, maestro} — updated 2026-11-08.

Statuses: `pass` | `partial:<reason>` | `skip:<reason>` | `blocked:<decision>` | `—` (not applicable) | `planned` (authored, not yet run)

| ID  | Journey                  | Repo                   | Web                    | Maestro       |
|-----|--------------------------|------------------------|------------------------|---------------|
| J01 | First sign-in            | planned                | planned                | —             |
| J02 | Returning cold start     | planned                | planned                | —             |
| J03 | Dual-role switch         | planned                | planned                | —             |
| J04 | Appearance/language      | skip:client-only       | planned                | —             |
| J05 | Sign out with unsent     | planned                | planned                | —             |
| J06 | Notification/deep link   | planned                | planned                | —             |
| J07 | Account deletion         | blocked:D12            | blocked:D12            | —             |
| J08 | Help                     | planned                | planned                | —             |
| J09 | Outdated build           | planned                | planned                | —             |
| J10 | Check-in alert           | planned                | planned                | —             |
| J11 | New assessment clip      | partial:no-clip        | partial:no-clip        | —             |
| J12 | Review progress          | planned                | planned                | —             |
| J13 | Switch child             | planned                | planned                | —             |
| J14 | Passport/rank            | blocked:D15            | blocked:D15            | —             |
| J15 | Hall of Valour           | planned                | planned                | —             |
| J16 | Daily Spark              | partial:no-audio       | partial:no-audio       | —             |
| J17 | Horse/stall camera       | blocked:SD-04/D23      | blocked:SD-04/D23      | —             |
| J18 | RSVP event               | planned                | planned                | —             |
| J19 | Change consent           | planned                | planned                | —             |
| J20 | Compare clips            | blocked:D24            | blocked:D24            | —             |
| J21 | Scan→grade→publish       | partial:no-camera      | partial:web-stub       | planned        |
| J22 | Publish offline          | planned                | partial:network-stub   | —             |
| J23 | Correct assessment       | planned                | planned                | —             |
| J24 | Wrong scan/missing       | planned                | planned                | planned        |
| J25 | No video consent         | planned                | planned                | planned        |
| J26 | Batch session            | blocked:Q7             | blocked:Q7             | —             |
| J27 | Due care task            | partial:no-GPS         | partial:no-GPS         | —             |
| J28 | Care by horse            | planned                | planned                | —             |
| J29 | Punch in/out             | partial:no-GPS         | partial:no-GPS         | —             |
| J30 | Overdue escalation       | planned                | planned                | —             |
| J31 | Recover stuck item       | planned                | planned                | —             |
| J32 | Propose/approve rank     | blocked:D15            | blocked:D15            | —             |
| J33 | Review posture           | blocked:D24/D34        | blocked:D24/D34        | —             |
| J34 | Pay dues                 | partial:no-Razorpay    | partial:no-Razorpay    | —             |
| J35 | Download invoice         | planned                | planned                | —             |
| J36 | Autopay setup/cancel     | blocked:D11            | blocked:D11            | —             |
| J37 | Buy kit/passport         | partial:no-Razorpay    | partial:no-Razorpay    | —             |
| J38 | Notifications            | blocked:D05/M15        | blocked:D05/M15        | —             |

## Summary

- **Repo tests**: 25 testable (13 blocked/skipped), 4 files + helpers
- **Web (Playwright)**: 25 testable (13 blocked/skipped), 4 spec files + config + helpers
- **Maestro**: 3 flows (J21, J24, J25) — untested on device (no JDK, no connected phone)
- **Total estimated tests**: ~107 across all layers

## What has NOT run

- All tests are authored but **not yet executed** — the local staging stack must be running.
- Playwright requires `npx playwright install chromium` before first run.
- Maestro requires JDK + connected device or simulator.
- Statuses will move from `planned` to `pass`/`fail` after `npm run test:staging` and `npm run test:playwright`.
