import Foundation
import XCTest
import ZRemoteCore

final class ComposerReferenceTextTests: XCTestCase {
    private let file = "[app.swift](zeron-file:Sources/app.swift)"
    private func invocation(_ kind: String = "command", name: String = "review") -> String {
        let path = kind == "skill" ? ",\"path\":\"skills/review/SKILL.md\"" : ""
        let payload = "{\"kind\":\"\(kind)\",\"name\":\"\(name)\"\(path)}".utf8.map { String(format: "%02x", $0) }.joined()
        return "[\(kind == "command" ? "/" : "$")\(name)](zeron-invoke:\(payload))"
    }

    func testCompactPresentationRetainsPayloadsAndUnicodeOffsets() {
        let source = "👋 \(invocation())\n\(invocation("skill", name: "design")) \(file) [My folder](zeron-file:Sources/My%20folder/)"
        let document = ComposerReferenceText(source)
        XCTAssertEqual(document.source, source)
        XCTAssertEqual(document.text, "👋 /review\n$design @app.swift @My folder/")
        XCTAssertEqual(document.references.map(\.kind), [.command, .skill, .file, .file])
        for reference in document.references {
            XCTAssertEqual(document.sourceOffset(reference.displayRange.location), reference.sourceRange.location)
            XCTAssertEqual(document.sourceOffset(NSMaxRange(reference.displayRange)), NSMaxRange(reference.sourceRange))
            XCTAssertEqual(document.displayOffset(reference.sourceRange.location), reference.displayRange.location)
            XCTAssertEqual(document.displayOffset(NSMaxRange(reference.sourceRange)), NSMaxRange(reference.displayRange))
        }
        XCTAssertEqual(document.editing(document.text + "!", selection: NSRange(location: (document.text as NSString).length, length: 0)).text, source + "!")
    }

    func testSelectedCompletionsInsertExactHostReferencesWithoutExtraPrefixes() throws {
        for (query, value) in [("/rev", invocation()), ("$rev", invocation("skill")), ("@app", file)] {
            let text = "👋 \(query) later"
            let token = try XCTUnwrap(ChatText.activeToken(in: text, cursorUTF16: 3 + (query as NSString).length))
            let inserted = try XCTUnwrap(ChatText.inserting(value, for: token, in: text))
            XCTAssertEqual(inserted.text, "👋 \(value) later")
            XCTAssertEqual(inserted.cursorUTF16, ("👋 \(value)" as NSString).length)
            XCTAssertEqual(ComposerReferenceText(inserted.text).references.count, 1)
            XCTAssertNil(ChatText.activeToken(in: inserted.text, cursorUTF16: inserted.cursorUTF16))
        }
    }

    func testBackspaceForwardDeleteAndPartialReplacementConsumeWholeReferences() throws {
        for value in [invocation(), invocation("skill"), file] {
            let document = ComposerReferenceText("before \(value) after")
            let token = try XCTUnwrap(document.references.first)
            for inSource in [false, true] {
                let range = inSource ? token.sourceRange : token.displayRange
                let text = (inSource ? document.source : document.text) as NSString
                let backspace = text.replacingCharacters(in: NSRange(location: NSMaxRange(range) - 1, length: 1), with: "")
                let deleted = document.editing(backspace, selection: NSRange(location: NSMaxRange(range), length: 0), inSource: inSource)
                XCTAssertEqual(deleted.text, "before  after")
                XCTAssertEqual(deleted.cursorUTF16, 7)
                let forward = text.replacingCharacters(in: NSRange(location: range.location, length: 1), with: "")
                XCTAssertEqual(document.editing(forward, selection: NSRange(location: range.location, length: 0), inSource: inSource).text, "before  after")
                XCTAssertEqual(document.replacing(NSRange(location: range.location + 1, length: 2), with: "new", inSource: inSource).text, "before new after")
            }
        }
    }

    func testEqualVisibleLabelsPreserveTheSelectedFileIdentity() {
        let first = "[app.swift](zeron-file:one/app.swift)", second = "[app.swift](zeron-file:two/app.swift)"
        let document = ComposerReferenceText(first + second)
        XCTAssertEqual(document.editing("@app.swift", selection: NSRange(location: 0, length: 10)).text, second)
        XCTAssertEqual(document.editing("@app.swift", selection: NSRange(location: 10, length: 10)).text, first)
        let text = ComposerReferenceText(invocation() + " then " + invocation("skill") + " and " + file)
        let range = NSRange(location: 2, length: NSMaxRange(text.references[1].displayRange) - 3)
        XCTAssertEqual(text.replacing(range, with: "instead").text, "instead and " + file)
    }

    func testCaretArrowsSkipReferencesAndSelectionsExpand() throws {
        let document = ComposerReferenceText("x " + file + " y")
        for inSource in [false, true] {
            let reference = try XCTUnwrap(document.references.first)
            let range = inSource ? reference.sourceRange : reference.displayRange
            XCTAssertEqual(document.selection(NSRange(location: range.location + 1, length: 0), previous: NSRange(location: range.location, length: 0), inSource: inSource), NSRange(location: NSMaxRange(range), length: 0))
            XCTAssertEqual(document.selection(NSRange(location: NSMaxRange(range) - 1, length: 0), previous: NSRange(location: NSMaxRange(range), length: 0), inSource: inSource), NSRange(location: range.location, length: 0))
            XCTAssertEqual(document.selection(NSRange(location: range.location + 1, length: 2), inSource: inSource), range)
        }
    }

    func testCodeEscapesCommentsImagesAndOrdinaryLinksStayLiteral() {
        for value in ["`\(file)`", "``code ` \(file)``", "```swift\n\(file)\n```", "~~~\n\(file)", "    \(file)\n",
                      "\\\(file)", "![nested \(file)](image.png)", "<!-- \(file) -->", "[site](https://example.com)"] {
            XCTAssertEqual(ComposerReferenceText(value).text, value)
            XCTAssertTrue(ComposerReferenceText(value).references.isEmpty)
        }
        XCTAssertEqual(ComposerReferenceText("```\n\(file)\n```\n\(file)").references.count, 1)
    }

    func testMalformedOrMismatchedReferencesRemainEditableText() {
        for value in ["[/broken](zeron-invoke:7b226b696e64223a22636f6d6d616e64227d)", "[/x](zeron-invoke:0g)",
                      "[wrong](zeron-file:Sources/app.swift)", "[x](zeron-file:../x)", "[x](zeron-file:.git/x)",
                      "[x](zeron-file:%ZZ)", invocation().replacingOccurrences(of: "[/review]", with: "[/wrong]")] {
            XCTAssertEqual(ComposerReferenceText(value).text, value)
            XCTAssertTrue(ComposerReferenceText(value).references.isEmpty)
        }
    }

    func testOrdinaryTypingWhitespaceAndUnicodeRemainNormalEdits() {
        XCTAssertEqual(ComposerReferenceText("/rev").editing("/re", selection: NSRange(location: 4, length: 0)).text, "/re")
        let document = ComposerReferenceText(invocation() + " ")
        let withoutSpace = document.editing("/review", selection: NSRange(location: 8, length: 0))
        XCTAssertEqual(withoutSpace.text, invocation())
        XCTAssertEqual(ComposerReferenceText(withoutSpace.text).editing("/revie", selection: NSRange(location: 7, length: 0)).text, "")
        XCTAssertEqual(ComposerReferenceText("🪴 then " + file).editing("👋 then @app.swift", selection: NSRange(location: 0, length: 0)).text, "👋 then " + file)
        let pasted = ComposerReferenceText("Read ").editing("Read " + file, selection: NSRange(location: 5, length: 0))
        XCTAssertEqual(ComposerReferenceText(pasted.text).text, "Read @app.swift")
    }
}
