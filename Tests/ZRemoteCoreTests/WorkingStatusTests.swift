import Foundation
import XCTest
import ZRemoteCore

final class WorkingStatusTests: XCTestCase {
    func testOfficialVocabularyUsesStableSessionSeedAndSevenSecondRotation() {
        XCTAssertEqual(WorkingStatus.words.count, 21)
        XCTAssertEqual(WorkingStatus.word(sessionID: "c1", elapsed: 0), "Composing")
        XCTAssertEqual(WorkingStatus.word(sessionID: "c1", elapsed: 6), "Composing")
        XCTAssertEqual(WorkingStatus.word(sessionID: "c1", elapsed: 7), "Sifting")
        XCTAssertEqual(WorkingStatus.word(sessionID: "c1", elapsed: 192), "Riffing")
        XCTAssertEqual(Set((0..<21).map { WorkingStatus.word(sessionID: "c1", elapsed: $0 * 7) }), Set(WorkingStatus.words))
    }

    func testElapsedTimeUsesWallClockIncludingTimeAwayAndClampsFutureStarts() {
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(WorkingStatus.seconds(since: start, now: start.addingTimeInterval(192.9)), 192)
        XCTAssertEqual(WorkingStatus.elapsed(192), "3m 12s")
        XCTAssertEqual(WorkingStatus.elapsed(59), "59s")
        XCTAssertEqual(WorkingStatus.elapsed(60), "1m 0s")
        XCTAssertEqual(WorkingStatus.elapsed(3600), "1h 0m")
        XCTAssertEqual(WorkingStatus.elapsed(7380), "2h 3m")
        XCTAssertEqual(WorkingStatus.seconds(since: start, now: start.addingTimeInterval(-10)), 0)
        XCTAssertEqual(WorkingStatus.elapsed(-1), "0s")
    }

    @MainActor func testSessionUpdatesRetainFallbackThenAcceptHostTimingAndResetForNextTurn() async throws {
        let client = DemoClient()
        let model = AppModel(client: client, makeLiveClient: { DemoClient() })
        model.selectedSessionID = "s"
        let running = SessionState(id: "s", working: true, turnID: "turn-1")
        client.onUpdate?(.session(running))
        let fallback = try XCTUnwrap(model.state?.workingStartedAt)
        client.onUpdate?(.session(running))
        XCTAssertEqual(model.state?.workingStartedAt, fallback, "Heartbeats must not reset elapsed time")

        let hostStart = Date(timeIntervalSince1970: 1_700_000_000)
        var authoritative = running
        authoritative.workingStartedAt = hostStart
        client.onUpdate?(.session(authoritative))
        XCTAssertEqual(model.state?.workingStartedAt, hostStart)
        model.selectedSessionID = "other"
        client.onUpdate?(.session(SessionState(id: "other", working: true, turnID: "other-turn")))
        XCTAssertNotEqual(model.state?.workingStartedAt, hostStart)
        model.selectedSessionID = "s"
        client.onUpdate?(.session(running))
        XCTAssertEqual(model.state?.workingStartedAt, hostStart, "Reopening a session must keep its own clock")

        client.onUpdate?(.session(SessionState(id: "s", working: true, turnID: "turn-2")))
        XCTAssertGreaterThan(try XCTUnwrap(model.state?.workingStartedAt), hostStart)
        client.onUpdate?(.session(SessionState(id: "s", turnID: "turn-2")))
        XCTAssertNil(model.state?.workingStartedAt)
    }

    @MainActor func testSessionUpdatesRefreshListStateWithoutAWorkspaceEvent() {
        let client = DemoClient()
        let model = AppModel(client: client, makeLiveClient: { DemoClient() })
        client.onUpdate?(.workspace(WorkspaceState(sessions: [Session(id: "s", title: "Chat", hostID: "host")])))

        client.onUpdate?(.session(SessionState(id: "s", working: true)))
        XCTAssertEqual(model.workspace.sessions.first?.activity, "Working")
        XCTAssertEqual(model.workspace.sessions.first?.working, true)

        let input = InputRequest(id: "input", questions: [InputQuestion(id: "q", title: "Choose")])
        client.onUpdate?(.session(SessionState(id: "s", working: true, input: input)))
        XCTAssertEqual(model.workspace.sessions.first?.activity, "Waiting for response")
        XCTAssertEqual(model.workspace.sessions.first?.awaitingInput, true)

        client.onUpdate?(.session(SessionState(id: "s")))
        XCTAssertEqual(model.workspace.sessions.first?.activity, "")
        XCTAssertEqual(model.workspace.sessions.first?.working, false)
    }
}
