# Model and microphone preferences

The model picker retains its existing tabs, row dimensions, colors, search and
configuration tray. Its indicator slides between tabs; selection, favorites and
tray changes animate gently. iOS buttons add press feedback. Reduce Motion
disables movement, and selection feedback follows the Haptics preference.

Each account stores settings by the existing provider/model identity (including
favorites). Switching models restores that model's effort and options, including
an explicit default, then removes options no longer supported by the host. A
model used for the first time starts from its own defaults. Favorites reference
the same settings as ordinary rows; starring never copies the current model's
configuration.

New sessions restore the last used model and provider. Opening a session,
successfully changing a model, or sending a message updates this preference;
background updates for other sessions do not. If the exact model is unavailable,
the first model from that provider is used before falling back to another
provider. This temporary fallback does not erase the saved choice. Preferences
restore regardless of whether the disk read or model catalog arrives first, and
edits made during restoration take precedence. Existing sessions keep their
host configuration and provider lock.

## iOS microphone

Settings has one **Microphone** choice: **Dictation** (default) or **Audio Model**.
Only the selected mode's options appear. Dictation offers a language picker;
Audio Model offers **Multilingual** (Parakeet v3) and **English** (Parakeet v2).
Tapping an uninstalled model installs and selects it. Installed rows select it
immediately. Long press offers Details and Install, Details and Delete, or
Details and disabled download progress. Deleting the selected model returns
the current account to Dictation. Downloads and deletes are disabled in Try mode.

Dictation uses Apple's Speech framework with `requiresOnDeviceRecognition` and
checks `supportsOnDeviceRecognition`. It never falls back to server recognition.
Missing permissions or unavailable on-device languages produce actionable
errors. Speech and microphone permissions are requested only when recording.

Finishing transcribes the temporary recording into the current draft. It never
sends the draft. Canceling, leaving the composer or changing accounts/sessions
discards the recording and rejects late results. Recording is capped at one
minute and automatically finishes at that limit. The waveform stays in the
existing control layout and the finish button shows transcription progress.
Audio files are removed when the recording task exits. Android retains its
existing composer; this change does not introduce an Android microphone control.

## Optional audio assets

[FluidAudio 0.15.4](https://github.com/FluidInference/FluidAudio/tree/b9d43724cbdb5a980e441fd54180964e94d470f7)
provides the iOS Core ML runtime. Its dependency is conditional on iOS and omitted
entirely by the core-only test manifest. `AudioModels.json` pins the two model
repositories and all 21 files per model by revision, byte count and SHA-256.
The multilingual download is 483,105,645 bytes; English is 464,413,247 bytes.

The installer uses an ephemeral URL session without credential/cookie storage,
reports byte progress, validates each file with bounded-memory hashing, and loads
the local model before marking it installed. Completed files remain in staging
after interruption so retrying can reuse them. Downloads continue when leaving
Settings while the app runs. Restarting the app requires tapping Install again
to resume an interrupted installation. No background transfer entitlement is used.

Model weights live in Application Support/ZRemote/AudioModels, excluded from
backup. These public assets are shared on the device; mode, language and selected
model remain account-scoped. Inference runs off the main actor, releases its
model after transcription, and enforces FluidAudio's offline mode, including
corrupt-cache recovery. The only network path is explicit installation in
Settings. A missing installed model never triggers an automatic download.

To regenerate the download manifest from the pinned revisions, run
`python scripts/generate-audio-model-manifest.py`. It fetches metadata and small
model-description files to hash; large weights use their published LFS SHA-256.
Updating a model requires reviewing the revision, runtime compatibility and
licenses together. Full license text and attribution are in Acknowledgements.

## Scoped validation

Domain regressions: `ModelPreferenceTests`, `AudioInputTests`,
`ModelPresentationTests`, and the named preference restoration/model rejection
cases in `CoreBehaviorTests`. Run through `scripts/run-local.py` with
`ZREMOTE_CORE_ONLY=1` and the shared profile. Windows syntax parsing is separate
from iOS typechecking, Skip bridge generation and device testing.

Local verification on 2026-10-05 passed 17 distinct Swift tests with one worker
and stable source/environment/toolchain fingerprints. Exact scope:

- `ModelPreferenceTests`: all 4 cases in that file.
- `AudioInputTests`: all 3 cases in that file.
- `ModelPresentationTests`: all 5 cases in that file.
- `CoreBehaviorTests.testRestoringPreferencesPreservesEarlyModelEditsAndRemembersProviderAfterRestart`.
- `CoreBehaviorTests.testRejectedSessionModelChangeDoesNotReplaceRememberedSettings`.
- `CoreBehaviorTests.testModelFavoritesKeepProviderIdentityAndSelectionRejectsUnsupportedConfiguration`.
- `CoreBehaviorTests.testExpiredAuthenticationClearsAccountStateAndRestoresSameAccountAgain`.
- `SessionConfigurationTests.testDemoCreatesSessionsInSelectedCheckoutOrNewWorktreeAndRenamesThem`.

The initial run selected 16 cases. After tightening empty-catalog handling, the
7 affected preference/restoration/session-creation cases passed again. No full
suite or app build was run. The manifest and changed UI/audio Swift sources
passed syntax parsing; the domain target was compiled and its selected tests run.
FluidAudio 0.15.4 was resolved with SwiftPM in an isolated package; its generated
pin was added without changing the existing workspace pins. The old workspace
origin hash was removed so the next native resolution regenerates it against
the complete application manifest.

Device checks still needed: iPhone/iPad picker geometry and reduced motion;
permission grant/denial; offline Dictation; each Parakeet install, selection,
interrupted download/retry and deletion; cancel during transcription; account
switch; and on-device memory/latency. An iOS compile must resolve the conditional
package and regenerate the full Swift dependency notices before distribution.
