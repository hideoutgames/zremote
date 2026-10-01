import Foundation
import XCTest
import ZRemoteCore

final class TranscriptMetadataTests: XCTestCase {
    func testLegacySignalsStayReadableAndMetadataDoesNotRequireRegistryRunState() throws {
        XCTAssertTrue(try TranscriptMetadata.decode(#"[{"sessionID":"old","completedTurnID":null,"updatedAtMs":1,"failed":false}]"#).isEmpty)
        let rows = try TranscriptMetadata.decode(#"[{"sessionID":"new","messageMetadata":{"reset":true,"entries":[{"id":"user","createdAtMs":1700000000123}],"removedIDs":[]}}]"#)
        let entry = try XCTUnwrap(rows["new"]?.entries.first)
        XCTAssertEqual(try XCTUnwrap(entry.timestamp).timeIntervalSince1970, 1_700_000_000.123, accuracy: 0.001)
        XCTAssertNil(entry.workedDuration)
        XCTAssertTrue(entry.subagentTitles.isEmpty)
    }

    func testCompletedAssistantDurationUsesOnlyHostMilliseconds() throws {
        let update = try decode(#"{"entries":[{"id":"assistant","role":"assistant","status":"complete","createdAtMs":1700000000000,"durationMs":720000,"subagentTitles":[{"id":"spawn","title":"Review spacing"}]}]}"#)
        let entry = try XCTUnwrap(update.entries.first)
        XCTAssertEqual(entry.workedDuration, 720)
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: entry.workedDuration), "Worked for 12m")
        XCTAssertEqual(entry.subagentTitles.first?.id, "spawn")
        XCTAssertEqual(entry.subagentTitles.first?.title, "Review spacing")
    }

    func testMissingInvalidAndUnfinishedTimingNeverBecomesCompletedWork() throws {
        let update = try decode(#"{"entries":[{"id":"missing"},{"id":"invalid","role":"assistant","status":"complete","createdAtMs":-1,"durationMs":-1},{"id":"zero","role":"assistant","status":"complete","createdAtMs":0,"durationMs":0},{"id":"unbounded","createdAtMs":9223372036854775807},{"id":"streaming","role":"assistant","status":"streaming","durationMs":60000},{"id":"aborted","role":"assistant","status":"aborted","durationMs":60000},{"id":"user","role":"user","status":"complete","durationMs":60000}]}"#)
        for entry in update.entries {
            XCTAssertNil(entry.timestamp)
            XCTAssertNil(entry.workedDuration)
        }
    }

    func testMetadataDeltasRetainHistoryAndRemoveOrResetOnlyExplicitEntries() throws {
        var cache = TranscriptMetadata.Cache()
        cache.apply(try decode(#"{"reset":true,"entries":[{"id":"user","createdAtMs":1700000000000},{"id":"assistant","role":"assistant","status":"streaming"}]}"#))
        cache.apply(try decode(#"{"entries":[{"id":"assistant","role":"assistant","status":"complete","durationMs":1500}]}"#))
        XCTAssertNotNil(cache.entries["user"]?.timestamp)
        XCTAssertEqual(cache.entries["assistant"]?.workedDuration, 1.5)
        cache.apply(try decode(#"{"entries":[{"id":"assistant","role":"assistant","status":"streaming"}]}"#))
        XCTAssertNil(cache.entries["assistant"]?.workedDuration)
        cache.apply(try decode(#"{"removedIDs":["assistant"]}"#))
        XCTAssertNil(cache.entries["assistant"])
        XCTAssertNotNil(cache.entries["user"])
        cache.apply(try decode(#"{"reset":true,"entries":[]}"#))
        XCTAssertTrue(cache.entries.isEmpty)
    }

    func testMalformedAndAmbiguousMetadataCannotPartiallyReplaceTheCache() throws {
        for json in [
            #"[{"sessionID":"s","messageMetadata":{"entries":[{"id":"same"},{"id":"same"}]}}]"#,
            #"[{"sessionID":"s","messageMetadata":{}},{"sessionID":"s","messageMetadata":{}}]"#,
            #"[{"sessionID":"s","messageMetadata":{"entries":[{"id":"a","createdAtMs":"invalid"}]}}]"#,
        ] { XCTAssertThrowsError(try TranscriptMetadata.decode(json)) }
        var cache = TranscriptMetadata.Cache()
        cache.apply(try decode(#"{"entries":[{"id":"kept"},{"id":"removed"}]}"#))
        cache.retain(messageIDs: ["kept"])
        XCTAssertEqual(Set(cache.entries.keys), ["kept"])
    }

    func testWorkedLabelUsesWholeMinutesAndHoursWithoutRoundingUpOrInventingDuration() {
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: 0.001), "Worked for <1m")
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: 59.999), "Worked for <1m")
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: 60), "Worked for 1m")
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: 779.99), "Worked for 12m")
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: 18_000), "Worked for 5h")
        XCTAssertEqual(TranscriptMetadata.workLabel(duration: 19_620), "Worked for 5h 27m")
        XCTAssertNil(TranscriptMetadata.workLabel(duration: nil))
        for value in [0, -1, Double.nan, Double.infinity, Double.greatestFiniteMagnitude] {
            XCTAssertNil(TranscriptMetadata.workLabel(duration: value))
        }
    }

    func testMetadataMovesOneFooterAfterLastVisibleTurnContentAndPreservesUserTiming() throws {
        var cache = TranscriptMetadata.Cache()
        cache.apply(try decode(#"{"entries":[{"id":"u1","createdAtMs":1700000000123},{"id":"a1","role":"assistant","status":"complete","durationMs":1000,"subagentTitles":[{"id":"spawn","title":"Review spacing"}]},{"id":"terminal","role":"assistant","status":"complete","durationMs":720000},{"id":"empty","role":"assistant","status":"complete","durationMs":2000}]}"#))
        let messages: [TranscriptMessage] = [
            .init(id: "u1", role: "user", text: "First turn"),
            .init(id: "a1", role: "assistant", text: "Result", subagents: [.init(id: "spawn", status: "complete")]),
            .init(id: "files", role: "assistant", text: "", attachments: [.init(path: "output.txt", name: "output.txt", mimeType: "text/plain")]),
            .init(id: "terminal", role: "assistant", text: " \n "),
            .init(id: "u2", role: "user", text: "Second turn"),
            .init(id: "empty", role: "assistant", text: ""),
        ]
        let visible = TranscriptMetadata.applying(cache, to: messages)
        XCTAssertEqual(visible.map(\.id), ["u1", "a1", "files", "u2", "empty"])
        XCTAssertEqual(visible.compactMap(\.workedDuration), [720, 2])
        XCTAssertEqual(visible.first(where: { $0.id == "files" })?.workedDuration, 720)
        XCTAssertEqual(visible.first(where: { $0.id == "a1" })?.subagents.first?.title, "Review spacing")
        XCTAssertEqual(try XCTUnwrap(visible.first?.timestamp).timeIntervalSince1970, 1_700_000_000.123, accuracy: 0.001)
        XCTAssertNil(visible.first(where: { $0.id == "u2" })?.timestamp)
        let running = TranscriptMetadata.applying(cache, to: messages, latestTurnRunning: true)
        XCTAssertEqual(running.compactMap(\.workedDuration), [720], "Only the active turn loses its footer while the host is working")
        XCTAssertFalse(running.contains(where: { $0.id == "empty" }))
    }

    func testLaterAbortedUnknownOrStreamingEntrySuppressesEarlierCompletedFooter() throws {
        var cache = TranscriptMetadata.Cache()
        cache.apply(try decode(#"{"entries":[{"id":"earlier","role":"assistant","status":"complete","durationMs":720000}]}"#))
        let base: [TranscriptMessage] = [
            .init(id: "u", role: "user", text: "Turn"),
            .init(id: "earlier", role: "assistant", text: "Intermediate result"),
            .init(id: "last", role: "assistant", text: ""),
        ]
        for status in ["aborted", "streaming", "unknown"] {
            cache.apply(try decode("{\"entries\":[{\"id\":\"last\",\"role\":\"assistant\",\"status\":\"\(status)\",\"durationMs\":1000}]}"))
            XCTAssertTrue(TranscriptMetadata.applying(cache, to: base).allSatisfy { $0.workedDuration == nil })
        }
        cache.apply(try decode(#"{"entries":[{"id":"last","role":"assistant","status":"complete","durationMs":1000}]}"#))
        var streaming = base
        streaming[1].streaming = true
        XCTAssertTrue(TranscriptMetadata.applying(cache, to: streaming).allSatisfy { $0.workedDuration == nil })
        cache.apply(try decode(#"{"removedIDs":["last"]}"#))
        XCTAssertTrue(TranscriptMetadata.applying(cache, to: base).allSatisfy { $0.workedDuration == nil })
    }

    private func decode(_ payload: String) throws -> TranscriptMetadata.Update {
        try XCTUnwrap(TranscriptMetadata.decode("[{\"sessionID\":\"s\",\"messageMetadata\":\(payload)}]")["s"])
    }
}
