# Dependency acknowledgements

Settings → Acknowledgements displays library name, resolved version, source URL,
and full bundled license/notice text. It reads `Acknowledgements.json` for copied
source and direct package notices, plus the generated `SwiftAcknowledgements.json`,
`CargoAcknowledgements.json`, and `GradleAcknowledgements.json` inventories.
All inventories use this record shape:

```json
{
  "id": "swift:package-name@1.0.0",
  "name": "package-name",
  "version": "1.0.0",
  "source": "https://example.org/project",
  "licenseFiles": ["Package-LICENSE.txt", "Package-NOTICE.txt"]
}
```

License filenames are relative to `Sources/ZRemote/Resources/Licenses`. SwiftPM
processes these into the resource bundle; no notices are downloaded in the app.
Generated Swift records additionally retain the resolved source revision.

After resolving the actual dependency graphs, and before bundling application
resources, the build runs the relevant generators:

```sh
python3 scripts/generate-swift-notices.py --resolved Package.resolved --checkouts .build/checkouts
python3 scripts/generate-cargo-notices.py
# After Gradle :app:exportReleaseRuntimeDependencyInventory:
python3 scripts/generate-gradle-notices.py
python3 scripts/verify-notices.py --required swift,cargo,gradle
```

Use the real shared scratch checkout path when SwiftPM resolution uses a custom
scratch directory. The Swift generator verifies checkout revisions against
`Package.resolved`, then collects license and notice files from those sources.
The Cargo generator starts from the mobile library's resolved target graphs,
including build dependencies, and records the reachable packages. Android
resolution supplies `GradleDependencies.json` and `GradleAcknowledgements.json`.
Its generator extracts full license/notice texts from the resolved JAR/AAR files
and nested AAR jars. A POM explicitly declaring Apache-2.0 can use the checked-in
standard Apache text; other missing source licenses stop generation for review.
It never downloads unreviewed POM license URLs or invents copyright statements.
Cargo and Gradle dependency evidence contains `{ "name": "…", "version": "…" }`
records. An iOS-only build requires `--required swift,cargo`; an Android build
requires all three ecosystems.

The verifier rejects missing generated inventories, stale Swift versions/revisions,
missing dependency entries, unsafe resource paths, and absent or empty license
texts. Regenerate inventories after dependency changes; a checked-in inventory
alone is not evidence that the current resolved graph is covered. Packages that
bundle separately licensed source or assets must retain those notices as well.

The initial inventory covers the pinned direct Skip packages, vendored Zeron
source, Hideout Games' model-picker reference, and narrow Swift-Diffs adaptation.
The generated Cargo inventory currently covers 339 resolved runtime/build
packages. Swift and Gradle transitive inventories still require real platform
resolution. Do not claim release readiness until the generated inventories and
platform-specific verification succeed.

The Android Swift SDK also bundles native runtime libraries outside the
SwiftPM/Cargo/Gradle dependency graphs. Before distribution, audit the actual
APK and selected SDK's Swift runtime, Foundation, ICU, and other bundled native
libraries; add their complete source notices to the app's inventory. The current
three-ecosystem verifier does not establish coverage of those SDK components.

Published Cargo packages that omit their declared license text use reviewed
copies under `native/licenses`. `provenance.json` records their source revisions
and URLs; `overrides.json` maps the exact name/version to those files. The
`generic-btree` 0.10.7 published VCS revision was unavailable, so its license
comes from the exact version tag, whose eight published Rust source files were
verified byte-for-byte. The differing revisions are explicitly recorded.

The platform scaffold follows [Skip's generated Howdy template](https://github.com/skiptools/skipapp-howdy/tree/bdcae70f50cf388caae99cd69c24df8366e2808a).
Its README states that it is exactly the output of `skip init`; the reference
repository contains no license file. It is documented as generated project
scaffolding, with no invented license or runtime dependency entry. Actual Skip
libraries retain their own resolved license texts in the app's inventory.

For a source-only notice audit before dependency resolution:

```sh
python3 scripts/verify-notices.py --required ''
```

This checks present notice resources only and does not establish completeness.
