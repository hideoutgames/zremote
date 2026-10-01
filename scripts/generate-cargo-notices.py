#!/usr/bin/env python3
"""Resolve actual mobile dependency graphs and bundle their license texts.

Run after cargo fetch/build, before application resource bundling. Fails closed
on a missing license: the inventory must not silently omit a shipped dependency.
No network calls apart from cargo metadata's ordinary locked dependency fetch.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def reachable_packages(metadata):
    packages = {p["id"]: p for p in metadata["packages"]}
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    root = next(p["id"] for p in metadata["packages"] if p["name"] == "zeron-mobile")
    pending, visited = [root], set()
    while pending:
        package_id = pending.pop()
        if package_id in visited:
            continue
        visited.add(package_id)
        # Build-time dependencies are included; unrelated workspace tests are not.
        for edge in nodes[package_id]["deps"]:
            if any(kind.get("kind") != "dev" for kind in edge["dep_kinds"]):
                pending.append(edge["pkg"])
    return [packages[package_id] for package_id in visited]


def license_paths(package, core, overrides):
    base = Path(package["manifest_path"]).parent
    paths = []
    declared = package.get("license_file")
    if declared:
        paths.append(base / declared)
    # Cargo preserves repository license files in the published package.
    for directory in (base, base / "licenses", base / "LICENSES"):
        if directory.is_dir():
            paths += [p for p in directory.iterdir() if p.is_file()
                      and re.match(r"^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)(?:[._-]|$)", p.name, re.I)]
    if not package.get("source"):
        paths.append(core / "LICENSE")
    key = package["name"] + "@" + package["version"]
    for relative in overrides.get(key, []):
        license_root = core.parent / "licenses"
        candidate = (core.parent.parent / relative).resolve()
        if not candidate.is_relative_to(license_root.resolve()):
            raise ValueError("License override escaped its source directory")
        paths.append(candidate)
    return sorted(set(p.resolve() for p in paths if p.is_file()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", action="append", default=[])
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    core = root / "native" / "core"
    resources = root / "Sources" / "ZRemote" / "Resources"
    overrides_path = root / "native" / "licenses" / "overrides.json"
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    packages = {}
    for target in args.target or ["aarch64-apple-ios", "aarch64-linux-android", "x86_64-linux-android"]:
        output = subprocess.check_output([
            "cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", target,
            "--manifest-path", str(core / "Cargo.toml")], text=True)
        for package in reachable_packages(json.loads(output)):
            packages[package["id"]] = package
    inventory, outputs, missing = [], {}, []
    for package in sorted(packages.values(), key=lambda p: (p["name"], p["version"], p["id"])):
        paths = license_paths(package, core, overrides)
        if not paths:
            missing.append(f'{package["name"]}@{package["version"]}: {package.get("license")}')
            continue
        # Cargo's path-package IDs contain the machine's absolute checkout path.
        # Resource names must remain identical on developer machines and CI.
        identity = "|".join((package.get("source") or "vendored-zeron", package["name"], package["version"]))
        digest = hashlib.sha256(identity.encode()).hexdigest()[:10]
        filename = f'Cargo-{package["name"]}-{package["version"]}-{digest}.txt'
        sections = [f'{package["name"]} {package["version"]}\nLicense: {package.get("license") or "See text"}']
        for path in paths:
            sections.append(path.name + "\n\n" + path.read_text(encoding="utf-8", errors="strict"))
        outputs[filename] = "\n\n".join(sections) + "\n"
        inventory.append({
            "id": f'cargo:{package["name"]}@{package["version"]}:{digest}',
            "name": package["name"], "version": package["version"],
            "source": package.get("repository") or (
                f'https://crates.io/crates/{package["name"]}/{package["version"]}'
                if package.get("source") else "https://github.com/zeronsh/zeron"),
            "licenseFiles": [filename],
        })
    if missing:
        raise SystemExit("Missing Cargo license files; review before bundling:\n" + "\n".join(missing))
    licenses = resources / "Licenses"
    licenses.mkdir(parents=True, exist_ok=True)
    for filename, body in outputs.items():
        (licenses / filename).write_text(body, encoding="utf-8")
    # Prune only this generator's named text resources after successful resolution.
    for stale in licenses.glob("Cargo-*.txt"):
        if stale.name not in outputs and stale.is_file():
            stale.unlink()
    # Only replace the inventory after every license was found and written.
    manifest = resources / "CargoAcknowledgements.json"
    manifest.write_text(json.dumps(inventory, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    evidence = resources / "CargoDependencies.json"
    evidence.write_text(json.dumps([
        {"name": p["name"], "version": p["version"]}
        for p in sorted(packages.values(), key=lambda p: (p["name"], p["version"], p["id"]))
    ], indent=2) + "\n", encoding="utf-8")
    print(f"Bundled {len(inventory)} resolved Cargo dependencies and their full license texts.")


if __name__ == "__main__":
    main()
