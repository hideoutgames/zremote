# Native peer integration

The source pin and included crates are recorded in [UPSTREAM.md](UPSTREAM.md).
This workspace contains no execution engine. Sessions run on a selected host;
the mobile client writes durable commands and renders synchronized state.

`Sources/ZRemoteCore/Client/ClientService.swift` defines the presentation contract.
`Sources/ZRemoteNative/NativeClient.swift` adapts the UniFFI peer to that contract.
Both iOS and Android compile that adapter as native Swift. Platform builds link
the same Rust C ABI; Android does not need a second protocol implementation.

Credentials use SkipKeychain (Apple Keychain / Android encrypted preferences).
Each user/organization receives a separate replica directory. A sign-out shuts
down the core, invalidates outstanding adapter results, removes credentials and
deletes only that account's replica. A token rotation must be securely persisted;
a storage failure stops the client. Browser callback validation belongs to the
shared authentication coordinator, before `exchangeCode` receives a code.

Model discovery uses the official core's host RPC catalog. When a host cannot be
reached, that core returns its persisted catalog or its upstream curated fallback;
the current API does not expose catalog freshness. The app defines no substitute
live model catalog. A failed durable send exposes the core's explicit retry action,
which reuses the user message identity so the host can deduplicate delivery.

The adapter coalesces notifications and requests transcript bodies only for
entries whose revision changed. The projection excludes reasoning and raw tool
arguments. This portable projection is separate from the upstream analytic
layout engine, which remains available as `TranscriptView` for native painters.
The shared view must retain stable row identities and avoid re-parsing settled
Markdown when a streaming tail changes.

Local extensions use existing host methods:

- `create_repository`: `CreateRepo { name }`, then project registration. Existing
  folders continue to use `create_project` and `ListFolders`.
- `latest_turn_diff`: `GetCheckoutDiff { cwd, chatId, mode: "turn" }`. It rejects
  a running or changed turn before and after the request, returns the host's
  truncation flag, and never substitutes the working-tree or branch diff.
- `transcript_update`: revision-based presentation projection; unchanged message
  bodies remain in the platform cache.

The current host diff response does not include its turn identifier. The local
before/after guard detects changes visible to the replica; it cannot prove a
host turn identity during sync lag. Captures must therefore be treated as local
observations and never used as authoritative historical host records.

Generate Swift bindings and the C header from the compiled library with
`scripts/build-native-core.sh`. The generated declarations and library must be
updated together; UniFFI's checksum handshake rejects incompatible combinations.
Both build scripts install them through `scripts/normalize-native-bindings.py`,
which removes template whitespace and the Apple-only `Darwin` module dependency
from the common C module map without altering the generated ABI.
On Windows, `scripts/build-core-bindings.ps1` builds the host DLL and generator
through the same resource runner. It uses the process-scoped environment from
`scripts/rust-environment.ps1`: official Rust 1.98.1 GNU components and
LLVM-MinGW 20260922 MSVCRT under `%LOCALAPPDATA%/ZRemote/toolchains`. LLVM lld
links against Rust's matching unwind runtime. These host artifacts validate and
generate the API; they are not mobile application artifacts.
Run `scripts/generate-cargo-notices.py` after resolving dependencies and before
bundling app resources. Missing license texts fail the resource generation.

The targeted projection regression is:

```
cargo test -p zeron-mobile --lib client_ffi::session::projection_regression_tests::reasoning_does_not_leak_into_visible_answer -- --exact
```

Run it through the repository resource admission runner, with one compiler job.
Native application, renderer and device verification remain separate checks.
