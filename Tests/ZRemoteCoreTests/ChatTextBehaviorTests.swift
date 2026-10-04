import Foundation
import XCTest
import ZRemoteCore

final class ChatTextBehaviorTests: XCTestCase {
    func testCompletionUsesCaretAndPreservesUnicodeAndFollowingText() throws {
        let text = "🪴 Update @Sources/Compo.swift today"
        let caret = ("🪴 Update @Sources/Com" as NSString).length
        let token = try XCTUnwrap(ChatText.activeToken(in: text, cursorUTF16: caret))
        XCTAssertEqual(token.kind, .file)
        XCTAssertEqual(token.query, "Sources/Com")
        let result = try XCTUnwrap(ChatText.inserting("Sources/Composer.swift", for: token, in: text))
        XCTAssertEqual(result.text, "🪴 Update @Sources/Composer.swift today")
        XCTAssertEqual(result.cursorUTF16, ("🪴 Update @Sources/Composer.swift" as NSString).length)
        XCTAssertNil(ChatText.activeToken(in: text, cursorUTF16: -1))
        XCTAssertNil(ChatText.inserting("a", for: token, in: "Another draft"))
    }

    func testTokenBoundariesAvoidEmailAndURLAndKeepQuotedFileNames() throws {
        let text = "Email me@example.com https://example.com/a then /review $design @\"Sources/My View.swift\""
        XCTAssertEqual(ChatText.tokens(in: text).map(\.kind), [.command, .skill, .file])
        let token = try XCTUnwrap(ChatText.activeToken(in: "Check @Sou", cursorUTF16: 10))
        let result = try XCTUnwrap(ChatText.inserting("Sources/My View.swift", for: token, in: "Check @Sou"))
        XCTAssertEqual(result.text, "Check @\"Sources/My View.swift\" ")
        XCTAssertEqual(ChatText.tokens(in: result.text).last?.query, "Sources/My View.swift")
        XCTAssertNil(ChatText.activeToken(in: result.text, cursorUTF16: (result.text as NSString).length))
    }

    func testProseBoundariesDoNotStackBlankLinesAroundCodeOrCreateEmptyBlocks() {
        let text = "\n\n Before\n\n\n```swift\n  let x = 1\n\n```\n\n  \nAfter\n\n"
        let blocks = ChatText.blocks(in: text)
        XCTAssertEqual(blocks.map(\.text), ["Before", "  let x = 1\n\n", "After"])
        XCTAssertEqual(blocks.map(\.isCode), [false, true, false])
        XCTAssertTrue(ChatText.blocks(in: " \n\r\n ").isEmpty)
    }

    func testCopyableCodePreservesBytesAndHandlesLongAndUnfinishedFences() {
        let text = "Before\n````swift\nlet x = \"```\"\r\n  print(x)\n````\nBetween\n~~~sh\necho ready\n~~~\nAfter"
        let blocks = ChatText.blocks(in: text)
        XCTAssertEqual(blocks.map(\.isCode), [false, true, false, true, false])
        XCTAssertEqual(blocks[1].text, "let x = \"```\"\r\n  print(x)\n")
        XCTAssertEqual(blocks[1].language, "swift")
        XCTAssertEqual(blocks[3].text, "echo ready\n")
        let partial = ChatText.blocks(in: "Starting\n```python\n  print('hello')")
        XCTAssertEqual(partial.last?.text, "  print('hello')")
        XCTAssertEqual(partial.last?.isCode, true)
        XCTAssertEqual(ChatText.blocks(in: "```swift\r\nlet x = 1\r\n```\r\n").first?.text, "let x = 1\r\n")
    }
}
