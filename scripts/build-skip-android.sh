#!/usr/bin/env bash
set -euo pipefail
# Called by the native Skip Gradle task after its Swift package is generated.
PACKAGE="${1:?derived Swift package}"
BUILD="${2:?native Gradle build directory}"
MODE="${3:?debug or release}"
MODULE="${4:?Swift product}"
SKIP="${SKIP_COMMAND_OVERRIDE:-skip}"
for pair in arm64-v8a:aarch64 x86_64:x86_64; do
  ABI="${pair%%:*}"
  ARCH="${pair##*:}"
  LIB="$PACKAGE/native/artifacts/android/$ABI/libzeron_mobile.so"
  test -f "$LIB" || { echo "Missing Rust core for $ABI. Run scripts/build-native-core.sh android first." >&2; exit 1; }
  SKIP_ZREMOTE_ANDROID_ABI="$ABI" "$SKIP" android build \
    --swift-version "${SKIP_ZREMOTE_SWIFT_VERSION:-6.3.3}" --ndk "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to the matching Swift SDK NDK}" \
    --package-path "$PACKAGE" --configuration "$MODE" --product "$MODULE" \
    --scratch-path "$BUILD/swift-$ABI" --arch "$ARCH" -d "$BUILD/jni-libs" \
    --jobs 1 -Xcc -fPIC -Xswiftc -DSKIP_BRIDGE -Xswiftc -DTARGET_OS_ANDROID
  mkdir -p "$BUILD/jni-libs/$ABI"
  cp "$LIB" "$BUILD/jni-libs/$ABI/libzeron_mobile.so"
done
