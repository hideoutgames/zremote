"""Exercise bundle identity validation with XML and binary application fixtures."""
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/verify-ios-bundle-identifiers.py"
APP_ID = "no.hideout.zremote"


class IOSBundleIdentifierTests(unittest.TestCase):
    def run_verifier(self, embedded, expected_id=APP_ID):
        with tempfile.TemporaryDirectory(prefix="zremote-bundle-identifiers-") as temporary:
            app = Path(temporary) / "ZRemote.app"
            for index, (relative, bundle_id) in enumerate([(Path("."), APP_ID), *embedded]):
                bundle = app / relative
                bundle.mkdir(parents=True, exist_ok=True)
                with (bundle / "Info.plist").open("wb") as destination:
                    plistlib.dump({"CFBundleIdentifier": bundle_id}, destination,
                                  fmt=plistlib.FMT_BINARY if index % 2 else plistlib.FMT_XML)
            return subprocess.run([sys.executable, str(SCRIPT), str(app), "--expected-id", expected_id],
                                  capture_output=True, text=True, timeout=10)

    def test_distinct_app_framework_resource_and_extension_identifiers(self):
        result = self.run_verifier([
            (Path("Resources.bundle"), "org.swift.resources"),
            (Path("Frameworks/SkipFuse.framework"), "org.swift.SkipFuse"),
            (Path("Frameworks/SkipFuse.framework/Nested.bundle"), "org.swift.nested"),
            (Path("PlugIns/Share.appex"), APP_ID + ".share"),
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verified 5 unique bundle identifiers", result.stdout)

    def test_dependency_cannot_share_the_app_identifier(self):
        result = self.run_verifier([(Path("Frameworks/SkipFuse.framework"), APP_ID)])
        self.assertEqual(result.returncode, 1)
        self.assertIn("Duplicate CFBundleIdentifier", result.stderr)
        self.assertIn("SkipFuse.framework", result.stderr)

    def test_resource_bundles_cannot_share_an_identifier(self):
        result = self.run_verifier([
            (Path("First.bundle"), "org.swift.resources"),
            (Path("Second.bundle"), "org.swift.resources"),
        ])
        self.assertEqual(result.returncode, 1)
        self.assertIn("First.bundle and Second.bundle", result.stderr)

    def test_app_must_match_the_requested_distribution_identity(self):
        result = self.run_verifier([], expected_id="no.hideout.other")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Expected app identifier no.hideout.other", result.stderr)


if __name__ == "__main__":
    unittest.main()
