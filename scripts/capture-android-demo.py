"""Capture the installed demo through real Android accessibility nodes and ADB.

This is an explicitly requested visual smoke check, not an instrumentation suite.
It never authenticates, connects a host, or draws/replaces screenshot pixels.
Only run against an isolated emulator: it clears this app's data between layouts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import time
import xml.etree.ElementTree as ET

APP = "no.hideout.zremote"


class Capture:
    def __init__(self, output: Path, timeout: int):
        self.output = output
        self.deadline = time.monotonic() + timeout
        self.mode = "startup"
        self.width, self.height = 1080, 1920
        self.serial = "emulator-" + os.environ.get("EMULATOR_PORT", "5554")
        self.results: list[dict] = []

    def adb(self, *args: str, binary: bool = False, timeout: int = 30) -> str | bytes:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Demo capture reached its overall time limit")
        result = subprocess.run(["adb", "-s", self.serial, *args],
                                capture_output=True, timeout=min(timeout, remaining), check=True)
        return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")

    def nodes(self) -> list[ET.Element]:
        self.adb("shell", "uiautomator", "dump", "/sdcard/zremote-demo.xml", timeout=20)
        xml = self.adb("shell", "cat", "/sdcard/zremote-demo.xml")
        root = ET.fromstring(xml)
        return list(root.iter("node"))

    @staticmethod
    def matches(node: ET.Element, label: str, prefix: bool) -> bool:
        return any(value.startswith(label) if prefix else value == label
                   for value in (node.get("text", ""), node.get("content-desc", "")))

    def find(self, label: str, prefix: bool = False, timeout: int = 35) -> ET.Element:
        until = min(self.deadline, time.monotonic() + timeout)
        last_error = None
        while time.monotonic() < until:
            try:
                for node in self.nodes():
                    if self.matches(node, label, prefix) and node.get("enabled") != "false":
                        return node
            except (subprocess.SubprocessError, ET.ParseError) as error:
                last_error = type(error).__name__
            time.sleep(0.8)
        raise RuntimeError(f"Visible control not found: {label!r}" + (f" ({last_error})" if last_error else ""))

    def tap(self, label: str, prefix: bool = False):
        node = self.find(label, prefix)
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if not bounds:
            raise RuntimeError(f"No usable accessibility bounds for {label!r}")
        left, top, right, bottom = map(int, bounds.groups())
        if right <= left or bottom <= top:
            raise RuntimeError(f"Empty accessibility bounds for {label!r}")
        self.adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        time.sleep(0.7)

    def save(self, surface: str):
        # Capture first; XML alongside it records what the automation observed.
        time.sleep(0.8)
        path = self.output / f"{self.mode}-{surface}.png"
        png = self.adb("exec-out", "screencap", "-p", binary=True)
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError("ADB did not return a PNG screenshot")
        width, height = struct.unpack(">II", png[16:24])
        if (width, height) != (self.width, self.height):
            raise RuntimeError(f"Unexpected screenshot dimensions: {width}x{height}")
        path.write_bytes(png)
        nodes = self.nodes()
        hierarchy = ET.Element("hierarchy")
        hierarchy.extend(nodes[:1])
        ET.ElementTree(hierarchy).write(self.output / f"{self.mode}-{surface}.xml", encoding="utf-8")
        self.results.append({"layout": self.mode, "surface": surface, "file": path.name,
                             "width": width, "height": height,
                             "sha256": hashlib.sha256(png).hexdigest(), "status": "captured"})
        print(f"Captured {path.name}", flush=True)

    def show_sessions(self):
        if self.mode == "phone":
            self.tap("Show sessions")
        self.find("Sessions")

    def show_completed_changes(self):
        # Scroll only within the actual transcript area, at most six times.
        # Every later tap still uses a fresh accessibility label and bounds.
        for attempt in range(7):
            try:
                self.find("Show all…", timeout=5)
                return
            except RuntimeError:
                if attempt == 6:
                    raise
                x = int(self.width * 0.78)
                self.adb("shell", "input", "swipe", str(x), str(int(self.height * 0.65)),
                         str(x), str(int(self.height * 0.30)), "350")
                time.sleep(0.8)

    def layout(self, mode: str, width: int, height: int, density: int):
        self.mode, self.width, self.height = mode, width, height
        self.adb("shell", "am", "force-stop", APP)
        self.adb("shell", "pm", "clear", APP)
        self.adb("shell", "wm", "size", f"{width}x{height}")
        self.adb("shell", "wm", "density", str(density))
        self.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
        self.adb("shell", "settings", "put", "system", "user_rotation", "0")
        self.adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        self.adb("shell", "wm", "dismiss-keyguard")
        self.adb("shell", "am", "start", "-W", "-n", f"{APP}/.MainActivity")
        self.tap("Try test mode")
        self.find("What would you like to build?")
        self.save("composer")

        self.tap("Choose model,", prefix=True)
        self.find("Search models in selected tab")
        self.save("models")
        self.tap("Done")

        self.show_sessions()
        self.save("sessions")
        self.tap("Settings")
        self.find("Acknowledgements")
        self.save("settings")
        self.tap("Done")

        self.tap("A quieter workspace")
        self.find("Sample interface changes")
        self.save("conversation")
        self.tap("Message")
        self.adb("shell", "input", "text", "Polish%sthe%sspacing")
        self.adb("shell", "input", "keyevent", "KEYCODE_BACK")
        self.tap("Send message")
        self.show_completed_changes()
        self.save("changed-files-card")
        self.tap("Show all…")
        self.find("Changed files")
        self.save("changed-files")
        self.tap("Sources/Composer.swift")
        self.find("Changed section,", prefix=True)
        self.save("diff")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=720)
    args = parser.parse_args()
    apks = list(args.apk_directory.rglob("*.apk"))
    if len(apks) != 1:
        raise RuntimeError(f"Expected exactly one debug APK, found {len(apks)}")
    args.output.mkdir(parents=True, exist_ok=True)
    capture = Capture(args.output, args.timeout)
    failures = []
    with apks[0].open("rb") as source:
        apk_hash = hashlib.file_digest(source, "sha256").hexdigest()
    metadata = {"apk": apks[0].name, "package": APP, "sha256": apk_hash,
                "apiLevel": capture.adb("shell", "getprop", "ro.build.version.sdk").strip(),
                "sourceHead": os.environ.get("SOURCE_HEAD"),
                "scope": "Actual demo UI only; no login, host, tests, benchmarks, or image editing"}
    (args.output / "apk.json").write_text(json.dumps(metadata, indent=2) + "\n")
    capture.adb("install", "-r", str(apks[0]), timeout=90)
    try:
        for mode, width, height, density in (("phone", 1080, 1920, 420), ("tablet", 1920, 1200, 240)):
            try:
                capture.layout(mode, width, height, density)
            except Exception as error:
                failures.append({"layout": mode, "error": str(error)})
                print(f"Capture failed for {mode}: {error}", flush=True)
    finally:
        (args.output / "capture-results.json").write_text(json.dumps({
            "captures": capture.results, "failures": failures,
            "passed": not failures and len(capture.results) == 16
        }, indent=2) + "\n")
        try:
            (args.output / "android-runtime-errors.txt").write_text(capture.adb("logcat", "-d", "-s", "AndroidRuntime:E"))
            capture.adb("shell", "am", "force-stop", APP)
            capture.adb("shell", "wm", "size", "reset")
            capture.adb("shell", "wm", "density", "reset")
        except Exception:
            pass
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
