#!/usr/bin/env python3
"""Install generated UniFFI source for Apple and Android's common C ABI."""
import argparse
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--generated", type=Path, default=root / "native/artifacts/generated")
    generated = parser.parse_args().generated
    destinations = {
        "zeron_core.swift": root / "Sources/ZRemoteNative/Generated/zeron_core.swift",
        "zeron_coreFFI.h": root / "native/ffi/include/zeron_coreFFI.h",
        "zeron_coreFFI.modulemap": root / "native/ffi/include/module.modulemap",
    }
    for name, destination in destinations.items():
        lines = (generated / name).read_text(encoding="utf-8").splitlines()
        if name.endswith(".modulemap"):
            # UniFFI's default Swift module map names Apple's umbrella module.
            # The generated C header uses only stdint/stdbool on every platform.
            lines = [line for line in lines if line.strip() != 'use "Darwin"']
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("\n".join(line.rstrip() for line in lines).rstrip() + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
