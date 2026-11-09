#!/usr/bin/env bash
# Serve the app to Expo Go in RELEASE mode, connected to the LIVE project with its public (publishable) key.
# Why release mode: development builds refuse the live project on purpose (D33, src/core/auth/supabaseClient.ts).
# The address and public key are read from mobile/live-backend.local.txt (git-ignored, never committed).
# Secret keys are refused here and again inside the app. Nothing is changed on the live project by starting this.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cfg="$here/live-backend.local.txt"
[ -f "$cfg" ] || { echo "missing $cfg (two lines: EXPO_PUBLIC_SUPABASE_URL=..., EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...)" >&2; exit 1; }
url="$(sed -n 's/^EXPO_PUBLIC_SUPABASE_URL=//p' "$cfg" | head -1 | tr -d '[:space:]')"
key="$(sed -n 's/^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=//p' "$cfg" | head -1 | tr -d '[:space:]')"
case "$url" in https://*.supabase.co) ;; *) echo "refusing: URL must be https://<ref>.supabase.co" >&2; exit 1;; esac
case "$key" in sb_publishable_*) ;; eyJ*) echo "legacy anon key: allowed only if it is the anon role" >&2;; *) echo "refusing: not a publishable key" >&2; exit 1;; esac
case "$key" in sb_secret_*) echo "refusing: secret key" >&2; exit 1;; esac
echo "Release-mode Metro for Expo Go -> $url (public key from live-backend.local.txt, not shown)"
cd "$here"
EXPO_PUBLIC_SUPABASE_URL="$url" EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$key" exec npx expo start --go --lan --no-dev --minify --clear
