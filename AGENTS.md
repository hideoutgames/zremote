# AGENTS.md — ZRemote native mobile client

Read before editing. This repository replaces the React Native app with
Swift/Skip. The attributed `native/core` subset is a mobile peer, not an engine.

## Product scope

- Composer is the main view; Sessions is the only phone side drawer.
- Tablets use a Sessions side panel and centered modals, never drawers.
- Secondary phone views are bottom drawers. Keep Settings minimal.
- Remote folder browsing exists only in project creation. No terminal,
  general file manager, history browser, or administrative menus.
- At turn completion show six changed files, then Show all…, and native diffs.
  Retain the captured revision; never substitute later checkout changes.
- PRs use only Zeron metadata and an optional link. No direct GitHub API,
  transcript link discovery, or GitHub authentication.
- Background appears only in the blank Composer with no other surface visible.
- Demo has no network/credential access and shares the live client interface.
- Maintain Settings → Acknowledgements for all shipped open-source libraries.

## Architecture and safety

- ZRemoteCore: portable models, demo, persistence, native diff parser.
- ZRemoteNative: platform adapter to the pinned Rust peer core.
- ZRemote: SwiftUI/Skip views and custom Android components.
- Never execute agents, Git commands, or terminals on the phone.
- Do not modify/deploy Zeron host or edge services for this client.
- Tokens go in Authorization headers, never URLs. Never log secrets, prompts,
  message text, or callback URLs. Auth codes are not bearer tokens.
- Credentials use platform secure storage. Isolate each account's local data.
- Never expose .git in folder browsing. Dictation must be on-device if added.
- Preserve dependency licenses/provenance. No AI-generated artwork.

## Verification and resources

Run only explicit targeted local tests and affected checks, never a full suite
or coverage sweep unless requested. Report exact scope; distinguish syntax
parsing from typechecking, builds, and device testing. Use ZREMOTE_CORE_ONLY=1
for pure domain tests. Update relevant documentation with behavior changes.

Use the shared resource runner under scripts for heavy builds. Serialize native
phases, retain source/environment/toolchain checks, and keep shared worker limits.
Never stop another agent's processes or bypass machine-wide admission.

## Git and distribution

- Never commit unless explicitly asked; never push directly to main.
- PRs must use --repo hideoutgames/zremote and target main.
- Do not call PR-delivered work complete before confirmed merge into main.
- At handoff prominently identify unmerged branch/PR and remaining validation.
- TestFlight is manual-dispatch only. Preserve signing/upload configuration.
  Packaging, signing, uploading, publishing require an explicit request.
- Standard GitHub runners only.
