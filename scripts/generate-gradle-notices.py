#!/usr/bin/env python3
"""Bundle licenses from Gradle's resolved runtime artifacts and POM declarations.

Does not fetch arbitrary POM URLs. A missing source license fails generation.
An explicit Apache-2.0 POM declaration may use the reviewed bundled standard text.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


MAX_NOTICE_BYTES = 2 * 1024 * 1024
MAX_NESTED_ARCHIVE_BYTES = 64 * 1024 * 1024


def archive_notices(path: Path) -> list[tuple[str, str, bool]]:
    if not path.is_file():
        raise ValueError(f"Resolved Gradle artifact missing: {path}")
    if not zipfile.is_zipfile(path):
        raise ValueError(f"Unrecognized runtime artifact: {path}")
    found: list[tuple[str, str, bool]] = []

    def read_archive(archive: zipfile.ZipFile, prefix: str, nested: bool) -> None:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            basename = Path(entry.filename).name.lower()
            if basename.startswith(("license", "copying", "notice")) and not basename.endswith((".class", ".kotlin_metadata")):
                if entry.file_size > MAX_NOTICE_BYTES:
                    raise ValueError(f"License resource unexpectedly large: {path}!{entry.filename}")
                text = archive.read(entry).decode("utf-8-sig").strip()
                if not text:
                    raise ValueError(f"Empty artifact notice: {path}!{entry.filename}")
                full_license = basename.startswith(("license", "copying")) and len(text) > 200
                found.append((prefix + entry.filename, text, full_license))
            elif not nested and (entry.filename == "classes.jar" or entry.filename.startswith("libs/") and entry.filename.endswith(".jar")):
                if entry.file_size > MAX_NESTED_ARCHIVE_BYTES:
                    raise ValueError(f"Nested AAR archive too large to audit: {path}!{entry.filename}")
                with zipfile.ZipFile(io.BytesIO(archive.read(entry))) as child:
                    read_archive(child, entry.filename + "!", True)

    with zipfile.ZipFile(path) as archive:
        read_archive(archive, "", False)
    return found


def pom_info(path: Path | None) -> tuple[str, bool, str]:
    if path is None:
        return ("", False, "")
    root = ET.fromstring(path.read_text(encoding="utf-8-sig"))
    declarations: list[tuple[str, str]] = []
    for node in root.findall("./{*}licenses/{*}license"):
        declarations.append(((node.findtext("{*}name") or "").strip(), (node.findtext("{*}url") or "").strip()))
    apache_names = {"apache-2.0", "apache 2.0", "apache license, version 2.0", "the apache software license, version 2.0"}

    def apache(declaration: tuple[str, str]) -> bool:
        name, url = declaration
        return name.lower() in apache_names or bool(re.fullmatch(r"https?://(?:www\.)?apache\.org/licenses/LICENSE-2\.0(?:\.txt)?/?", url))

    is_apache = bool(declarations) and all(apache(declaration) for declaration in declarations)
    details = "\n".join(f"Declared license: {name}\nLicense source: {url}" for name, url in declarations)
    source = (root.findtext("./{*}url") or "").strip()
    return (details, is_apache, source)


def generate(inventory: Path, output: Path) -> None:
    artifacts = json.loads(inventory.read_text(encoding="utf-8"))
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("Gradle runtime dependency inventory is empty")
    grouped: dict[tuple[str, str], list[dict]] = {}
    for artifact in artifacts:
        grouped.setdefault((artifact["name"], artifact["version"]), []).append(artifact)
    manifest: list[dict] = []
    texts: dict[str, str] = {}
    for (name, version), entries in sorted(grouped.items()):
        sections = [f"{name} {version}"]
        source = ""
        licensed = False
        for entry in entries:
            notices = archive_notices(Path(entry["artifactPath"]))
            licensed = licensed or any(full for _, _, full in notices)
            for label, text, _ in notices:
                sections.append(label + "\n\n" + text)
            details, apache, source_url = pom_info(Path(entry["pomPath"]) if entry.get("pomPath") else None)
            if details:
                sections.append(details)
            if apache:
                standard = output / "Licenses" / "Apache-2.0.txt"
                sections.append(standard.read_text(encoding="utf-8"))
                licensed = True
            if source_url.startswith("https://"):
                source = source_url
        if not licensed:
            raise ValueError(f"No full source license for {name}@{version}; supply a reviewed artifact/source notice")
        group, artifact = name.split(":", 1)
        if not source:
            source = f"https://central.sonatype.com/artifact/{group}/{artifact}/{version}"
        digest = hashlib.sha256(f"{name}@{version}".encode()).hexdigest()[:12]
        filename = f"Gradle-{re.sub(r'[^a-zA-Z0-9._-]', '-', artifact)}-{digest}.txt"
        texts[filename] = "\n\n".join(dict.fromkeys(sections)) + "\n"
        manifest.append({"id": f"gradle:{name}@{version}", "name": name, "version": version,
                         "source": source, "licenseFiles": [filename]})
    license_dir = output / "Licenses"
    license_dir.mkdir(parents=True, exist_ok=True)
    for filename, body in texts.items():
        (license_dir / filename).write_text(body, encoding="utf-8")
    evidence = [{"name": name, "version": version} for name, version in sorted(grouped)]
    for filename, data in (("GradleAcknowledgements.json", manifest), ("GradleDependencies.json", evidence)):
        temporary = output / (filename + ".tmp")
        temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(output / filename)
    print(f"Bundled notices for {len(manifest)} resolved Gradle runtime dependencies")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=Path("Android/build/reports/runtime-dependencies.json"))
    parser.add_argument("--output", type=Path, default=Path("Sources/ZRemote/Resources"))
    args = parser.parse_args()
    generate(args.inventory, args.output)


if __name__ == "__main__":
    main()
