import XCTest
import ZRemoteCore

final class NativeSessionControlsTests: XCTestCase {
    func testHeldPullIgnoresTheNativeRefreshInsetUntilRelease() {
        var geometry = SessionRefreshGeometry(restingTopInset: 20, systemTopInset: 20)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -50, adjustedTopInset: 20, systemTopInset: 20, dragging: true, refreshing: false), 30)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -110, adjustedTopInset: 80, systemTopInset: 20, dragging: true, refreshing: true), 90)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -126, adjustedTopInset: 80, systemTopInset: 20, dragging: true, refreshing: true), 106)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -80, adjustedTopInset: 80, systemTopInset: 20, dragging: false, refreshing: true), 60)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -20, adjustedTopInset: 20, systemTopInset: 20, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -38, adjustedTopInset: 20, systemTopInset: 20, dragging: true, refreshing: false), 18)
    }

    func testAuthenticationErrorsDescribeStagesWithoutEchoingProviderDetails() {
        let callback = URL(string: "zeron://callback?state=expected&error=denied&error_description=private")!
        XCTAssertThrowsError(try AuthenticationCallback.code(from: callback, expectedState: "expected")) { error in
            XCTAssertEqual((error as? ClientFailure)?.message, "The login provider declined sign-in. Please start again.")
        }
        XCTAssertThrowsError(try AuthenticationCallback.code(from: callback, expectedState: "other")) { error in
            XCTAssertEqual((error as? ClientFailure)?.message, "Sign-in did not match this browser session.")
        }
    }

    @MainActor func testSubagentsUseLatestStatusPerIDAndStayScopedToTheirSession() {
        let model = AppModel(client: DemoClient(), makeLiveClient: { DemoClient() })
        model.selectedSessionID = "chat"
        model.state = SessionState(id: "chat", messages: [
            TranscriptMessage(id: "one", role: "assistant", text: "", subagents: [
                SubagentStatus(id: "review", status: "running"),
                SubagentStatus(id: "test", status: "working")
            ]),
            TranscriptMessage(id: "two", role: "assistant", text: "", subagents: [
                SubagentStatus(id: "review", status: "done"),
                SubagentStatus(id: "failed", status: "failed")
            ])
        ])
        XCTAssertEqual(model.subagents(sessionID: "chat").map(\.status), ["done", "working", "failed"])
        XCTAssertEqual(model.activeSubagentCount, 1)
        XCTAssertTrue(model.subagents(sessionID: "other").isEmpty)
        model.workspace = WorkspaceState(connection: .online, hosts: [Host(id: "host", name: "Desktop", online: false)],
                                         sessions: [Session(id: "chat", title: "Work", hostID: "host")])
        XCTAssertTrue(model.sessionHostOffline)
        model.selectedSessionID = nil
        XCTAssertFalse(model.sessionHostOffline)
        XCTAssertEqual(model.activeSubagentCount, 0)
    }
}
