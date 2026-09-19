# TestFlight pipeline

Two workflows under `.github/workflows/`:

- **`ios-compile.yml` — iOS Compile Check.** Runs on PRs and pushes to
  `main` touching `app/**` or the iOS workflows. Unsigned Release build
  (`CODE_SIGNING_ALLOWED=NO`, placeholder bundle id
  `dev.zremote.compilecheck`). Needs **no secrets** — forks can run it.
- **`ios-testflight.yml` — iOS TestFlight.** Runs on **push to `main`**
  when `app/**`, this workflow, or `patches/zeron-edge/**` change, and on
  manual `workflow_dispatch` (optional `notes`). Signed archive + upload to
  App Store Connect via the App Store Connect API key and the team's **one
  cloud-managed Apple Distribution certificate**. Expo prebuild's
  Automatic / Apple Development identity is **stripped** on the app and
  widget targets (and the project-level `iPhone Developer` setting) so
  Xcode 26 Automatic cloud signing can pick Distribution for a generic
  iOS archive. Setting Apple Distribution as an xcarg **or** in the
  pbxproj conflicts ("automatically signed for development"); Manual
  style needs a local cert the runner does not have. No certificates,
  profiles, or key material are committed.

  The archive is always the **checked-out git SHA** of the triggering
  event (`github.sha` on push, the branch selected in the Actions UI on
  dispatch). `CFBundleVersion` is `github.run_number` (counts every run
  of this workflow, including failures). `extra.gitSha` is baked in at
  prebuild so Settings can show `0.1.0 (N) · abc1234`.

  Stacked Cursor PRs that merge into another feature branch **do not**
  land on TestFlight. Retarget those PRs at `main` (or merge the stack
  into `main`) before expecting the IPA to include them.

Both run on `macos-26` and select `/Applications/Xcode_26.app` when
present (the step prints `ls /Applications | grep -i xcode` and
`xcodebuild -version` so the exact image contents land in the log).

## 1. One-time Apple setup

Apple Developer Program membership is required (paid).

**Certificates, Identifiers & Profiles → Identifiers:**

- New **App ID** for the app's bundle id — `no.hideout.zremote` (the
  default in `app.config.ts`; override with the `IOS_BUNDLE_ID` GitHub
  variable). Capabilities to enable:
  - **Push Notifications** (`expo-widgets` with
    `enablePushNotifications: true` — Live Activity push-to-start — and
    `expo-notifications` for finish-banner alerts).
  - **Associated Domains** (universal-link auth return:
    `applinks:<edge host>`).
  - **App Groups** — the `expo-widgets` config plugin defaults the shared
    app group to `group.<bundleId>` and writes it into
    `com.apple.security.application-groups` (verified via
    `expo config --type introspect`).
- The `expo-widgets` plugin also generates a widget-extension target
  named **`ExpoWidgetsTarget`** with bundle id
  **`<bundleId>.ExpoWidgetsTarget`** — register that App ID too
  (with the same App Groups capability so it can join
  `group.<bundleId>`). The target exists even though `widgets[]` is
  empty; Live Activities are registered at runtime.

**App Store Connect → Apps → New App:** platform iOS, name `ZRemote`,
pick the bundle id, choose an SKU (e.g. `zremote`).

## 2. App Store Connect API key

Users and Access → **Integrations → App Store Connect API → Team Keys →
Generate**. Role **Admin** (required for Xcode cloud-managed
distribution certificates; App Manager + "Access to Cloud Managed
Distribution Certificate" also works). Download the `.p8` **once** —
Apple does not offer it again. Note the **Key ID** and **Issuer ID**.

That API key is how CI uses the **single** Apple Distribution
certificate Apple already manages for the team. The workflow never
creates Apple Development certificates and never registers the GitHub
runner as a device (`-allowProvisioningDeviceRegistration` is
intentionally absent). Automatic development signing on an ephemeral
runner mints a new development cert each job until the account hits
Apple's 3-certificate cap ("Choose a certificate to revoke"), which is
what broke later TestFlight archives.

If Certificates, Identifiers & Profiles already lists several **Apple
Development** entries named "Created via API" / "Created by Xcode" from
those earlier runs, revoke the unused development ones so a Mac can
still issue a local development cert. Leave the Apple Distribution /
cloud-managed distribution certificate alone.

**Team ID**: developer.apple.com → Membership details → Team ID
(10 chars, e.g. `ABCDE12345`).

## 3. GitHub configuration

Repo → Settings → **Secrets and variables → Actions**:

| Kind     | Name              | Value                                              |
| -------- | ----------------- | -------------------------------------------------- |
| Secret   | `ASC_KEY_ID`      | Key ID from step 2                                 |
| Secret   | `ASC_ISSUER_ID`   | Issuer ID from step 2                              |
| Secret   | `ASC_PRIVATE_KEY` | the `.p8` file's text, pasted as-is (see below)    |
| Secret   | `APPLE_TEAM_ID`   | Team ID                                            |
| Variable | `IOS_BUNDLE_ID`   | optional — defaults to `no.hideout.zremote`        |
| Variable | `ZERON_EDGE_URL`  | optional — edge base URL (default `edge.zeron.sh`) |

The `.p8` is a plain-text PEM file, so no conversion tool is needed. Open
it in any text viewer (on iPad: Files → tap the file → Quick Look, or
share it into Notes), select all, copy, and paste the whole thing —
including the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`
lines — into the secret's value box. GitHub secrets keep newlines. The
workflow also accepts a base64-encoded value if you prefer.

Create the **`testflight`** environment (Settings → Environments → New
environment) and optionally add required reviewers so every upload is
gated. The job's first step fails with a clear list of missing secret
**names** (values are never printed).

## 4. Run

- Actions → **iOS TestFlight** → Run workflow (picks a branch; default
  `main`).
- Or merge to `main` — a push that touches `app/**` starts the job.

`IOS_BUILD_NUMBER` is the workflow run number; `GITHUB_SHA` is written
into `expo.extra.gitSha` at prebuild. `aps-environment` stays
`development` in the entitlements file — Xcode swaps it to `production`
on App Store export via the distribution profile.

The job summary lists the SHA, commit subject, and build number. Settings
→ Account shows the same `version (build) · sha` label so a TestFlight
install can be matched to git.

The archive step does **not** pass `CODE_SIGN_IDENTITY` or
`CODE_SIGN_STYLE` to `xcodebuild`. Those xcargs apply to every target
in the workspace (including CocoaPods), which on Xcode 26 produces
"ZRemote is automatically signed for development, but a conflicting
code signing identity Apple Distribution has been manually specified."
The same conflict happens if Apple Distribution is written into the
generated `project.pbxproj` while `CODE_SIGN_STYLE` stays Automatic —
Xcode 26 classifies Automatic as development signing. Manual style
without a local Distribution cert fails with "requires a provisioning
profile". After prebuild, `ZRemote` and `ExpoWidgetsTarget` stay on
**Automatic** and their `CODE_SIGN_IDENTITY` (plus the project-level
`iPhone Developer` setting) is removed so cloud signing can pick the
Distribution cert for the archive.

## 5. First-run expectations

The in-repo native modules (`react-native-loro`, `zeron-dictation`,
`expo-widgets` extension) have **never been compiled** — Windows cannot
build them. Run **iOS Compile Check** first and fix any Swift errors from
its `build.log` artifact before expecting TestFlight to pass. Export
compliance is pre-answered by `ITSAppUsesNonExemptEncryption=false` in
`infoPlist`. TestFlight processing takes ~10 minutes after upload; add
testers under TestFlight → Internal Testing.

## 6. Security notes

- The repo is **public**: bundle ids, team id, and key material come from
  GitHub variables/secrets at run time — nothing sensitive is hardcoded.
- The `.p8` exists only as `$RUNNER_TEMP/asc/AuthKey.p8` (mode 600) for
  the job's lifetime and is deleted in an `always()` step. Before the log
  artifacts upload, the logs are grepped for `AuthKey`/`-----BEGIN`; a
  hit deletes the logs and fails the job.
- Forks cannot read secrets; the compile-check workflow needs none.
- Never `echo` the key or enable `set -x` in a step that touches it.
