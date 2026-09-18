# TestFlight pipeline

Two workflows under `.github/workflows/`:

- **`ios-compile.yml` — iOS Compile Check.** Runs on PRs and pushes to
  `main` touching `app/**` or the iOS workflows. Unsigned Release build
  (`CODE_SIGNING_ALLOWED=NO`, placeholder bundle id
  `dev.zremote.compilecheck`). Needs **no secrets** — forks can run it.
- **`ios-testflight.yml` — iOS TestFlight.** Manual (`workflow_dispatch`,
  optional `notes`) or `v*` tag push. Signed archive + upload to App Store
  Connect via the App Store Connect API key and Xcode cloud-managed
  signing — no certificates, profiles, or key material are committed.

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
    `enablePushNotifications: true` — Live Activity push-to-start).
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

- Actions → **iOS TestFlight** → Run workflow, or
- `git tag v0.1.0 && git push --tags`.

`IOS_BUILD_NUMBER` is the workflow run number; `aps-environment` stays
`development` in the entitlements file — Xcode swaps it to `production`
on App Store export via the distribution profile.

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
