# Native peer integration

The source pin and included crates are recorded in [UPSTREAM.md](UPSTREAM.md).
This workspace contains no execution engine. Sessions run on a selected host;
the mobile client writes durable commands and renders synchronized state.

`Sources/ZRemoteCore/Client/ClientService.swift` defines the presentation contract.
`Sources/ZRemoteNative/NativeClient.swift` adapts the UniFFI peer to that contract.
Both iOS and Android compile that adapter as native Swift. Platform builds link
the same Rust C ABI; Android does not need a second protocol implementation.

`ZRemoteNative` explicitly links CoreFoundation on iOS/macOS for the resolved
`iana-time-zone`/`core-foundation-sys` dependency. Its macOS slice also declares
SystemConfiguration for the host proxy resolver and Network for the
`zeron-sync/src/net_path.rs` framework declaration. SwiftPM must receive these
framework requirements when consuming the Rust static archive. CoreText is only
a macOS development-test dependency in this vendored graph; no additional C++
runtime requirement was identified from its production source/build scripts.
Actual Apple archive linking is verified by the platform build, not the Windows
host typecheck.

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

- `agent_accounts_json`: read-only `ListAgentAccounts { forceUsage: false }` on
  a verified execution host, decoded as the existing typed account snapshot.
  Credentials stay on the host; only account labels and quota metadata cross
  the mobile boundary. Swift checks response size, account generation and host
  selection before applying it. Polling is bounded while work is active.
- `session_signals_json`: exposes the already synchronized host completion marker
  and error state to the presentation adapter. Successful completions must not
  be inferred from a stale working indicator becoming idle. This modifies only
  the bundled peer; it adds no host or edge protocol requirement.

- `create_repository`: `CreateRepo { name }`, then project registration. Existing
  folders continue to use `create_project` and `ListFolders`.
- `latest_turn_diff`: `GetCheckoutDiff { cwd, chatId, mode: "turn" }`. It rejects
  a running or changed turn before and after the request, returns the host's
  truncation flag, and never substitutes the working-tree or branch diff.
- `transcript_update`: revision-based presentation projection; unchanged message
  bodies remain in the platform cache.
- `composer_completions`: existing `ListCommands` / `ListSkills` RPCs with the
  selected provider, session and project. Returned skills keep their canonical
  `zeron-invoke:` identity, including provider-specific command metadata. File
  completions use the existing `SearchFiles` and canonical `zeron-file:` links.
  Unavailable host catalogs show no fabricated live suggestions.

Attachments use the official durable `SendRequest` byte escort and chunked
upload path (680,000 base64 characters per chunk), with a 24 MB per-file limit.
The editable client bounds each draft to 48 MB and all pending drafts to 96 MB;
it rejects additions beyond those limits instead of discarding earlier picks.
Picker results carry an account/session/project context guard. Binary draft
data stays in memory until sent and is cleared on sign-out. Device-local URIs
never cross the service boundary. The Rust projection strips transport trailers
from visible user text and exposes typed attachment references. Retrieval uses
the core's attachment cache and only accepts refs present in the open transcript.

Subagent cards come from each tool part's actual `subagent_ref`, lifecycle and
display tail. A resolved spawn tool does not imply its child has finished.
Reasoning and raw tool arguments remain excluded from the projection.
Pin/archive/restore actions use the official peer's replicated session methods;
created/updated dates and archive/pin flags come from its workspace rows.

The pinned edge authentication response supplies identity/name but no profile
photo URL. Existing accounts fall back to initials; an optional future photo
field is accepted only as a real secure URL from that response. No avatar lookup
service or host modification is introduced.

The host currently supplies one latest PR summary per checkout/branch, with
provider, number, title, URL, state and base/head refs. It has no PR registration
event or historical list. The client therefore retains up to 256 distinct
host-observed summaries per account, updates matching PR states, and anchors a
new summary to the first transcript position where this client observes it.
These are local observations, not reconstructed historical registration events.
All PR metadata remains host-sourced; no GitHub API or transcript URL discovery
is used.

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
cargo test -p zeron-mobile --lib client_ffi::session::projection_regression_tests
```

Run it through the repository resource admission runner, with one compiler job.
The three cases protect reasoning exclusion, attachment trailer projection, and
subagent lifecycle independence from spawn-tool completion.
Native application, renderer and device verification remain separate checks.
