# ZRemote

A focused native Zeron peer for iPhone, iPad, and Android, built with Swift,
SwiftUI, Skip Fuse, and Zeron's Rust mobile core. Agents and project operations
execute on your remote computer. The mobile app never runs an agent or shell.

The Composer is the main view. Phones slide it aside to reveal Sessions;
tablets use a side panel. Model selection, project creation, Settings, and
changed-file details open in phone bottom sheets or centered tablet modals.
PR cards contain only metadata supplied by Zeron and an optional HTTPS link.

## Development

Full app builds require macOS 15+, Xcode 26+, Skip, Android SDK/NDK, Swift 6.1+,
and Rust. See [native builds](docs/BUILD.md).

Use `ZREMOTE_CORE_ONLY=1 swift test --filter UnifiedDiffParserTests` for the
focused parser/capture regressions without resolving UI dependencies.
Use the shared resource runner in `scripts/` for heavy local builds.

The manual [TestFlight workflow](.github/workflows/ios-testflight.yml) is
adapted to the native app. Implementation does not trigger an upload.

Choose **Try test mode** before signing in to exercise the same application
interfaces without credentials or network access. Its sessions, drafts, model
favorites, streaming replies, project folders, and sample changes stay in memory.

## Structure

| Path | Purpose |
| --- | --- |
| `Sources/ZRemote` | Native presentation and adaptive navigation |
| `Sources/ZRemoteCore` | Models, demo peer, diff parser, persistence |
| `Sources/ZRemoteNative` | Swift adapter to the native peer core |
| `native/core` | Pinned, attributed mobile-only Rust subset |
| `Darwin`, `Android` | Platform application entry points |
| `Tests/ZRemoteCoreTests` | Focused production regression tests |

## Compatibility boundaries

New projects can be created in the host's managed projects directory, or an
existing remote folder can be selected. The current host protocol cannot make
an arbitrary new Desktop folder. No host or edge patch is required.

Turn diff snapshots are best-effort and can expire on the host. The client
captures available patches when a turn completes and retains immutable,
account-scoped revisions. Concurrent checkout edits may also appear in the
host's turn diff; it is not an audit log of agent-only filesystem activity.
Unavailable data is never substituted with a later checkout diff.

The optional background belongs only to a blank new Composer. It is removed
while Sessions or a secondary view is visible. There is no terminal, general
file browser, repository administration, or direct GitHub integration.

## Notices and verification

[Acknowledgements](docs/ACKNOWLEDGEMENTS.md) describes the bundled inventory.
Settings exposes full notices offline.

See [verification status](docs/STATUS.md) for exact checks and remaining
platform validation. Source implementation is not evidence of a successful
iOS/Android build or device validation.
