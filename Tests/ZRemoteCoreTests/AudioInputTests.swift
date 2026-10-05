import Foundation
import XCTest
import ZRemoteCore

final class AudioInputTests: XCTestCase {
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
