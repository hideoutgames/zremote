"""Scoped runner liveness checks; these children do not compile anything."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("run_local", Path(__file__).resolve().parents[2] / "scripts/run-local.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ChildProgressTests(unittest.TestCase):
    def test_quiet_child_reports_liveness_and_preserves_failure(self):
        output = io.StringIO()
        with subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.2); raise SystemExit(7)"]) as child:
            with contextlib.redirect_stdout(output), patch.object(runner, "available_mb", return_value=4096):
                status = runner.wait_for_child(child, "ios", heartbeat_seconds=0.02)
        self.assertEqual(status, 7)
        self.assertIn("Running ios: elapsed=", output.getvalue())
        self.assertIn("availableMB=4096 (child still running)", output.getvalue())
        self.assertNotIn("SystemExit", output.getvalue())

    def test_completed_child_has_no_running_notice(self):
        output = io.StringIO()
        with subprocess.Popen([sys.executable, "-c", "pass"]) as child:
            child.wait()
            with contextlib.redirect_stdout(output):
                status = runner.wait_for_child(child, "rust", heartbeat_seconds=0.02)
        self.assertEqual(status, 0)
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
