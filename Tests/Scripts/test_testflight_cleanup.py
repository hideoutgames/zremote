"""Check the actual workflow cleanup with incomplete logs and fixture key markers."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"


class TestFlightCleanupTests(unittest.TestCase):
    def run_cleanup(self, contaminated):
        workflow = (ROOT / ".github/workflows/ios-testflight.yml").read_text(encoding="utf-8")
        block = workflow.split("      - name: Cleanup key material + guard logs\n", 1)[1]
        script = textwrap.dedent(block.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        with tempfile.TemporaryDirectory(prefix="zremote-testflight-cleanup-") as temporary:
            directory = Path(temporary).resolve()
            # Every deletion in this fixture stays under this newly owned directory.
            (directory / "asc").mkdir()
            (directory / "asc/AuthKey.p8").write_text("fixture", encoding="utf-8")
            (directory / "cleanup.sh").write_text(script, encoding="utf-8", newline="\n")
            log = directory / "native-core.log"
            log.write_text("-----BEGIN PRIVATE KEY-----\nfixture marker only\n" if contaminated else "build failed\n", encoding="utf-8")
            result = subprocess.run([BASH, "-e", "cleanup.sh"], cwd=directory,
                                    env=dict(os.environ, RUNNER_TEMP=directory.as_posix()),
                                    capture_output=True, text=True, timeout=10)
            self.assertFalse((directory / "asc").exists(), result.stdout + result.stderr)
            self.assertEqual(log.exists(), not contaminated)
            self.assertEqual(result.returncode, 1 if contaminated else 0, result.stdout + result.stderr)
            self.assertNotIn("fixture marker only", result.stdout + result.stderr)

    def test_early_failure_keeps_diagnostics_and_removes_key_material(self):
        self.run_cleanup(contaminated=False)

    def test_key_marker_removes_logs_even_when_later_logs_are_missing(self):
        self.run_cleanup(contaminated=True)


if __name__ == "__main__":
    unittest.main()
