import Foundation
import XCTest
import ZRemoteCore

final class DemoRetainedChangesTests: XCTestCase {
    @MainActor
    func testSeededDiffsAppearAfterCompletedTranscriptAndSurviveReopening() async throws {
        let client = DemoClient()
        let model = AppModel(client: client, makeLiveClient: { DemoClient() })
        await model.start()

        for id in ["demo-welcome", "demo-unread"] {
            await model.open(id)
            for _ in 0..<100 where model.changes.isEmpty {
                try await Task.sleep(for: .milliseconds(20))
            }

            let state = try XCTUnwrap(model.state)
            let turnID = try XCTUnwrap(state.turnID)
            let lastMessageID = try XCTUnwrap(state.messages.last?.id)
            XCTAssertEqual(model.session?.completedTurnID, turnID)
            XCTAssertTrue(state.messages.contains { $0.id == turnID }, id)
            let captured = try XCTUnwrap(model.changesAfterMessage[lastMessageID], id)
            XCTAssertEqual(captured.turnID, turnID)
            XCTAssertEqual(captured.files.count, 7)

            model.newSession()
            await model.open(id)
            XCTAssertEqual(model.changesAfterMessage[lastMessageID], captured)
        }

        await model.disconnect()
    }
}
