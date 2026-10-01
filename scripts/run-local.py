"""Serialize native builds across ZRemote worktrees with FIFO admission."""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
BASE = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".cache"))) / "ZRemote"
CONFIG = Path(os.environ.get("ZREMOTE_RESOURCE_CONFIG", str(BASE / "local-resources.json")))


def alive(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return ctypes.get_last_error() == 5
    try:
        result = ctypes.c_ulong()
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(result))) and result.value == 259
    finally:
        kernel.CloseHandle(handle)


def available_mb() -> int:
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong) for name in
                ("total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended")
            ]
        value = MemoryStatus()
        value.length = ctypes.sizeof(value)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
            raise OSError("Could not read available physical memory")
        return value.available // 1024**2
    if sys.platform == "linux":
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    if sys.platform == "darwin":
        output = subprocess.check_output(["vm_stat"], text=True)
        page_size = int(output.split("page size of ")[1].split()[0])
        counts = {}
        for line in output.splitlines()[1:]:
            if ":" in line:
                key, count = line.split(":", 1)
                counts[key] = int(count.strip().rstrip("."))
        return sum(counts.get(key, 0) for key in ("Pages free", "Pages inactive", "Pages speculative")) * page_size // 1024**2
    raise RuntimeError("Cannot determine available memory on this platform")


@contextlib.contextmanager
def locked_state():
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / "admission.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            state_path = BASE / "admission.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {"queue": [], "active": None}
            yield state
            temporary = state_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(state), encoding="utf-8")
            temporary.replace(state_path)
        finally:
            lock.seek(0)
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def source_digest(phase: str, core_only: bool) -> str:
    digest = hashlib.sha256()
    folders = [] if phase == "rust" else [ROOT / "scripts"]
    names = ["scripts/run-local.py", "scripts/build-native-core.sh", "scripts/generate-cargo-notices.py", "scripts/rust-environment.ps1", "scripts/build-core-bindings.ps1", "scripts/normalize-native-bindings.py"] if phase == "rust" else ["Package.swift"]
    if phase in ("rust", "android", "ios"):
        folders.append(ROOT / "native" / "core" / "crates")
        names += ["native/core/Cargo.toml", "native/core/Cargo.lock"]
    if phase != "rust":
        folders += [ROOT / "Sources" / "ZRemoteCore", ROOT / "Tests" / "ZRemoteCoreTests"] if core_only else [ROOT / "Sources", ROOT / "Tests"]
    if phase in ("android", "ios"):
        folders += [ROOT / "Android" / "app" / "src", ROOT / "Darwin"]
    for folder in folders:
        if folder.exists():
            for path in sorted(folder.rglob("*")):
                if "Generated" in path.parts or "Assets.xcassets" in path.parts:
                    continue
                if path.is_file() and path.suffix in (".swift", ".rs", ".toml", ".h", ".c", ".py", ".sh", ".ps1", ".kt", ".kts", ".plist", ".xcconfig", ".pbxproj", ".yml"):
                    digest.update(str(path.relative_to(ROOT)).encode())
                    digest.update(path.read_bytes())
    for name in names:
        path = ROOT / name
        if path.exists():
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def provenance(phase: str, command: list[str], environment: dict[str, str]) -> dict:
    # Record identities, never environment values or arguments (which may contain secrets).
    keys = ("PATH", "SDKROOT", "DEVELOPER_DIR", "SWIFTFLAGS", "RUSTFLAGS", "RUSTUP_HOME", "CARGO_HOME", "JAVA_HOME", "ANDROID_HOME", "ANDROID_NDK_HOME", "INCLUDE", "LIB", "ZREMOTE_CORE_ONLY")
    environment_hash = hashlib.sha256(json.dumps({key: environment.get(key) for key in keys}, sort_keys=True).encode()).hexdigest()[:16]
    names = [command[0]] + {"rust": ["rustc", "cargo"], "swift": ["swiftc", "swift"], "android": ["swiftc", "java", "gradle", "skip"], "ios": ["swiftc", "xcodebuild", "skip"]}[phase]
    binaries = {}
    for name in names:
        executable = shutil.which(name, path=environment.get("PATH"))
        if executable:
            path = Path(executable).resolve()
            stat = path.stat()
            binaries[name] = {"path": str(path), "size": stat.st_size, "modifiedNS": stat.st_mtime_ns}
    if command[0] not in binaries:
        raise RuntimeError(f"Executable not found: {command[0]}")
    return {"source": source_digest(phase, environment.get("ZREMOTE_CORE_ONLY") == "1"), "environment": environment_hash, "toolchains": binaries}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True, choices=("rust", "swift", "android", "ios"))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("Provide an explicit scoped command after --")
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    if not CONFIG.exists():
        try:
            with CONFIG.open("x", encoding="utf-8") as file:
                json.dump({"profile": "shared", "minimumAvailableMB": 3072, "maximumQueueSeconds": 1800}, file, indent=2)
        except FileExistsError:
            pass
    config = json.loads(CONFIG.read_text())
    if config.get("profile") != "shared":
        raise RuntimeError("This runner requires the shared resource profile")
    ticket = {"id": str(uuid.uuid4()), "pid": os.getpid(), "workspace": str(ROOT), "phase": args.phase, "created": time.time()}
    started = time.monotonic()
    last_notice = -60.0
    with locked_state() as state:
        state["queue"].append(ticket)
    try:
        while True:
            admitted = False
            with locked_state() as state:
                state["queue"] = [item for item in state["queue"] if alive(item["pid"])]
                if state["active"] and not alive(state["active"]["pid"]):
                    child = state["active"].get("childPid")
                    if child is None or not alive(child):
                        state["active"] = None
                if state["active"] is None and state["queue"] and state["queue"][0]["id"] == ticket["id"]:
                    if available_mb() >= int(config["minimumAvailableMB"]):
                        state["queue"].pop(0)
                        state["active"] = ticket
                        admitted = True
            if admitted:
                break
            elapsed = time.monotonic() - started
            if elapsed >= int(config["maximumQueueSeconds"]):
                raise RuntimeError("Timed out waiting for shared build admission; no other process was stopped")
            if elapsed - last_notice >= 30:
                print(f"Waiting for shared {args.phase} admission ({int(elapsed)}s)", flush=True)
                last_notice = elapsed
            time.sleep(2)
        environment = os.environ.copy()
        environment.update({"CARGO_BUILD_JOBS": "1", "CARGO_TARGET_DIR": str(BASE / "cache" / "cargo"),
                            "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0",
                            "GRADLE_USER_HOME": str(BASE / "cache" / "gradle"), "ZREMOTE_RESOURCE_PROFILE": "shared"})
        before = provenance(args.phase, command, environment)
        print(f"Admitted {args.phase}: workers=1 source={before['source']} environment={before['environment']} executable={before['toolchains'][command[0]]['path']}", flush=True)
        child = subprocess.Popen(command, env=environment)
        with locked_state() as state:
            state["active"]["childPid"] = child.pid
        try:
            code = child.wait()
        except KeyboardInterrupt:
            # The terminal already delivered the interrupt to our process group.
            # Keep admission until our child has exited; do not stop other agents.
            code = child.wait()
        after = provenance(args.phase, command, environment)
        stable = before == after
        results = BASE / "results"
        results.mkdir(parents=True, exist_ok=True)
        result_path = results / f"{ticket['id']}.json"
        result_path.write_text(json.dumps({"phase": args.phase, "workspace": str(ROOT), "exitCode": code, "inputsStable": stable, "before": before, "after": after}, indent=2), encoding="utf-8")
        print(f"Finished {args.phase}: exit={code} inputsStable={stable} result={result_path}", flush=True)
        if not stable:
            print("Source, environment, or toolchain changed during this check; its result is stale.", file=sys.stderr)
            return code or 86
        return code
    finally:
        with locked_state() as state:
            state["queue"] = [item for item in state["queue"] if item["id"] != ticket["id"]]
            if state["active"] and state["active"]["id"] == ticket["id"]:
                child_pid = state["active"].get("childPid")
                if child_pid is None or not alive(child_pid):
                    state["active"] = None


if __name__ == "__main__":
    sys.exit(main())
