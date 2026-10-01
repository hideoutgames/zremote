#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${ZREMOTE_RESOURCE_PROFILE:-}" != shared ]]; then
  exec python3 "$ROOT/scripts/run-local.py" --phase android -- bash "$0" "$@"
fi
[[ "$(uname -s)" == Darwin ]] || { echo 'The complete Skip app build requires macOS/Xcode. Windows can run syntax and core checks.' >&2; exit 1; }
cd "$ROOT"
CACHE="${ZREMOTE_SWIFT_CACHE:-$HOME/Library/Caches/ZRemote/swift-packages}"
bash scripts/build-native-core.sh ios
bash scripts/build-native-core.sh android
xcodebuild -resolvePackageDependencies -workspace Project.xcworkspace \
  -scheme 'ZRemote App' -clonedSourcePackagesDirPath "$CACHE"
python3 scripts/generate-swift-notices.py \
  --resolved Project.xcworkspace/xcshareddata/swiftpm/Package.resolved \
  --checkouts "$CACHE/checkouts" --output Sources/ZRemote/Resources
gradle -p Android --no-daemon --max-workers=1 :app:exportReleaseRuntimeDependencyInventory
python3 scripts/generate-gradle-notices.py
python3 scripts/verify-notices.py --required swift,cargo,gradle \
  --resolved Project.xcworkspace/xcshareddata/swiftpm/Package.resolved
# Debug APK only. This command does not install, sign for distribution, or upload.
gradle -p Android --no-daemon --max-workers=1 :app:assembleDebug
