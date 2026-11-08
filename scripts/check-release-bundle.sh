#!/usr/bin/env bash
# Exports a production (non-dev) JS bundle per platform and fails if any
# development-preview marker is present. Usage: npm run check:release-bundle
set -euo pipefail
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
# Also: no secret-key prefix and no local-stack address may ever reach a release bundle.
MARKERS=("127.0.0.1:55421" "syn-guardian-a" "Priya (sample)" "createFixtureRepositories" "selectPersona" "development synthetic preview" "Synthetic personas simulate")
 feat/visual-redesign
# sb_secret_ appears in the isSecretKey guard regex — match only actual key values (prefix + alnum).
SB_SECRET_RE='sb_secret_[A-Za-z0-9]'
main
status=0
for platform in ios android; do
  npx expo export --platform "$platform" --no-bytecode --output-dir "$OUT/$platform" >/dev/null
  bundle="$(ls "$OUT/$platform/_expo/static/js/$platform/"*.js)"
  if grep -qE -- "$SB_SECRET_RE" "$bundle"; then
    echo "FAIL [$platform] release bundle contains an actual sb_secret_ key"; status=1
  fi
  for m in "${MARKERS[@]}"; do
    if grep -q -- "$m" "$bundle"; then
      echo "FAIL [$platform] release bundle contains: $m"; status=1
    fi
  done
  # Detect an actual Supabase secret key value (prefix + key chars), not the literal
  # used in guard regexes or SDK key-type detection code.
  if grep -qP 'sb_secret_[A-Za-z0-9_-]{10,}' "$bundle"; then
    echo "FAIL [$platform] release bundle contains an actual sb_secret_ key value"; status=1
  fi
  grep -q "Development preview is not part of release builds" "$bundle" && echo "ok [$platform] stub present, no preview markers" || { echo "FAIL [$platform] stub missing"; status=1; }
done
exit $status
