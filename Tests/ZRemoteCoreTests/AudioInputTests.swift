import Foundation
import XCTest
import ZRemoteCore

final class AudioInputTests: XCTestCase {
    func testPartialDictationRevisesSelectionWithoutDuplicatingOrLosingSuffix() {
        let draft = "🙂 Hello old words, goodbye."
        let range = (draft as NSString).range(of: "old words")
        var insertion = TranscriptionInsertion(draft: draft, selection: range)
        let first = insertion.update("new", in: draft)!
        XCTAssertEqual(first.text, "🙂 Hello new, goodbye.")
        let final = insertion.update("new spoken words", in: first.text)!
        XCTAssertEqual(final.text, "🙂 Hello new spoken words, goodbye.")
        XCTAssertEqual(final.cursorUTF16, ("🙂 Hello new spoken words" as NSString).length)
        XCTAssertEqual(insertion.cancel(in: final.text)?.text, draft)
        XCTAssertNil(insertion.update("late result", in: final.text + " manual edit"))
        XCTAssertNil(insertion.cancel(in: final.text + " manual edit"))
    }

    func testSpeechInsertsAtCaretAndPreservesReferences() {
        var insertion = TranscriptionInsertion(draft: "before after", selection: NSRange(location: 7, length: 0))
        XCTAssertEqual(insertion.update("spoken", in: "before after")?.text, "before spoken after")
        var empty = TranscriptionInsertion(draft: "", selection: NSRange(location: 0, length: 0))
        XCTAssertNil(empty.update(" \n", in: ""))
        XCTAssertEqual(empty.update("hello", in: "")?.text, "hello")
        let draft = "use [file.swift](zeron-file:src/file.swift) next"
        let reference = ComposerReferenceText(draft).references[0].sourceRange
        var token = TranscriptionInsertion(draft: draft, selection: NSRange(location: reference.location + 1, length: 2))
        XCTAssertEqual(token.update("speech", in: draft)?.text, "use speech next")
    }

    @MainActor func testCancelLiveSpeechRestoresOriginalSessionButNeverAnotherAccount() async {
        let model = AppModel(client: DemoClient(), makeLiveClient: { DemoClient() })
        let context = model.attachmentContext
        model.draft = "Original"
        var insertion = TranscriptionInsertion(draft: model.draft, selection: NSRange(location: 8, length: 0))
        model.draft = insertion.update("speech", in: model.draft)!.text
        model.selectedSessionID = "other"
        model.draft = "Other session"
        XCTAssertNil(model.cancelTranscription(insertion, context: context, sessionID: nil))
        XCTAssertEqual(model.preferences.drafts["new"], "Original")
        XCTAssertEqual(model.draft, "Other session")
        await model.disconnect()
        model.draft = "Another account"
        XCTAssertNil(model.cancelTranscription(insertion, context: context, sessionID: nil))
        XCTAssertEqual(model.draft, "Another account")
    }

    func testExistingAndUnknownPreferencesDefaultToDictationWithoutDownloading() throws {
        let legacy = try JSONDecoder().decode(LocalPreferences.self, from: Data("{}".utf8))
        XCTAssertEqual(legacy.audioInput.mode, .dictation)
        XCTAssertEqual(legacy.audioInput.dictationLocale, "")
        let future = try JSONDecoder().decode(AudioInputPreferences.self,
            from: Data("{\"mode\":\"removed\",\"model\":\"removed\",\"dictationLocale\":\"fr-FR\"}".utf8))
        XCTAssertEqual(future.mode, .dictation)
        XCTAssertEqual(future.model, .multilingual)
        XCTAssertEqual(future.dictationLocale, "fr-FR")
    }

    func testAudioChoicesRoundTripWithoutLosingHiddenOptions() throws {
        var saved = LocalPreferences()
        saved.audioInput.mode = .audioModel
        saved.audioInput.model = .english
        saved.audioInput.dictationLocale = "fr-FR"
        var restored = try JSONDecoder().decode(LocalPreferences.self, from: JSONEncoder().encode(saved))
        XCTAssertEqual(restored.audioInput, saved.audioInput)
        restored.audioInput.mode = .dictation
        let switched = try JSONDecoder().decode(LocalPreferences.self, from: JSONEncoder().encode(restored))
        XCTAssertEqual(switched.audioInput.model, .english)
        XCTAssertEqual(switched.audioInput.dictationLocale, "fr-FR")
    }

    @MainActor
    func testAcceptedTranscriptionPreservesEditedDraftAndCannotCrossSessionsOrAccounts() async {
        let model = AppModel(client: DemoClient(), makeLiveClient: { DemoClient() })
        let context = model.attachmentContext
        model.draft = "An edited draft"
        XCTAssertTrue(model.appendTranscription("  spoken words\n", context: context))
        XCTAssertEqual(model.draft, "An edited draft spoken words")
        model.draft += "\n"
        XCTAssertTrue(model.appendTranscription("Next line", context: context))
        XCTAssertEqual(model.draft, "An edited draft spoken words\nNext line")
        XCTAssertFalse(model.appendTranscription(" \n", context: context))
        model.selectedSessionID = "other-session"
        XCTAssertFalse(model.appendTranscription("Old recording", context: context))
        XCTAssertEqual(model.draft, "")
        let oldAccountContext = model.attachmentContext
        await model.disconnect()
        XCTAssertFalse(model.appendTranscription("Old account", context: oldAccountContext))
        XCTAssertEqual(model.draft, "")
    }
}
