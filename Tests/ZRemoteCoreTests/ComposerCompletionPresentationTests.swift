import XCTest
import ZRemoteCore

final class ComposerCompletionPresentationTests: XCTestCase {
    func testRowsUsePrefixesBasenamesAndFileTypes() {
        let command = ComposerCompletion(id: "review", kind: .command, title: "review", detail: "Review changes", insertion: "ignored")
        let skill = ComposerCompletion(id: "design", kind: .skill, title: "$design", detail: "Design a screen", insertion: "ignored")
        XCTAssertEqual(command.displayTitle, "/review"); XCTAssertEqual(command.displayDetail, "Review changes"); XCTAssertNil(command.fileSymbol)
        XCTAssertEqual(skill.displayTitle, "$design"); XCTAssertNil(skill.fileSymbol)
        let code = ComposerCompletion(id: "swift", kind: .file, title: "Sources/My View.swift", insertion: "ignored")
        XCTAssertEqual(code.displayTitle, "My View.swift"); XCTAssertEqual(code.displayDetail, "SWIFT file")
        XCTAssertEqual(code.fileSymbol, "chevron.left.forwardslash.chevron.right")
        let folder = ComposerCompletion(id: "folder", kind: .file, title: "Sources/Views", detail: "Folder", insertion: "ignored")
        XCTAssertEqual(folder.displayTitle, "Views"); XCTAssertEqual(folder.displayDetail, "Folder"); XCTAssertEqual(folder.fileSymbol, "folder")
    }

    func testFilteringAppliesCurrentKindAndQueryWithoutTruncatingScrollableResults() {
        let commands = (0..<20).map { ComposerCompletion(id: "\($0)", kind: .command, title: "review-\($0)", insertion: "ignored") }
        let skill = ComposerCompletion(id: "skill", kind: .skill, title: "review", insertion: "ignored")
        XCTAssertEqual(ComposerCompletionPresentation.filter(commands + [skill, commands[0]], kind: .command, query: "REV").count, 20)
        XCTAssertEqual(ComposerCompletionPresentation.filter(commands, kind: .command, query: "xyz"), [])
        XCTAssertEqual(ComposerCompletionPresentation.filter(commands, kind: .skill, query: ""), [])
    }

    func testFileFilteringUsesPathsAndRejectsGitMetadata() {
        let items = ["Sources/Composer.swift", "Sources/Model.swift", ".git/config", "pkg/.GIT/config"].map {
            ComposerCompletion(id: $0, kind: .file, title: $0, insertion: "ignored")
        }
        XCTAssertEqual(ComposerCompletionPresentation.filter(items, kind: .file, query: "SrcCmp").map(\.title), ["Sources/Composer.swift"])
        XCTAssertEqual(ComposerCompletionPresentation.filter(items, kind: .file, query: "Sources\\Mod").map(\.title), ["Sources/Model.swift"])
        XCTAssertEqual(ComposerCompletionPresentation.filter(items, kind: .file, query: "").count, 2)
    }
}
