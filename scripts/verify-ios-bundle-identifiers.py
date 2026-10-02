#!/usr/bin/env python3
"""Check the app identity and reject duplicate embedded bundle identifiers."""
from __future__ import annotations

import argparse
from pathlib import Path
import plistlib
import sys


def identifier(plist: Path) -> str | None:
    with plist.open("rb") as source:
        value = plistlib.load(source).get("CFBundleIdentifier")
    if value is not None and (not isinstance(value, str) or not value):
        raise ValueError(f"Invalid CFBundleIdentifier in {plist}")
    return value


def verify(app: Path, expected_id: str) -> None:
    if app.suffix != ".app" or not app.is_dir():
        raise ValueError(f"Expected an application bundle: {app}")
    actual_id = identifier(app / "Info.plist")
    if actual_id != expected_id:
        raise ValueError(f"Expected app identifier {expected_id}, found {actual_id}")
    bundles: dict[str, Path] = {}
    for plist in sorted(app.rglob("Info.plist")):
        if plist.parent.suffix not in {".app", ".appex", ".framework", ".bundle"}:
            continue
        bundle_id = identifier(plist)
        if bundle_id is None:
            continue
        if bundle_id in bundles:
            raise ValueError(
                f"Duplicate CFBundleIdentifier {bundle_id}: "
                f"{bundles[bundle_id].relative_to(app)} and {plist.parent.relative_to(app)}"
            )
        bundles[bundle_id] = plist.parent
    print(f"Verified {len(bundles)} unique bundle identifiers; app: {actual_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--expected-id", required=True)
    args = parser.parse_args()
    try:
        verify(args.app, args.expected_id)
    except (OSError, ValueError, plistlib.InvalidFileException) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
