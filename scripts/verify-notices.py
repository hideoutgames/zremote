#!/usr/bin/env python3
"""Fail builds with missing, empty, stale, or incomplete dependency notices."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def read_list(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"Expected an array: {path}")
    return data


def verify(resources: Path, resolved: Path, required: set[str]) -> None:
    names = {"swift": "Swift", "cargo": "Cargo", "gradle": "Gradle"}
    unknown = required - names.keys()
    if unknown:
        raise ValueError(f"Unknown dependency ecosystem: {', '.join(sorted(unknown))}")
    manifests = {"base": read_list(resources / "Acknowledgements.json")}
    for ecosystem, prefix in names.items():
        manifest = resources / f"{prefix}Acknowledgements.json"
        if ecosystem in required or manifest.exists():
            manifests[ecosystem] = read_list(manifest)
            if not manifests[ecosystem]:
                raise ValueError(f"Empty dependency inventory: {manifest}")
    for ecosystem, entries in manifests.items():
        ids: set[str] = set()
        for entry in entries:
            for field in ("id", "name", "version", "source", "licenseFiles"):
                if not entry.get(field):
                    raise ValueError(f"Missing {field} in {ecosystem} acknowledgement")
            if entry["id"] in ids:
                raise ValueError(f"Duplicate acknowledgement: {entry['id']}")
            ids.add(entry["id"])
            for filename in entry["licenseFiles"]:
                if not isinstance(filename, str) or Path(filename).name != filename or "/" in filename or "\\" in filename:
                    raise ValueError(f"Unsafe license resource path: {filename}")
                path = resources / "Licenses" / filename
                if not path.read_text(encoding="utf-8-sig").strip():
                    raise ValueError(f"Empty license resource: {filename}")
    if "swift" in required:
        lock = json.loads(resolved.read_text(encoding="utf-8"))
        pins = lock.get("pins", lock.get("object", {}).get("pins", []))
        if not pins:
            raise ValueError("Swift resolution has no pins")
        indexed = {entry["name"]: entry for entry in manifests["swift"]}
        for pin in pins:
            identity = pin.get("identity") or pin.get("package", "").lower()
            state = pin["state"]
            entry = indexed.get(identity)
            version = state.get("version") or state.get("revision")
            if not entry or entry["version"] != version or entry.get("revision") != state.get("revision"):
                raise ValueError(f"Missing or stale Swift acknowledgement: {identity}@{version}")
    for ecosystem in required - {"swift"}:
        prefix = names[ecosystem]
        dependencies = read_list(resources / f"{prefix}Dependencies.json")
        if not dependencies:
            raise ValueError(f"Empty resolved {ecosystem} graph")
        actual = {(entry["name"], entry["version"]) for entry in manifests[ecosystem]}
        expected = {(entry["name"], entry["version"]) for entry in dependencies}
        missing = expected - actual
        if missing:
            raise ValueError(f"Missing {ecosystem} acknowledgements: {sorted(missing)}")
    print("Dependency notices verified: " + (", ".join(sorted(required)) or "checked-in sources only"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, default=Path("Sources/ZRemote/Resources"))
    parser.add_argument("--resolved", type=Path, default=Path("Package.resolved"))
    parser.add_argument("--required", default="swift,cargo,gradle", help="Comma-separated ecosystems; empty validates checked-in resources only")
    args = parser.parse_args()
    verify(args.resources, args.resolved, {value for value in args.required.split(",") if value})


if __name__ == "__main__":
    main()
