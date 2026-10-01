import XCTest
import ZRemoteCore

final class UnifiedDiffParserTests: XCTestCase {
    func testCapturedTurnKeepsSevenFilePatchesIsolatedAndCountsUnknownForBinary() async throws {
        var patch = ""
        for index in 1...7 {
            patch += "diff --git a/file\(index).txt b/file\(index).txt\r\n"
            if index == 7 {
                patch += "Binary files a/file7.txt and b/file7.txt differ\r\n"
            } else {
                patch += "--- a/file\(index).txt\r\n+++ b/file\(index).txt\r\n@@ -1 +1 @@\r\n-old\(index)\r\n+new\(index)\r\n"
            }
        }
        let capture = try await CapturedTurnChanges.capture(sessionID: "session", turnID: "turn", patch: patch)
        XCTAssertEqual(capture.files.count, 7)
        XCTAssertEqual(capture.sessionID, "session")
        XCTAssertEqual(capture.turnID, "turn")
        for (index, file) in capture.files.enumerated() {
            let ownPatch = try XCTUnwrap(file.patch)
            let reparsed = UnifiedDiffParser.parse(ownPatch)
            XCTAssertEqual(reparsed.files.count, 1)
            XCTAssertEqual(reparsed.files.first?.path, "file\(index + 1).txt")
            XCTAssertEqual(file.document.patch, ownPatch)
            XCTAssertTrue(ownPatch.contains("\r\n"))
            if index < 6 {
                XCTAssertEqual(file.additions, 1)
                XCTAssertEqual(file.deletions, 1)
            } else {
                XCTAssertNil(file.additions)
                XCTAssertNil(file.deletions)
                XCTAssertTrue(file.isBinary)
            }
        }
        let persisted = try JSONEncoder().encode(capture)
        XCTAssertEqual(try JSONDecoder().decode(CapturedTurnChanges.self, from: persisted), capture)
    }

    func testUnicodeCRLFAndCodeResemblingFileHeadersKeepTheirLineNumbers() throws {
        let patch = [
            "diff --git a/é.swift b/é.swift",
            "--- a/é.swift",
            "+++ b/é.swift",
            "@@ -10,3 +10,3 @@ café",
            " let greeting = \"👋🏽\"",
            "--- old heading",
            "+++ new heading",
            " let end = true",
            ""
        ].joined(separator: "\r\n")

        let parsed = UnifiedDiffParser.parse(patch)
        XCTAssertEqual(parsed.files.count, 1)
        let file = try XCTUnwrap(parsed.files.first)
        XCTAssertEqual(file.path, "é.swift")
        XCTAssertFalse(file.isPartial)
        XCTAssertEqual(file.additions, 1)
        XCTAssertEqual(file.deletions, 1)
        let lines = try XCTUnwrap(file.hunks.first).lines
        XCTAssertEqual(lines.map(\.text), ["let greeting = \"👋🏽\"", "-- old heading", "++ new heading", "let end = true"])
        XCTAssertEqual(lines.map(\.oldLine), [10, 11, nil, 12])
        XCTAssertEqual(lines.map(\.newLine), [10, nil, 11, 12])
    }

    func testNewDeletedRenamedAndBinaryFilesRetainTheirIdentity() throws {
        let patch = """
        --- /dev/null
        +++ b/new.txt
        @@ -0,0 +1 @@
        +hello
        --- a/deleted.txt
        +++ /dev/null
        @@ -1 +0,0 @@
        -goodbye
        diff --git a/old name.txt b/new name.txt
        similarity index 100%
        rename from old name.txt
        rename to new name.txt
        diff --git a/image.png b/image.png
        Binary files a/image.png and b/image.png differ
        """

        let files = UnifiedDiffParser.parse(patch).files
        XCTAssertEqual(files.count, 4)
        guard files.count == 4 else { return }
        XCTAssertNil(files[0].oldPath)
        XCTAssertEqual(files[0].newPath, "new.txt")
        XCTAssertEqual(files[0].additions, 1)
        XCTAssertEqual(files[1].oldPath, "deleted.txt")
        XCTAssertNil(files[1].newPath)
        XCTAssertEqual(files[1].deletions, 1)
        XCTAssertEqual(files[2].oldPath, "old name.txt")
        XCTAssertEqual(files[2].newPath, "new name.txt")
        XCTAssertTrue(files[2].hunks.isEmpty)
        XCTAssertTrue(files[3].isBinary)
        XCTAssertEqual(files[3].path, "image.png")
    }

    func testQuotedGitUTF8PathsAndMissingFinalNewlineAreNotCorrupted() throws {
        let patch = #"""
        diff --git "a/caf\303\251 name.txt" "b/caf\303\251 name.txt"
        --- "a/caf\303\251 name.txt"
        +++ "b/caf\303\251 name.txt"
        @@ -1 +1 @@
        -old
        \ No newline at end of file
        +nøy
        \ No newline at end of file
        """#

        let file = try XCTUnwrap(UnifiedDiffParser.parse(patch).files.first)
        XCTAssertEqual(file.path, "café name.txt")
        XCTAssertFalse(file.isPartial)
        XCTAssertEqual(file.additions, 1)
        XCTAssertEqual(file.deletions, 1)
        XCTAssertEqual(file.hunks.first?.lines.map(\.kind), [.deletion, .noNewline, .addition, .noNewline])
        XCTAssertEqual(file.hunks.first?.lines[2].text, "nøy")
    }

    func testIncompleteAndBoundedPatchesNeverAppearComplete() throws {
        let incomplete = """
        diff --git a/file.txt b/file.txt
        --- a/file.txt
        +++ b/file.txt
        @@ -1,2 +1,2 @@
        -old
        +new
        """
        let file = try XCTUnwrap(UnifiedDiffParser.parse(incomplete).files.first)
        XCTAssertTrue(file.isPartial)
        XCTAssertEqual(file.hunks.first?.lines.count, 2)

        let complete = incomplete + "\n unchanged\n"
        XCTAssertFalse(try XCTUnwrap(UnifiedDiffParser.parse(complete).files.first).isPartial)
        let bounded = UnifiedDiffParser.parse(complete, maximumLines: 5)
        XCTAssertTrue(bounded.isTruncated)
        XCTAssertTrue(try XCTUnwrap(bounded.files.first).isPartial)
        XCTAssertEqual(bounded.files.first?.hunks.first?.lines.count, 1)

        let byteBounded = UnifiedDiffParser.parse(complete, maximumBytes: 12)
        XCTAssertTrue(byteBounded.isTruncated)
        XCTAssertTrue(byteBounded.files.isEmpty)

        let minified = "diff --git a/code.js b/code.js\n--- /dev/null\n+++ b/code.js\n@@ -0,0 +1 @@\n+" + String(repeating: "x", count: 30_000) + "\n"
        let boundedLine = try XCTUnwrap(UnifiedDiffParser.parse(minified).files.first)
        XCTAssertTrue(boundedLine.isPartial)
        XCTAssertLessThan(try XCTUnwrap(boundedLine.hunks.first?.lines.first?.text.utf8.count), 16_384)
    }

    func testMalformedAndCombinedHunksAreMarkedUnsupported() {
        let malformed = """
        diff --git a/file b/file
        @@ -1,999999999999999999999999999 +1 @@
        +not a valid preview
        """
        let parsed = UnifiedDiffParser.parse(malformed)
        XCTAssertTrue(parsed.hasUnsupportedContent)
        XCTAssertTrue(parsed.files.first?.isPartial == true)
        XCTAssertTrue(parsed.files.first?.hunks.isEmpty == true)

        let combined = UnifiedDiffParser.parse("diff --cc file\n@@@ -1,1 -1,1 +1,1 @@@\n++merged\n")
        XCTAssertTrue(combined.hasUnsupportedContent)
        XCTAssertTrue(combined.files.isEmpty)
    }
}
