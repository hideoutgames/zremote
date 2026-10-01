"""Assemble an exact Skip export on Windows using the matching APK's native code.

Dot-source android-environment.ps1 first. Native Swift/Rust compilation remains
on the Mac build machine; Kotlin, Android resources, dex and APK assembly run here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REPO = "hideoutgames/zremote"
BASE = Path(os.environ.get("LOCALAPPDATA", "")) / "ZRemote" / "exports"


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def command(*args: str, timeout: int = 120) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def zip_files(archive: zipfile.ZipFile, prefix: str) -> dict[str, str]:
    values = {}
    for entry in archive.infolist():
        if entry.filename.startswith(prefix) and not entry.is_dir():
            with archive.open(entry) as source:
                values[entry.filename] = hashlib.file_digest(source, "sha256").hexdigest()
    return values


def prepare(run_id: str, expected: str) -> Path:
    run = json.loads(command("gh", "api", f"repos/{REPO}/actions/runs/{run_id}"))
    if run["status"] != "completed" or run["head_sha"] != expected:
        raise RuntimeError("Build run is unfinished or its source SHA does not match")
    if run["head_repository"]["full_name"].lower() != REPO:
        raise RuntimeError("Build run belongs to another source repository")
    artifacts = json.loads(command("gh", "api", f"repos/{REPO}/actions/runs/{run_id}/artifacts"))["artifacts"]
    selected = {}
    for name in ("zremote-debug-apk", "zremote-standalone-sources"):
        matches = [item for item in artifacts if item["name"] == name and not item["expired"]]
        if len(matches) != 1 or matches[0]["workflow_run"]["head_sha"] != expected:
            raise RuntimeError(f"Missing, expired, ambiguous or mismatched artifact: {name}")
        selected[name] = {key: matches[0].get(key) for key in ("id", "name", "digest")}
    work = BASE / f"{run_id}-{expected[:12]}-{uuid.uuid4().hex[:8]}"
    work.mkdir(parents=True)
    for name in selected:
        command("gh", "run", "download", run_id, "--repo", REPO, "--name", name,
                "--dir", str(work / name), timeout=900)
    apks = list((work / "zremote-debug-apk").rglob("*.apk"))
    exports = list((work / "zremote-standalone-sources").rglob("ZRemote-project.zip"))
    if len(apks) != 1 or len(exports) != 1:
        raise RuntimeError("Expected one debug APK and one ZRemote-project.zip")
    (work / "source.json").write_text(json.dumps({
        "repository": REPO, "runID": run_id, "sourceHead": expected, "url": run["html_url"],
        "artifacts": selected, "apk": str(apks[0].relative_to(work)), "apkSHA256": digest(apks[0]),
        "export": str(exports[0].relative_to(work)), "exportSHA256": digest(exports[0]),
    }, indent=2) + "\n", encoding="utf-8")
    return work


def extract(archive_path: Path, destination: Path):
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            parts = PurePosixPath(entry.filename.replace("\\", "/")).parts
            if not parts or any(part in ("..", "/") or ":" in part for part in parts):
                raise RuntimeError("Unsafe path in standalone export")
            target = destination.joinpath(*parts)
            if not target.resolve().is_relative_to(destination.resolve()):
                raise RuntimeError("Export path escapes its destination")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)


def source_digest(project: Path) -> str:
    result = hashlib.sha256()
    # Gradle outputs are mutable; prebuilt JNI contents are audited separately.
    for path in sorted(project.rglob("*")):
        relative = path.relative_to(project)
        if not path.is_file() or any(part in ("build", ".gradle", ".kotlin", ".build", ".git") for part in relative.parts):
            continue
        result.update(relative.as_posix().encode())
        result.update(bytes.fromhex(digest(path)))
    return result.hexdigest()


def assemble(work: Path, run_id: str, expected: str) -> int:
    if os.environ.get("ZREMOTE_RESOURCE_PROFILE") != "shared":
        raise RuntimeError("Local assembly must run through scripts/run-local.py")
    if not work.resolve().is_relative_to(BASE.resolve()):
        raise RuntimeError("Prepared artifacts must remain in the user-local export directory")
    metadata = json.loads((work / "source.json").read_text(encoding="utf-8"))
    if metadata["sourceHead"] != expected or metadata["runID"] != run_id:
        raise RuntimeError("Prepared artifact provenance mismatch")
    apk, export = work / metadata["apk"], work / metadata["export"]
    if digest(apk) != metadata["apkSHA256"] or digest(export) != metadata["exportSHA256"]:
        raise RuntimeError("Downloaded artifacts changed before assembly")
    project = work / "project" / "ZRemote"
    extract(export, project.parent)
    android = project / "Android"
    settings = (android / "settings.gradle.kts").read_text(encoding="utf-8")
    if "skip plugin --prebuild" in settings or 'id("skip-plugin")' in settings:
        raise RuntimeError("Export still requires the macOS Skip prebuild plugin")
    module = project / "ZRemote"
    module_build = (module / "build.gradle.kts").read_text(encoding="utf-8")
    if 'jniLibs.srcDir("${swiftBuildFolder()}/jni-libs")' not in module_build:
        raise RuntimeError("Native staging path differs from the verified SkipBridge layout")
    if "SKIP_BRIDGE_ANDROID_BUILD_DISABLED" not in module_build:
        raise RuntimeError("Generated SkipBridge native-build disable guard is missing")

    with zipfile.ZipFile(apk) as source_apk:
        native = zip_files(source_apk, "lib/")
        assets = zip_files(source_apk, "assets/")
        for abi in ("arm64-v8a", "x86_64"):
            for name in ("libZRemote.so", "libzeron_mobile.so"):
                if f"lib/{abi}/{name}" not in native:
                    raise RuntimeError(f"Matching Mac APK lacks required {abi}/{name}")
        for name in native:
            path = PurePosixPath(name)
            if len(path.parts) != 3 or path.parts[1] not in ("arm64-v8a", "x86_64") or not name.endswith(".so"):
                raise RuntimeError(f"Unexpected APK native entry: {name}")
            output = module / "build" / "jni-libs" / path.parts[1] / path.parts[2]
            output.parent.mkdir(parents=True, exist_ok=True)
            with source_apk.open(name) as source, output.open("wb") as target:
                shutil.copyfileobj(source, target)

    # Only the supplied native outputs are reused. All Kotlin, resource, dex and
    # packaging tasks remain enabled. This also protects against new upstream
    # task wiring that bypasses the existing SkipBridge dependency guard.
    init = work / "prebuilt-native.init.gradle"
    init.write_text("""gradle.projectsEvaluated {
    gradle.rootProject.allprojects {
        tasks.matching { it.name in ['buildAndroidSwiftPackageDebug', 'buildAndroidSwiftPackageRelease'] }.configureEach {
            enabled = false
        }
    }
}
""", encoding="utf-8")
    gradle = shutil.which("gradle")
    if not gradle or not os.environ.get("JAVA_HOME") or not os.environ.get("ANDROID_HOME"):
        raise RuntimeError("Dot-source scripts/android-environment.ps1 before assembly")
    # An export can contain the build machine's local SDK path. Keep this change
    # inside the isolated export; project source and release settings are untouched.
    local = android / "local.properties"
    properties = local.read_text(encoding="utf-8").splitlines() if local.exists() else []
    properties = [line for line in properties if not re.match(r"\s*(sdk|ndk)\.dir\s*[=:]", line)]
    properties.append("sdk.dir=" + Path(os.environ["ANDROID_HOME"]).as_posix())
    local.write_text("\n".join(properties) + "\n", encoding="utf-8")
    env = os.environ.copy()
    env["SKIP_BRIDGE_ANDROID_BUILD_DISABLED"] = "1"
    env["ANDROID_SDK_ROOT"] = env["ANDROID_HOME"]
    env["GRADLE_USER_HOME"] = str(BASE.parent / "cache" / "gradle")
    before = source_digest(project)
    report = {**metadata, "platform": "Windows Kotlin/resources/dex/APK assembly with Mac-built Swift/Rust",
              "project": str(project), "sourceDigestBefore": before, "nativeLibraries": native,
              "gradleVersion": command(gradle, "--version"), "helperSHA256": digest(Path(__file__)), "workers": 1,
              "gradleHeapMB": 1536, "gradleMetaspaceMB": 384}
    print(f"Assembling exact source {expected} in {android}", flush=True)
    args = [gradle, "--project-dir", str(android), "--no-daemon", "--max-workers=1", "--console=plain",
            "-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m",
            "-Pkotlin.compiler.execution.strategy=in-process", "-Dorg.gradle.parallel=false",
            "--init-script", str(init), ":app:assembleDebug"]
    started = time.monotonic()
    with (work / "windows-assemble.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env)
        try:
            code = process.wait(timeout=3600)
        except subprocess.TimeoutExpired:
            # Terminate only this command and its own descendants, never other builds.
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=30)
            code = 124
    report.update({"exitCode": code, "elapsedSeconds": round(time.monotonic() - started, 2),
                   "sourceDigestAfter": source_digest(project)})
    report["inputsStable"] = before == report["sourceDigestAfter"] and digest(apk) == metadata["apkSHA256"] and digest(export) == metadata["exportSHA256"]
    if code == 0:
        outputs = list((android / "app" / "build" / "outputs" / "apk" / "debug").glob("*.apk"))
        if len(outputs) != 1:
            raise RuntimeError("Gradle finished but did not produce exactly one debug APK")
        with zipfile.ZipFile(outputs[0]) as built:
            report["nativeLibrariesMatch"] = zip_files(built, "lib/") == native
            report["assetsMatch"] = zip_files(built, "assets/") == assets
        report.update({"localAPK": str(outputs[0]), "localAPKSHA256": digest(outputs[0])})
    report["passed"] = code == 0 and report["inputsStable"] and report.get("nativeLibrariesMatch") and report.get("assetsMatch")
    (work / "windows-assembly.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Windows assembly passed={bool(report['passed'])}; evidence: {work / 'windows-assembly.json'}", flush=True)
    return 0 if report["passed"] else code or 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-run-id", required=True)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--prepared", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("This helper validates local Windows assembly")
    if not re.fullmatch(r"[0-9]+", args.build_run_id) or not re.fullmatch(r"[0-9a-f]{40}", args.expected_head):
        parser.error("Provide the numeric build run ID and exact lowercase 40-character source SHA")
    if args.prepared:
        return assemble(args.prepared, args.build_run_id, args.expected_head)
    work = prepare(args.build_run_id, args.expected_head)
    print(f"Downloaded exact-head artifacts: {work}", flush=True)
    return subprocess.call([sys.executable, str(ROOT / "scripts" / "run-local.py"), "--phase", "android", "--",
                            sys.executable, str(Path(__file__).resolve()), "--build-run-id", args.build_run_id,
                            "--expected-head", args.expected_head, "--prepared", str(work)])


if __name__ == "__main__":
    raise SystemExit(main())
