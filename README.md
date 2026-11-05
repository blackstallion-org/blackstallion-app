# BSAH mobile (G2 foundation)

One Expo SDK 58 / React Native 0.88 / TypeScript app for iOS and Android. Family and Field Ops are two experiences in this one app. Gate report: `../MOBILE_APP_PLANNING/G2_FOUNDATION_REPORT.md`.

## Commands
```bash
npm ci                         # install from the lockfile
npm run check                  # tsc --noEmit + expo lint + jest --ci
npm run check:release-bundle   # exports iOS+Android release JS and fails if dev-preview code is inside
npx expo run:ios               # local iOS development build (needs Xcode)
npx expo run:android           # local Android development build (needs JDK 17 + Android SDK)
npx expo start --dev-client    # Metro for an installed development build
```
Add native modules only with `npx expo install <pkg>`.

## Layout (06 §3)
- `src/app/`: routes only (Expo Router). Guards are UX only; the server authorizes every action.
- `src/shell/`: composition root, root navigator and the shared tab chrome.
- `src/features/*/`: feature screens. `domain/` folders are pure TypeScript (lint-enforced).
- `src/core/`: the access adapter seam, preferences store, scoped data loading and the repository seam.
- `src/ui/`: tokens, theme provider, accessible primitives. `src/ui/glass/` holds the amber liquid-glass primitives every screen composes from (see `../design/claude-liquid-glass-brief/IMPLEMENTATION_NOTES.md`); `src/ui/components/` keeps the earlier API and renders through them.
- Routes that open above the tabs (FA-06 Spark, the Field session) live in the experience Stack (`family/_layout.tsx`, `field/_layout.tsx`); tab screens live in `(tabs)/`.
- `src/dev/`: development-only synthetic personas, fixtures and the component gallery. Release bundles resolve `@/dev/preview` to an inert stub (`metro.config.js`).

No backend is connected. Non-development builds always start signed out.
