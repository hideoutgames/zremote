"""Exercise native build orchestration with stub tools, without native compilation."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"


class NativeBuildPhasesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="zremote-native-phases-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for directory in ("scripts", "native/core", "cache/mobile", "bin"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "scripts/build-native-core.sh", self.root / "scripts/build-native-core.sh")
        # Git Bash prepends its own utilities on startup. Reapply the fixture
        # tools after shell initialization so no real Cargo/Xcode tool can run.
        (self.root / "environment.sh").write_text('export PATH="$(cd "$STUB_BIN" && pwd):$PATH"\n', encoding="utf-8")
        self.write_tool("bin/uname", "printf 'Darwin\\n'\n")
        self.write_tool("bin/cargo", 'printf "cargo|%s\\n" "$*" >> "$TRACE"\nexit "${CARGO_STATUS:-0}"\n')
        self.write_tool("bin/rustup", 'printf "rustup|%s\\n" "$*" >> "$TRACE"\n')
        self.write_tool("bin/python3", 'printf "python3|%s\\n" "$*" >> "$TRACE"\n')
        self.write_tool("cache/mobile/uniffi-bindgen", 'printf "bindings|%s\\n" "$*" >> "$TRACE"\n')
        self.write_tool("bin/xcodebuild", '''printf "xcodebuild|%s\\n" "$*" >> "$TRACE"
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == -output ]]; then mkdir -p "$2"; touch "$2/built"; break; fi
  shift
done
''')
        self.environment = dict(os.environ, ZREMOTE_RESOURCE_PROFILE="shared", GITHUB_ACTIONS="true",
                                CONFIGURATION="Release", CARGO_TARGET_DIR=(self.root / "cache").as_posix(),
                                BASH_ENV=(self.root / "environment.sh").as_posix(), STUB_BIN=(self.root / "bin").as_posix(),
                                TRACE=(self.root / "trace").as_posix(), CARGO_STATUS="0")
        self.environment["PATH"] = str(self.root / "bin") + os.pathsep + os.environ["PATH"]

    def write_tool(self, name, contents):
        path = self.root / name
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + contents, encoding="utf-8", newline="\n")
        path.chmod(0o755)

    def run_build(self):
        return subprocess.run([BASH, (self.root / "scripts/build-native-core.sh").as_posix(), "ios"],
                              env=self.environment, capture_output=True, text=True, timeout=20)

    def test_release_builds_host_once_and_retains_all_framework_slices(self):
        result = self.run_build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        trace = (self.root / "trace").read_text()
        cargo = [line for line in trace.splitlines() if line.startswith("cargo|")]
        self.assertEqual(len(cargo), 3)
        self.assertIn("--lib --bin uniffi-bindgen --features bindgen --profile mobile", cargo[0])
        for target in ("aarch64-apple-ios", "aarch64-apple-ios-sim"):
            self.assertIn(f"--profile mobile-dist --target {target}", trace)
            self.assertIn(f"/{target}/mobile-dist/libzeron_mobile.a", trace)
        self.assertIn("/mobile/libzeron_mobile.a", trace)
        self.assertTrue((self.root / "native/artifacts/zeron_coreFFI.xcframework/built").is_file())
        self.assertIn("Finished Host peer and bindings tool: exit=0", result.stdout)
        self.assertIn("Finished Generate Cargo acknowledgements: exit=0", result.stdout)

    def test_host_failure_stops_before_bindings_and_device_work(self):
        self.environment["CARGO_STATUS"] = "42"
        result = self.run_build()
        self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
        trace = (self.root / "trace").read_text().splitlines()
        self.assertEqual(len(trace), 1)
        self.assertIn("Finished Host peer and bindings tool: exit=42", result.stdout)
        self.assertFalse((self.root / "native/artifacts/zeron_coreFFI.xcframework").exists())


if __name__ == "__main__":
    unittest.main()
