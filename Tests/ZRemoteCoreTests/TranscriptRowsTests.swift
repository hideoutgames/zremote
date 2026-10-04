import XCTest
import ZRemoteCore

final class TranscriptRowsTests: XCTestCase {
    func testLargeTranscriptKeepsStableIdentityWhenTailStreams() async throws {
        let builder = TranscriptRowBuilder()
        var messages = (0..<1000).map {
            TranscriptMessage(id: "message-\($0)", role: "assistant", text: "Pass \($0)\n\n```swift\nlet pass = \($0)\n```\n\nDone.")
        }
        let first = try await builder.rows(messages: messages, changes: [:], pullRequests: [:], unanchored: [], working: true)
        XCTAssertEqual(first.count, 3001)
        XCTAssertEqual(Set(first.map(\.id)).count, first.count)
        messages[999].text += "\nMore results."
        messages[999].streaming = true
        let second = try await builder.rows(messages: messages, changes: [:], pullRequests: [:], unanchored: [], working: true)
        XCTAssertEqual(first.map(\.id), second.map(\.id))
        XCTAssertEqual(Array(first.prefix(2997)), Array(second.prefix(2997)))
        XCTAssertNotEqual(first[2999], second[2999])
    }

    func testMetadataStaysBesideItsMessageAndSurvivesEmptyText() async throws {
        let builder = TranscriptRowBuilder()
        let agent = SubagentStatus(id: "agent", title: "Review", status: "working")
        let attachment = RemoteAttachment(path: "image.png", name: "Image", mimeType: "image/png")
        let message = TranscriptMessage(id: "response", role: "assistant", text: "",
                                        attachments: [attachment], subagents: [agent], workedDuration: 42)
        let request = PullRequest(number: 7, title: "Changes", url: "", state: "open", provider: "Demo")
        let rows = try await builder.rows(messages: [message], changes: [:],
                                         pullRequests: [message.id: [request]], unanchored: [], working: false)
        XCTAssertEqual(rows.map(\.id.kind), ["attachments", "subagent", "completion", "pr"])
        XCTAssertTrue(rows.allSatisfy { $0.id.messageID == message.id })
        XCTAssertEqual(rows[2].content, .completion(nil, duration: 42))
        XCTAssertEqual(rows[3].content, .pullRequest(request))
    }

    func testLongTextIsBoundedWithoutLosingUnicodeOrCodeBytes() async throws {
        let builder = TranscriptRowBuilder()
        let text = String(repeating: "A paragraph with 👩🏽‍💻 and café.\n\n", count: 600)
        let code = "let value = \"👩🏽‍💻\"\n"
        let rows = try await builder.rows(messages: [.init(id: "large", role: "assistant", text: text + "```swift\n" + code + "```")],
                                         changes: [:], pullRequests: [:], unanchored: [], working: false)
        var joined = ""
        var codes: [String] = []
        for row in rows {
            switch row.content {
            case .text(let value, _, _):
                XCTAssertLessThan(value.count, 4100)
                joined += value
            case .code(let value, _): codes.append(value)
            default: XCTFail("Unexpected row")
            }
        }
        XCTAssertEqual(joined, text)
        XCTAssertEqual(codes, [code])
        XCTAssertGreaterThan(rows.count, 3)
    }

    func testSessionReplacementAndFinalMarkdownDoNotReuseStaleRows() async throws {
        let builder = TranscriptRowBuilder()
        let streaming = TranscriptMessage(id: "same", role: "assistant", text: "**Draft**", streaming: true)
        let first = try await builder.rows(messages: [streaming], changes: [:], pullRequests: [:], unanchored: [], working: true)
        XCTAssertEqual(first[0].content, .text("**Draft**", markdown: false, secondary: false))
        let second = try await builder.rows(messages: [.init(id: "same", role: "assistant", text: "Replacement")],
                                          changes: [:], pullRequests: [:], unanchored: [], working: false)
        XCTAssertEqual(second.count, 1)
        XCTAssertEqual(second[0].content, .text("Replacement", markdown: true, secondary: false))
        XCTAssertEqual(first[0].id, second[0].id)
    }
}
