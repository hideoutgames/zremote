#!/usr/bin/env bash
# Downloads + checksum-verifies the loro-swift 1.13.3 FFI xcframework into
# modules/react-native-loro/vendor/ (the same zip loro-swift's Package.swift
# binaryTarget fetches, pinned by sha256 — see docs/COMPATIBILITY.md).
set -euo pipefail

MODULE_DIR="${1:-$(cd "$(dirname "$0")/../modules/react-native-loro" && pwd)}"
TAG="1.13.3"
URL="https://github.com/loro-dev/loro-swift/releases/download/${TAG}/loroFFI.xcframework.zip"
SHA256="fc55bfb84753a1f0d7ed130d5b03edf3745b6e3db1d62685eeddb77598e09be2"
DEST="$MODULE_DIR/vendor"
ZIP="$DEST/loroFFI.xcframework.zip"

mkdir -p "$DEST"
if [ -d "$DEST/loroFFI.xcframework" ]; then
  echo "loroFFI.xcframework already vendored"
  exit 0
fi

curl -fL "$URL" -o "$ZIP"
echo "$SHA256  $ZIP" | shasum -a 256 -c -
unzip -qo "$ZIP" -d "$DEST"
rm "$ZIP"
echo "loroFFI.xcframework $TAG vendored into $DEST"
