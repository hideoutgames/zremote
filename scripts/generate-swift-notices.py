#!/usr/bin/env python3
"""Bundle notices from the actual resolved Swift source checkouts, without network calls."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def pins_from(path: Path) -> list[dict]:
    value = json.loads(path.read_text(encoding="utf-8"))
    return value.get("pins", value.get("object", {}).get("pins", []))


def notice_sources(checkout: Path) -> list[Path]:
    sources: set[Path] = set()
    for path in checkout.iterdir():
        name = path.name.lower()
        if path.is_file() and name.startswith(("license", "copying", "notice", "third_party", "third-party")):
            sources.add(path)
        elif path.is_dir() and name in ("licenses", "notices"):
            sources.update(child for child in path.rglob("*") if child.is_file())
    return sorted(sources)


def generate(resolved: Path, checkouts: Path, output: Path) -> None:
    pins = pins_from(resolved)
    if not pins:
        raise ValueError("Swift Package.resolved has no pins; resolve the application dependency graph first")
    manifest: list[dict] = []
    resources: dict[str, str] = {}
    for pin in pins:
        identity = pin.get("identity") or pin.get("package", "").lower()
        state = pin["state"]
        revision = state.get("revision", "")
        version = state.get("version") or revision
        location = pin.get("location") or pin.get("repositoryURL", "")
        checkout = checkouts / identity
        if not checkout.is_dir():
            raise ValueError(f"Resolved checkout missing: {identity}")
        actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
        if not revision or actual != revision:
            raise ValueError(f"Checkout revision does not match Package.resolved: {identity}")
        sources = notice_sources(checkout)
        if not sources:
            raise ValueError(f"No source license/notice found for {identity}; review this dependency")
        license_files: list[str] = []
        for index, source in enumerate(sources):
            text = source.read_text(encoding="utf-8-sig").strip()
            if not text:
                raise ValueError(f"Empty license resource: {source}")
            safe = re.sub(r"[^a-zA-Z0-9._-]", "-", identity)
            filename = f"Swift-{safe}-{index + 1}.txt"
            resources[filename] = text + "\n"
            license_files.append(filename)
        manifest.append({"id": f"swift:{identity}@{version}", "name": identity,
                         "version": version, "revision": revision, "source": location.removesuffix(".git"),
                         "licenseFiles": license_files})
    # Audit every dependency before publishing any generated manifest.
    licenses = output / "Licenses"
    licenses.mkdir(parents=True, exist_ok=True)
    for filename, text in resources.items():
        (licenses / filename).write_text(text, encoding="utf-8")
    temporary = output / "SwiftAcknowledgements.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(output / "SwiftAcknowledgements.json")
    print(f"Bundled notices for {len(manifest)} resolved Swift packages")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resolved", type=Path, default=Path("Package.resolved"))
    parser.add_argument("--checkouts", type=Path, default=Path(".build/checkouts"))
    parser.add_argument("--output", type=Path, default=Path("Sources/ZRemote/Resources"))
    args = parser.parse_args()
    generate(args.resolved, args.checkouts, args.output)


if __name__ == "__main__":
    main()
