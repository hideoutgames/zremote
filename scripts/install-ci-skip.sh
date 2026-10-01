#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?Run this installer on the CI runner}"
: "${GITHUB_PATH:?Run this installer in GitHub Actions}"
DEST="$RUNNER_TEMP/skip-1.9.12"
mkdir -p "$DEST"
curl --fail --location --silent --show-error \
  https://github.com/skiptools/skip/releases/download/1.9.12/skip-macos.zip \
  --output "$DEST/skip.zip"
printf '%s  %s\n' b9627f129b0ed81b66cc19fe2da15127b9854d4685079fe42c12e90e6017fa57 "$DEST/skip.zip" | shasum -a 256 --check
unzip -q "$DEST/skip.zip" -d "$DEST"
echo "$DEST/skip.artifactbundle/macos" >> "$GITHUB_PATH"
