#!/usr/bin/env bash
set -euo pipefail

install_matching_android_sdk() {
  local log_file="${1:?installer log path}"
  local attempt status
  for attempt in 1 2 3; do
    status=0
    skip android sdk install --version 6.3.3 --ndk-version r27d 2>&1 | tee "$log_file" || status=$?
    if [[ "$status" == 0 ]]; then return 0; fi

    # Skip 1.9.12 downloads the NDK with URLSession's default timeout. Retry
    # this transient failure only; version, checksum and setup errors must fail.
    if [[ "$attempt" == 3 ]] || ! grep -Fq 'The request timed out.' "$log_file"; then
      return "$status"
    fi
    printf 'Android toolchain download timed out; retrying in %s seconds (attempt %s of 3).\n' \
      "$((attempt * 15))" "$((attempt + 1))" >&2
    sleep "$((attempt * 15))"
  done
}

install_android_toolchain() {
  : "${GITHUB_ENV:?Run this installer in GitHub Actions}"
  # Repeating Skip's installer safely replaces its matching SDK and overwrites
  # the NDK extraction. Preserve its checksum verification and sysroot linking.
  android_install_log="$(mktemp "${TMPDIR:-/tmp}/zremote-android-install.XXXXXX")"
  trap 'rm -f "$android_install_log"' EXIT
  install_matching_android_sdk "$android_install_log"

  local ndk="$HOME/Library/org.swift.swiftpm/swift-sdks/swift-6.3.3-RELEASE_android.artifactbundle/swift-android/android-ndk-r27d"
  test -f "$ndk/source.properties"
  skip android toolchain version --swift-version 6.3.3
  printf 'ANDROID_NDK_HOME=%s\nANDROID_NDK_ROOT=%s\n' "$ndk" "$ndk" >> "$GITHUB_ENV"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  install_android_toolchain
fi
