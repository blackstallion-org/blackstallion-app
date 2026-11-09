# Maestro Flows — BSAH Mobile

Core lesson journey (J21, J24, J25) as device-level E2E tests.

## Prerequisites

- Maestro CLI installed (`brew install maestro` or https://maestro.mobile.dev)
- JDK 11+ (Maestro requirement)
- Local Supabase stack running (`cd backend-local && supabase start`)
- Staging data seeded (`cd mobile && npm run test:staging` seeds on first run)
- iOS Simulator or Android emulator, or a connected device
- App built and installed (`npx expo run:ios` or `npx expo run:android`)

## Run

```bash
cd mobile/integration/maestro
maestro test flows/
```

Or run a single flow:
```bash
maestro test flows/core-lesson-happy.yaml
```

## Status

**Untested on device** — authored and syntax-valid, but no JDK or connected device on this Mac.
Flows use manual passport entry (testID: `scan-manual-entry`) since CI cannot scan a physical card.

## Accounts

Copy `.env` and fill in the passwords from `seedWorld()` output. The env vars are referenced
in the YAML flows as `${VARIABLE}`.
