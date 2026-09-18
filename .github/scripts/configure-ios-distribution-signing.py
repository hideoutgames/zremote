#!/usr/bin/env python3
"""Pin TestFlight app targets to Automatic + Apple Distribution.

Expo prebuild leaves ZRemote / ExpoWidgetsTarget on Automatic + Apple
Development. Passing CODE_SIGN_IDENTITY=Apple Distribution as an xcodebuild
xcarg then conflicts ("automatically signed for development") and leaks onto
CocoaPods. Switching those targets to Manual without a profile specifier
fails immediately: "requires a provisioning profile with the App Groups…"

Keep Automatic so -allowProvisioningUpdates can create/select App Store
profiles, but rewrite the generated app xcodeproj (never Pods) so the
targets themselves use Apple Distribution. xcodebuild must then NOT pass
CODE_SIGN_IDENTITY / CODE_SIGN_STYLE as workspace-wide xcargs, and must
NOT pass -allowProvisioningDeviceRegistration (that mints a new Apple
Development cert on every ephemeral runner until the 3-certificate cap).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Iterable

APP_PRODUCT_TYPES = (
    "com.apple.product-type.application",
    "com.apple.product-type.app-extension",
    "com.apple.product-type.widgetkit-extension",
)

ID_RE = r"[A-Fa-f0-9]{24}"
NATIVE_TARGET_RE = re.compile(
    r"(" + ID_RE + r") /\* ([^*]+) \*/ = \{\s*isa = PBXNativeTarget;"
)
PRODUCT_TYPE_RE = re.compile(r'productType = "([^"]+)";')
CONFIG_LIST_RE = re.compile(
    r"buildConfigurationList = (" + ID_RE + r") /\* [^*]+ \*/;"
)
CONFIG_LIST_BLOCK_RE = re.compile(
    r"(" + ID_RE + r") /\* [^*]+ \*/ = \{\s*isa = XCConfigurationList;"
)
BUILD_CONFIG_ID_RE = re.compile(r"(" + ID_RE + r") /\* [^*]+ \*/")
BUILD_CONFIG_BLOCK_RE = re.compile(
    r"(" + ID_RE + r") /\* [^*]+ \*/ = \{\s*isa = XCBuildConfiguration;"
)


def _block_body(text: str, header_start: int) -> tuple[str, int, int]:
    """Return (body_inside_braces, open_brace_index, close_brace_index)."""
    open_idx = text.find("{", header_start)
    if open_idx < 0:
        raise ValueError("expected '{' after object header")
    depth = 0
    i = open_idx
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i], open_idx, i
        i += 1
    raise ValueError("unbalanced braces in pbxproj")


def _iter_objects(text: str, header_re: re.Pattern[str]) -> Iterable[tuple[str, int, int, str]]:
    for match in header_re.finditer(text):
        body, open_idx, close_idx = _block_body(text, match.start())
        yield match.group(1), open_idx, close_idx, body


def _set_build_setting(settings: str, key: str, value: str) -> str:
    assignment = f"{key} = {value};"
    existing = re.compile(rf"^[ \t]*{re.escape(key)} = [^;]*;", re.M)
    if existing.search(settings):
        return existing.sub(
            lambda m: re.sub(r"= [^;]*;", f"= {value};", m.group(0)),
            settings,
            count=1,
        )
    indent_match = re.search(r"\n([ \t]+)\S", settings)
    indent = indent_match.group(1) if indent_match else "\t\t\t\t"
    trailing = re.search(r"\s*$", settings)
    insert_at = trailing.start() if trailing else len(settings)
    return settings[:insert_at] + f"\n{indent}{assignment}" + settings[insert_at:]


def _target_config_ids(text: str, list_id: str) -> list[str]:
    for obj_id, _open, _close, body in _iter_objects(text, CONFIG_LIST_BLOCK_RE):
        if obj_id != list_id:
            continue
        in_configs = False
        ids: list[str] = []
        for line in body.splitlines():
            if "buildConfigurations = (" in line:
                in_configs = True
                continue
            if in_configs:
                if ");" in line:
                    break
                found = BUILD_CONFIG_ID_RE.search(line)
                if found:
                    ids.append(found.group(1))
        return ids
    raise ValueError(f"XCConfigurationList {list_id} not found")


def _patch_target_attributes(text: str, target_ids: set[str], team_id: str) -> str:
    marker = "TargetAttributes = {"
    idx = text.find(marker)
    if idx < 0:
        return text
    body, open_idx, close_idx = _block_body(text, idx)
    patched = body
    for target_id in target_ids:
        target_header = re.search(
            rf"({re.escape(target_id)}) = \{{",
            patched,
        )
        if not target_header:
            continue
        inner, inner_open, inner_close = _block_body(patched, target_header.start())
        updated = inner
        indent_match = re.search(r"\n([ \t]+)\S", updated)
        indent = indent_match.group(1) if indent_match else "\t\t\t\t\t\t"
        if re.search(r"ProvisioningStyle = ", updated):
            updated = re.sub(
                r"ProvisioningStyle = \w+;",
                "ProvisioningStyle = Automatic;",
                updated,
            )
        else:
            updated = f"\n{indent}ProvisioningStyle = Automatic;" + updated
        if re.search(r"DevelopmentTeam = ", updated):
            updated = re.sub(
                r"DevelopmentTeam = \w+;",
                f"DevelopmentTeam = {team_id};",
                updated,
            )
        else:
            updated = f"\n{indent}DevelopmentTeam = {team_id};" + updated
        patched = patched[: inner_open + 1] + updated + patched[inner_close:]
    return text[: open_idx + 1] + patched + text[close_idx:]


def configure(text: str, team_id: str) -> tuple[str, list[str]]:
    if not re.fullmatch(r"[A-Z0-9]{10}", team_id):
        raise ValueError("APPLE_TEAM_ID must be the 10-character Apple Team ID")

    target_ids: set[str] = set()
    config_ids: set[str] = set()
    names: list[str] = []

    for target_id, _open, _close, body in _iter_objects(text, NATIVE_TARGET_RE):
        product = PRODUCT_TYPE_RE.search(body)
        name_match = re.search(r"name = ([^;]+);", body)
        name = name_match.group(1).strip(' "') if name_match else ""
        product_type = product.group(1) if product else ""
        is_app = product_type in APP_PRODUCT_TYPES or name in {
            "ZRemote",
            "ExpoWidgetsTarget",
        }
        if not is_app:
            continue
        list_match = CONFIG_LIST_RE.search(body)
        if not list_match:
            raise ValueError(f"no buildConfigurationList for target {target_id}")
        names.append(name or target_id)
        target_ids.add(target_id)
        config_ids.update(_target_config_ids(text, list_match.group(1)))

    if not config_ids:
        raise ValueError("no app/extension targets found to configure")

    pieces: list[str] = []
    last = 0
    for obj_id, open_idx, close_idx, body in _iter_objects(text, BUILD_CONFIG_BLOCK_RE):
        if obj_id not in config_ids:
            continue
        settings_match = re.search(r"buildSettings = \{", body)
        if not settings_match:
            raise ValueError(f"no buildSettings in configuration {obj_id}")
        # settings are relative to body, which itself is inside the object.
        settings_header_abs = open_idx + 1 + settings_match.start()
        settings_body, settings_open, settings_close = _block_body(
            text, settings_header_abs
        )
        updated = settings_body
        # Automatic is required so -allowProvisioningUpdates can mint the
        # App Store profile (Manual with no specifier fails the archive).
        updated = _set_build_setting(updated, "CODE_SIGN_STYLE", "Automatic")
        updated = _set_build_setting(
            updated, "CODE_SIGN_IDENTITY", '"Apple Distribution"'
        )
        updated = _set_build_setting(
            updated,
            '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"',
            '"Apple Distribution"',
        )
        updated = _set_build_setting(updated, "DEVELOPMENT_TEAM", team_id)
        # Automatic manages the profile; a leftover specifier would force
        # Manual-style lookup and break the archive.
        updated = re.sub(
            r"^[ \t]*PROVISIONING_PROFILE(?:_SPECIFIER)? = [^;]*;\n",
            "",
            updated,
            flags=re.M,
        )
        pieces.append(text[last:settings_open + 1])
        pieces.append(updated)
        last = settings_close
    pieces.append(text[last:])
    patched = "".join(pieces)
    patched = _patch_target_attributes(patched, target_ids, team_id)
    return patched, names


def _self_test() -> None:
    fixture = r"""
		13B07F861A680F5B00A75B9A /* ZRemote */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "ZRemote" */;
			name = ZRemote;
			productType = "com.apple.product-type.application";
		};
		AA0000000000000000000001 /* ExpoWidgetsTarget */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = AA0000000000000000000002 /* list */;
			name = ExpoWidgetsTarget;
			productType = "com.apple.product-type.app-extension";
		};
		BB0000000000000000000001 /* SomePod */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = BB0000000000000000000002 /* list */;
			name = SomePod;
			productType = "com.apple.product-type.framework";
		};
		83CBB9F71A601CBA00E9B192 /* Project object */ = {
			isa = PBXProject;
			attributes = {
				TargetAttributes = {
					13B07F861A680F5B00A75B9A = {
						LastSwiftMigration = 1250;
					};
					AA0000000000000000000001 = {
						LastSwiftMigration = 1250;
					};
				};
			};
		};
		13B07F931A680F5B00A75B9A /* list */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				13B07F941A680F5B00A75B9A /* Debug */,
				13B07F951A680F5B00A75B9A /* Release */,
			);
		};
		AA0000000000000000000002 /* list */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				AA0000000000000000000003 /* Release */,
			);
		};
		BB0000000000000000000002 /* list */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				BB0000000000000000000003 /* Release */,
			);
		};
		13B07F941A680F5B00A75B9A /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				DEVELOPMENT_TEAM = OLDTEAMID1;
				PRODUCT_NAME = ZRemote;
			};
			name = Debug;
		};
		13B07F951A680F5B00A75B9A /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_IDENTITY = "Apple Development";
				PRODUCT_NAME = ZRemote;
			};
			name = Release;
		};
		AA0000000000000000000003 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				PROVISIONING_PROFILE_SPECIFIER = "old-dev-profile";
				PRODUCT_NAME = ExpoWidgetsTarget;
			};
			name = Release;
		};
		BB0000000000000000000003 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CODE_SIGN_STYLE = Automatic;
				PRODUCT_NAME = SomePod;
			};
			name = Release;
		};
		83CBBA211A601CBA00E9B192 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "iPhone Developer";
			};
			name = Release;
		};
"""
    out, names = configure(fixture, "ABCDE12345")
    assert names == ["ZRemote", "ExpoWidgetsTarget"], names
    assert out.count('CODE_SIGN_IDENTITY = "Apple Distribution";') >= 2
    assert "CODE_SIGN_STYLE = Manual;" not in out
    assert "DEVELOPMENT_TEAM = ABCDE12345;" in out
    assert "ProvisioningStyle = Automatic;" in out
    assert "ProvisioningStyle = Manual;" not in out
    assert "old-dev-profile" not in out
    # Pods + project-level configs must stay untouched.
    pod = out.split("BB0000000000000000000003 /* Release */ = {")[1].split(
        "83CBBA211A601CBA00E9B192"
    )[0]
    assert "CODE_SIGN_STYLE = Automatic;" in pod, pod
    assert "Apple Distribution" not in pod
    zremote_release = out.split("13B07F951A680F5B00A75B9A /* Release */ = {")[1].split(
        "AA0000000000000000000003"
    )[0]
    widget = out.split("AA0000000000000000000003 /* Release */ = {")[1].split(
        "BB0000000000000000000003"
    )[0]
    assert "CODE_SIGN_STYLE = Automatic;" in zremote_release
    assert "CODE_SIGN_STYLE = Automatic;" in widget
    assert 'CODE_SIGN_IDENTITY = "Apple Distribution";' in zremote_release
    assert 'CODE_SIGN_IDENTITY = "Apple Distribution";' in widget
    assert "Apple Development" not in zremote_release
    assert "Apple Development" not in widget
    print("self-test ok")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pbxproj", nargs="?", help="path to project.pbxproj")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        _self_test()
        return 0
    if not args.pbxproj:
        parser.error("pbxproj path is required")
    team_id = os.environ.get("APPLE_TEAM_ID", "").strip()
    if not team_id:
        print("APPLE_TEAM_ID is required", file=sys.stderr)
        return 1
    path = args.pbxproj
    original = open(path, encoding="utf-8").read()
    patched, names = configure(original, team_id)
    if patched == original:
        print("pbxproj already configured", file=sys.stderr)
    open(path, "w", encoding="utf-8").write(patched)
    print("automatic Apple Distribution signing: " + ", ".join(names))
    return 0


if __name__ == "__main__":
    sys.exit(main())
