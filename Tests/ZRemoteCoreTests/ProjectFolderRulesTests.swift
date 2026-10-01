import XCTest
import ZRemoteCore

final class ProjectFolderRulesTests: XCTestCase {
    func testExistingFolderSelectionRespectsHostAndCaseSensitiveRemotePaths() {
        let project = Project(id: "one", name: "Project", path: "/Users/me/Project/", hostID: "mac")
        XCTAssertEqual(ProjectFolderRules.project(at: "/Users/me/Project", hostID: "mac", projects: [project]), project)
        XCTAssertNil(ProjectFolderRules.project(at: "/Users/me/Project", hostID: "another-mac", projects: [project]))
        XCTAssertNil(ProjectFolderRules.project(at: "/Users/me/project", hostID: "mac", projects: [project]))
        XCTAssertNil(ProjectFolderRules.project(at: "/Users/me/Project/child", hostID: "mac", projects: [project]))
    }

    func testWindowsFolderAndProjectMetadataMatchAcrossPathSeparators() {
        let project = Project(id: "one", name: "Project", path: "C:\\Work\\Project\\", hostID: "windows")
        XCTAssertEqual(ProjectFolderRules.project(at: "c:/work/project", hostID: "windows", projects: [project]), project)
        let root = Project(id: "root", name: "Root", path: "C:\\", hostID: "windows")
        XCTAssertEqual(ProjectFolderRules.project(at: "c:/", hostID: "windows", projects: [root]), root)
        XCTAssertNil(ProjectFolderRules.project(at: "C:", hostID: "windows", projects: [root]))
        let share = Project(id: "share", name: "Shared", path: "\\\\Server\\Share\\Project\\", hostID: "windows")
        XCTAssertEqual(ProjectFolderRules.project(at: "//server/share/project", hostID: "windows", projects: [share]), share)
        let slashShare = Project(id: "slash-share", name: "Shared", path: "//Server/Share/Project", hostID: "windows")
        XCTAssertEqual(ProjectFolderRules.project(at: "\\\\server\\share\\project", hostID: "windows", projects: [slashShare]), slashShare)
    }

    func testFolderBrowserDoesNotExposeGitMetadataEvenWithMislabelledRows() {
        XCTAssertFalse(ProjectFolderRules.visible(RemoteFolder(name: ".GIT", path: "/repo/.GIT")))
        XCTAssertFalse(ProjectFolderRules.visible(RemoteFolder(name: "objects", path: "C:\\repo\\.git\\objects")))
        XCTAssertFalse(ProjectFolderRules.visible(RemoteFolder(name: "metadata", path: "/repo/.git")))
        XCTAssertTrue(ProjectFolderRules.visible(RemoteFolder(name: ".github", path: "/repo/.github")))
        XCTAssertTrue(ProjectFolderRules.visible(RemoteFolder(name: "Sources", path: "/repo/Sources")))
    }
}
