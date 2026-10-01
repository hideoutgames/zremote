#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${ZREMOTE_RESOURCE_PROFILE:-}" != shared ]]; then
  exec python3 "$ROOT/scripts/run-local.py" --phase rust -- bash "$0" "$@"
fi
CORE="$ROOT/native/core"
OUT="$ROOT/native/artifacts"
PROFILE=mobile
if [[ "${CONFIGURATION:-Debug}" == Release ]]; then PROFILE=mobile-dist; fi
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$OUT/target}"
mkdir -p "$OUT/generated" "$ROOT/native/ffi/include"
cd "$CORE"

build() { env -u SDKROOT -u MACOSX_DEPLOYMENT_TARGET cargo "$@"; }
build build --locked -p zeron-mobile --lib --profile mobile
build build --locked -p zeron-mobile --bin uniffi-bindgen --features bindgen --profile mobile
case "$(uname -s)" in
  Darwin) HOST_LIB="$CARGO_TARGET_DIR/mobile/libzeron_mobile.dylib" ;;
  Linux) HOST_LIB="$CARGO_TARGET_DIR/mobile/libzeron_mobile.so" ;;
  *) echo 'Use the macOS or Linux native toolchain for this build script.' >&2; exit 1 ;;
esac
"$CARGO_TARGET_DIR/mobile/uniffi-bindgen" generate --library "$HOST_LIB" --language swift --out-dir "$OUT/generated"
python3 "$ROOT/scripts/normalize-native-bindings.py" --generated "$OUT/generated"

case "${1:-ios}" in
  ios)
    [[ "$(uname -s)" == Darwin ]] || { echo 'iOS core requires macOS and Xcode.' >&2; exit 1; }
    for target in aarch64-apple-ios aarch64-apple-ios-sim; do
      rustup target add "$target"
      IPHONEOS_DEPLOYMENT_TARGET=17.0 build build --locked -p zeron-mobile --lib --profile "$PROFILE" --target "$target"
    done
    # A new temporary artifact is built before replacing the prior framework.
    STAGING="$(mktemp -d "$OUT/xcframework.XXXXXX")"
    xcodebuild -create-xcframework \
      -library "$CARGO_TARGET_DIR/aarch64-apple-ios/$PROFILE/libzeron_mobile.a" -headers "$ROOT/native/ffi/include" \
      -library "$CARGO_TARGET_DIR/aarch64-apple-ios-sim/$PROFILE/libzeron_mobile.a" -headers "$ROOT/native/ffi/include" \
      -library "$CARGO_TARGET_DIR/mobile/libzeron_mobile.a" -headers "$ROOT/native/ffi/include" \
      -output "$STAGING/zeron_coreFFI.xcframework"
    # Both paths are fixed children of native/artifacts.
    rm -rf "$OUT/zeron_coreFFI.xcframework"
    mv "$STAGING/zeron_coreFFI.xcframework" "$OUT/zeron_coreFFI.xcframework"
    rmdir "$STAGING"
    ;;
  android)
    : "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to the installed NDK}"
    command -v cargo-ndk >/dev/null || { echo 'Install cargo-ndk before building the Android core.' >&2; exit 1; }
    rustup target add aarch64-linux-android x86_64-linux-android
    cargo ndk -t arm64-v8a -t x86_64 -o "$OUT/android" build --locked -p zeron-mobile --lib --profile "$PROFILE"
    ;;
  *) echo 'Usage: build-native-core.sh ios|android' >&2; exit 2 ;;
esac
python3 "$ROOT/scripts/generate-cargo-notices.py"
