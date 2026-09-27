# TestFlight pipeline

`.github/workflows/ios-testflight.yml` — **iOS TestFlight**. Manual
`workflow_dispatch` only (optional `notes`). Merges to `main` do not start
it.

The workflow is a single macOS job, started only with **Run workflow**.
Pull requests do not start it, and this repo has no other macOS workflow.
It does not build or test the iOS Simulator app — Zeron pull-request CI
already does that. This job only archives the device build and uploads it.

The job selects Xcode 26 (downloading the iOS platform if that SDK is
missing) and installs Rust into `~/.cargo/bin`.
`scripts/ios/build-core.sh` runs `cargo` with a scrubbed environment that
only looks there. `rust-toolchain.toml` lists `aarch64-apple-ios`; the job
installs that device target and does not install `aarch64-apple-ios-sim`.

It then archives `apps/ios/Zeron.xcodeproj` scheme **Zeron**, Release, for
a generic iOS device. The target's **Rust core** build phase runs
`build-core.sh`, which compiles `crates/mobile` with the `mobile-dist`
profile (`libzeron_mobile.a`) and refreshes the UniFFI bindings.

The archive is **unsigned** (`CODE_SIGNING_ALLOWED=NO`) so ephemeral
runners never mint Apple Development certificates.
`xcodebuild -exportArchive` then cloud-signs with the App Store Connect
API key and the team's **one cloud-managed Apple Distribution
certificate**, and uploads to App Store Connect. No certificates,
profiles, or key material are committed.

`CFBundleShortVersionString` is the project's `MARKETING_VERSION`
(`1.0`). `CFBundleVersion` is the greater of `github.run_number` and one
more than the highest numeric build App Store Connect already has for
this app, so a re-run cannot reuse or go backwards from an uploaded
build. The bundle id defaults to **`no.hideout.zremote`** — the existing
ZRemote App ID — so the upload lands on the existing TestFlight app.
Override with the `IOS_BUNDLE_ID` variable. `DEVELOPMENT_TEAM` on the
archive and `teamID` in `ExportOptions.plist` both come from the
`APPLE_TEAM_ID` secret.

After the upload, the job polls App Store Connect until that build's
processing state is `VALID` (or fails the job on `FAILED` / `INVALID`).
Processing is given 30 minutes.

The native app has **no entitlements file** (no push, associated domains,
app groups, or widget extension). Extra capabilities already enabled on
the `no.hideout.zremote` App ID do not have to be removed.

## GitHub configuration

Repo → Settings → **Secrets and variables → Actions**:

| Kind     | Name              | Value                                              |
| -------- | ----------------- | -------------------------------------------------- |
| Secret   | `ASC_KEY_ID`      | App Store Connect API Key ID                       |
| Secret   | `ASC_ISSUER_ID`   | App Store Connect API Issuer ID                    |
| Secret   | `ASC_PRIVATE_KEY` | the `.p8` file's text, pasted as-is (see below)    |
| Secret   | `APPLE_TEAM_ID`   | Team ID (10 characters)                            |
| Variable | `IOS_BUNDLE_ID`   | optional — defaults to `no.hideout.zremote`        |

The `.p8` is a plain-text PEM file. Paste the whole thing — including the
`-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines — into
the secret. The workflow also accepts a base64-encoded value.

Create the **`testflight`** environment (Settings → Environments) and
optionally add required reviewers so every upload is gated. The job's
secret check fails with a list of missing secret **names** (values are
never printed).

The API key needs a role that can use cloud-managed distribution
certificates (**Admin**, or App Manager with access to the cloud-managed
distribution certificate).

## Run

Actions → **iOS TestFlight** → Run workflow. The archive is the
checked-out SHA. The job summary lists the SHA, commit subject, App
Store Connect app, build number, bundle id, and processing state.

The archive step does **not** pass `-allowProvisioningUpdates` or the ASC
authentication flags. Those apply only at export, where
`ExportOptions.plist` sets `signingStyle=automatic` and
`signingCertificate=Apple Distribution`.
