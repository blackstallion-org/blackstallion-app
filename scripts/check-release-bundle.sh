#!/usr/bin/env bash
# Exports a production (non-dev) JS bundle per platform and fails if any
# development-preview marker is present. Usage: npm run check:release-bundle
set -euo pipefail
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
MARKERS=("syn-guardian-a" "Priya (sample)" "createFixtureRepositories" "selectPersona" "development synthetic preview" "Synthetic personas simulate")
status=0
for platform in ios android; do
  npx expo export --platform "$platform" --no-bytecode --output-dir "$OUT/$platform" >/dev/null
  bundle="$(ls "$OUT/$platform/_expo/static/js/$platform/"*.js)"
  for m in "${MARKERS[@]}"; do
    if grep -q -- "$m" "$bundle"; then
      echo "FAIL [$platform] release bundle contains: $m"; status=1
    fi
  done
  grep -q "Development preview is not part of release builds" "$bundle" && echo "ok [$platform] stub present, no preview markers" || { echo "FAIL [$platform] stub missing"; status=1; }
done
exit $status
