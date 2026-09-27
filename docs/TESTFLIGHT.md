# TestFlight pipeline

`.github/workflows/ios-testflight.yml` — **iOS TestFlight**. Manual
`workflow_dispatch` only (optional `notes`). Merges to `main` do not start
it.

The job checks out this repo, installs Rust (`rust-toolchain.toml`, iOS
device target) and Xcode 26, then archives `apps/ios/Zeron.xcodeproj`
scheme **Zeron** for a generic iOS device. The target's **Rust core**
build phase runs `scripts/ios/build-core.sh`, which compiles `crates/mobile`
(`libzeron_mobile.a`) and refreshes the UniFFI bindings.

The archive is **unsigned** (`CODE_SIGNING_ALLOWED=NO`) so ephemeral
runners never mint Apple Development certificates.
`xcodebuild -exportArchive` then cloud-signs with the App Store Connect
API key and the team's **one cloud-managed Apple Distribution
certificate**, and uploads to App Store Connect. No certificates,
profiles, or key material are committed.

`CFBundleVersion` is `github.run_number` (this workflow's run count,
including failures). `CFBundleShortVersionString` is the project's
`MARKETING_VERSION` (`1.0`). The bundle id defaults to
**`no.hideout.zremote`** — the existing ZRemote App ID — so the upload
lands on the existing TestFlight app. Override with the `IOS_BUNDLE_ID`
Actions variable. `DEVELOPMENT_TEAM` on the archive and `teamID` in
`ExportOptions.plist` both come from the `APPLE_TEAM_ID` secret.

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
checked-out SHA. The job summary lists the SHA, commit subject, build
number, and bundle id.

The archive step does **not** pass `-allowProvisioningUpdates` or the ASC
authentication flags. Those apply only at export, where
`ExportOptions.plist` sets `signingStyle=automatic` and
`signingCertificate=Apple Distribution`.
