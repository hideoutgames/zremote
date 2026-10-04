import XCTest
import ZRemoteCore

final class TranscriptActivityTests: XCTestCase {
    private func tool(_ id: String, output: String = "", resolved: Bool = false) -> TranscriptPart {
        .init(id: id, kind: "tool", tool: .init(kind: "exec", label: "Run", invocation: "swift test", output: output, resolved: resolved))
    }

    func testInterleavedProseToolsThoughtsAndSubagentsKeepHostOrder() {
        let parts: [TranscriptPart] = [
            .init(id: "intro", kind: "text", text: "Checking."),
            .init(id: "thought", kind: "reasoning", text: "Inspect the tests."), tool("read"),
            .init(id: "agent", kind: "subagent"), tool("test"),
            .init(id: "answer", kind: "text", text: "Result.")
        ]
        let rows = TranscriptActivity.segments(messageID: "m", parts: parts, streaming: true)
        XCTAssertEqual(rows.map(\.kind), ["text", "activity", "subagent", "activity", "text"])
        XCTAssertEqual(rows.flatMap(\.parts).map(\.id), parts.map(\.id))
        XCTAssertEqual(rows.filter(\.live).map(\.kind), ["text"])
    }

    func testStreamingOutputKeepsGroupIdentityAndOnlyTailDefaultsOpen() throws {
        let initial = TranscriptActivity.segments(messageID: "m", parts: [tool("run")], streaming: true)
        let updated = TranscriptActivity.segments(messageID: "m", parts: [tool("run", output: "First\nSecond", resolved: true)], streaming: true)
        XCTAssertEqual(initial.map(\.id), updated.map(\.id))
        XCTAssertEqual(updated.first?.parts.first?.tool?.output, "First\nSecond")
        XCTAssertTrue(try XCTUnwrap(updated.first).live)
        XCTAssertNotEqual(TranscriptMessage(id: "m", role: "assistant", text: "", parts: initial[0].parts),
                          TranscriptMessage(id: "m", role: "assistant", text: "", parts: updated[0].parts))
        for end in [TranscriptPart(id: "empty-prose", kind: "text"), .init(id: "image", kind: "boundary")] {
            let rows = TranscriptActivity.segments(messageID: "m", parts: updated[0].parts + [end], streaming: true)
            XCTAssertEqual(rows.map(\.id), initial.map(\.id))
            XCTAssertFalse(try XCTUnwrap(rows.first).live)
        }
        let settled = TranscriptActivity.segments(messageID: "m", parts: updated[0].parts, streaming: false)
        XCTAssertFalse(try XCTUnwrap(settled.first).live)
        XCTAssertTrue(TranscriptActivity.expanded(override: true, live: false), "An explicit expansion survives completion")
        XCTAssertFalse(TranscriptActivity.expanded(override: false, live: true), "An explicit collapse survives streaming")
    }

    func testSummaryCountsDistinctEditsAndReportsFailuresWithoutExposingResults() {
        let parts: [TranscriptPart] = [
            .init(id: "blank", kind: "reasoning", text: " \n"),
            .init(id: "thought", kind: "reasoning", text: "Check the change."),
            .init(id: "edit-1", kind: "tool", tool: .init(kind: "editFile", label: "Edit", path: "Sources/App.swift")),
            .init(id: "edit-2", kind: "tool", tool: .init(kind: "editFile", label: "Edit", path: "Sources/App.swift")),
            .init(id: "run", kind: "tool", tool: .init(kind: "exec", label: "Run", output: "error details", resolved: true, failed: true))
        ]
        let group = TranscriptActivity.segments(messageID: "m", parts: parts, streaming: false)[0]
        XCTAssertEqual(group.summary, "Thought process · ran 1 command · edited 1 file · 1 failed")
        XCTAssertEqual(group.parts.count, 4)
        XCTAssertEqual(group.parts[1].tool?.fileName, "App.swift")
    }

    func testToolOnlyAssistantStaysVisibleAndOwnsCompletedTurnFooter() throws {
        var cache = TranscriptMetadata.Cache()
        let updates = try TranscriptMetadata.decode(#"[{"sessionID":"s","messageMetadata":{"entries":[{"id":"answer","role":"assistant","status":"complete","durationMs":192000}]}}]"#)
        cache.apply(try XCTUnwrap(updates["s"]))
        let messages: [TranscriptMessage] = [
            .init(id: "user", role: "user", text: "Run the checks"),
            .init(id: "answer", role: "assistant", text: "", parts: [tool("test", output: "Passed", resolved: true)])
        ]
        let visible = TranscriptMetadata.applying(cache, to: messages)
        XCTAssertEqual(visible.map(\.id), ["user", "answer"])
        XCTAssertEqual(visible.last?.workedDuration, 192)
        XCTAssertEqual(visible.last?.parts.first?.tool?.output, "Passed")
        XCTAssertTrue(TranscriptMetadata.applying(cache, to: messages, latestTurnRunning: true).allSatisfy { $0.workedDuration == nil })
    }

    @MainActor func testOfflineShowcaseStreamsIntoTheSameToolAndStopsItsClock() async throws {
        let client = DemoClient(showcaseIntervalNanoseconds: 10_000_000)
        let model = AppModel(client: client, makeLiveClient: { DemoClient() })
        await model.start()
        await model.open("demo-running")
        let initial = model.state?.messages.last?.parts
        let startedAt = model.state?.workingStartedAt
        XCTAssertNotNil(startedAt)
        for _ in 0..<100 where model.state?.messages.last?.parts == initial {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(model.state?.messages.last?.parts.map(\.id), initial?.map(\.id))
        XCTAssertNotEqual(model.state?.messages.last?.parts.last?.tool?.output, initial?.last?.tool?.output)
        XCTAssertEqual(model.state?.workingStartedAt, startedAt)
        try await client.interrupt(sessionID: "demo-running")
        XCTAssertEqual(model.state?.working, false)
        XCTAssertNil(model.state?.workingStartedAt)
        XCTAssertEqual(model.state?.messages.last?.streaming, false)
        await model.disconnect()
    }
}
