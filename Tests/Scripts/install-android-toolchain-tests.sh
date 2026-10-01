#!/usr/bin/env bash
# Exercises only the install retry policy using stub commands; no SDK or build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/install-android-toolchain.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/zremote-android-installer-tests.XXXXXX")"
trap 'rm -f "$TEST_ROOT/skip" "$TEST_ROOT/sleep" "$TEST_ROOT/attempts" "$TEST_ROOT/delays" "$TEST_ROOT/install.log"; rmdir "$TEST_ROOT"' EXIT

cat > "$TEST_ROOT/skip" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'android sdk install --version 6.3.3 --ndk-version r27d' ]] || exit 99
attempt=0
if [[ -f "$TEST_ROOT/attempts" ]]; then read -r attempt < "$TEST_ROOT/attempts"; fi
attempt=$((attempt + 1))
printf '%s\n' "$attempt" > "$TEST_ROOT/attempts"
case "$TEST_SCENARIO" in
  success) exit 0 ;;
  recovery) if [[ "$attempt" == 3 ]]; then exit 0; fi ;;
  permanent) printf 'SDK checksum verification failed.\n'; exit 42 ;;
  timeout_then_permanent)
    if [[ "$attempt" == 2 ]]; then printf 'SDK checksum verification failed.\n'; exit 42; fi ;;
  exhausted) ;;
  *) exit 98 ;;
esac
printf '[x] Download NDK r27d\n[x] The request timed out.\n'
exit 28
STUB
cat > "$TEST_ROOT/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "$TEST_ROOT/delays"
STUB
chmod +x "$TEST_ROOT/skip" "$TEST_ROOT/sleep"
export TEST_ROOT
export PATH="$TEST_ROOT:$PATH"

run_case() {
  export TEST_SCENARIO="$1"
  local expected_status="$2" expected_attempts="$3" expected_delays="$4"
  local status=0 attempts delays
  printf '0\n' > "$TEST_ROOT/attempts"
  : > "$TEST_ROOT/delays"
  install_matching_android_sdk "$TEST_ROOT/install.log" > /dev/null 2>&1 || status=$?
  read -r attempts < "$TEST_ROOT/attempts"
  delays="$(tr '\n' ',' < "$TEST_ROOT/delays")"
  if [[ "$status" != "$expected_status" || "$attempts" != "$expected_attempts" || "$delays" != "$expected_delays" ]]; then
    printf 'FAIL %s: status=%s attempts=%s delays=%s\n' "$TEST_SCENARIO" "$status" "$attempts" "$delays" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$TEST_SCENARIO"
}

run_case success 0 1 ''
run_case recovery 0 3 '15,30,'
run_case permanent 42 1 ''
run_case exhausted 28 3 '15,30,'
run_case timeout_then_permanent 42 2 '15,'
