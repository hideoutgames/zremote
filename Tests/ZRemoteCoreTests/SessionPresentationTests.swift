import Foundation
import XCTest
import ZRemoteCore

final class SessionPresentationTests: XCTestCase {
    func testProjectMonogramMatchesOfficialInitialAndPathColors() {
        let samples: [(String, String, String, Int)] = [
            ("  zremote\t", "/work/zremote", "Z", 0),
            ("ZRemote", "C:\\Projects\\ZRemote", "Z", 2),
            ("ångström", "/Users/demo/ångström", "Å", 3),
            (" \t ", "", "?", 5),
        ]
        for (name, path, letter, index) in samples {
            let icon = ProjectMonogram(project: Project(id: "project", name: name, path: path, hostID: "host"))
            XCTAssertEqual(icon.letter, letter)
            XCTAssertEqual(icon.colorIndex, index)
        }
    }

    func testProjectMonogramUsesProjectPathAcrossWorktreesRenamesAndListChanges() throws {
        var project = Project(id: "project", name: "ZRemote", path: "/work/zremote", hostID: "host")
        let unrelated = Project(id: "other", name: "Another", path: "/work/other", hostID: "host")
        let session = Session(id: "session", title: "Example", projectID: project.id, hostID: "host", path: "/work/zremote-worktree")
        let original = try XCTUnwrap(SessionPresentationRules.projectMonogram(for: session, projects: [unrelated, project],
                                                                             groupedByProject: false, selectedProjectID: nil))
        XCTAssertEqual(original.colorIndex, 0)
        project.name = "Renamed project"
        let renamed = try XCTUnwrap(SessionPresentationRules.projectMonogram(for: session, projects: [project],
                                                                            groupedByProject: false, selectedProjectID: nil))
        XCTAssertEqual(renamed.colorIndex, original.colorIndex)
        XCTAssertEqual(renamed.letter, "R")
        XCTAssertEqual(renamed.name, "Renamed project")
    }

    func testProjectMonogramHidesForProjectGroupingOrExplicitProjectFilter() {
        let project = Project(id: "project", name: "ZRemote", path: "/work/zremote", hostID: "host")
        let session = Session(id: "session", title: "Example", projectID: project.id, hostID: "host")
        for groupedByProject in [false, true] {
            for selectedProjectID: String? in [nil, project.id] {
                let icon = SessionPresentationRules.projectMonogram(for: session, projects: [project],
                                                                    groupedByProject: groupedByProject, selectedProjectID: selectedProjectID)
                // A one-project result still needs its badge until explicitly scoped.
                if !groupedByProject && selectedProjectID == nil { XCTAssertEqual(icon?.letter, "Z") }
                else { XCTAssertNil(icon) }
            }
        }
    }

    func testProjectlessAndMissingProjectsUseOfficialHomeMonogram() {
        for projectID: String? in [nil, "removed-project"] {
            let session = Session(id: "session", title: "Example", projectID: projectID, hostID: "host", path: "/some/checkout")
            let icon = SessionPresentationRules.projectMonogram(for: session, projects: [], groupedByProject: false, selectedProjectID: nil)
            XCTAssertEqual(icon?.name, "Home")
            XCTAssertEqual(icon?.letter, "H")
            XCTAssertEqual(icon?.colorIndex, 6)
        }
    }

    func testLatestObservedPullRequestSurvivesMissingBranchMetadataWhileHostRemainsAuthoritative() {
        var session = Session(id: "session", title: "Example", hostID: "host")
        let first = PullRequest(number: 41, title: "First", url: "", state: "merged")
        let latest = PullRequest(number: 42, title: "Latest", url: "", state: "merged")
        let unrelated = PullRequest(number: 43, title: "Other session", url: "", state: "open")
        let observations = [
            ObservedPullRequest(sessionID: session.id, afterMessageID: nil, request: first),
            ObservedPullRequest(sessionID: session.id, afterMessageID: nil, request: latest),
            ObservedPullRequest(sessionID: "other", afterMessageID: nil, request: unrelated),
        ]
        XCTAssertNil(SessionPresentationRules.pullRequest(for: session, observed: []))
        XCTAssertEqual(SessionPresentationRules.pullRequest(for: session, observed: observations), latest)
        session.pullRequest = PullRequest(number: 42, title: "Updated by host", url: "", state: "closed")
        XCTAssertEqual(SessionPresentationRules.pullRequest(for: session, observed: observations), session.pullRequest)
    }

    func testAttentionStatesOverrideUnreadAndWorking() {
        var session = Session(id: "session", title: "Example", hostID: "host", unread: true)
        XCTAssertEqual(SessionPresentationRules.indicator(for: session), .unread)
        session.working = true
        XCTAssertEqual(SessionPresentationRules.indicator(for: session), .working)
        session.awaitingInput = true
        XCTAssertEqual(SessionPresentationRules.indicator(for: session), .awaitingInput)
        session.failed = true
        XCTAssertEqual(SessionPresentationRules.indicator(for: session), .failed)
        session.failed = false; session.awaitingInput = false; session.working = false; session.unread = false
        XCTAssertEqual(SessionPresentationRules.indicator(for: session), .idle)
    }

    func testExpandedRowsUseCompletionTimeAndNeverMessagePreviewsOrUpdateTime() {
        let now = Date(timeIntervalSince1970: 100_000)
        var session = Session(id: "session", title: "Example", hostID: "host", preview: "Ready when you are",
                              updatedAt: now.addingTimeInterval(-300))
        XCTAssertNil(SessionPresentationRules.detail(for: session, now: now))
        session.lastFinishedAt = now.addingTimeInterval(-720)
        XCTAssertEqual(SessionPresentationRules.detail(for: session, now: now), "12 minutes ago")
        session.lastFinishedAt = now.addingTimeInterval(-60)
        XCTAssertEqual(SessionPresentationRules.detail(for: session, now: now), "1 minute ago")
        session.lastFinishedAt = now.addingTimeInterval(-3_600)
        XCTAssertEqual(SessionPresentationRules.detail(for: session, now: now), "1 hour ago")
        session.lastFinishedAt = now.addingTimeInterval(-172_800)
        XCTAssertEqual(SessionPresentationRules.detail(for: session, now: now), "2 days ago")
        session.lastFinishedAt = now.addingTimeInterval(10)
        XCTAssertEqual(SessionPresentationRules.detail(for: session, now: now), "Just now")
    }

    func testRunningAndWaitingDetailsReplacePreviousCompletionTime() {
        var session = Session(id: "session", title: "Example", hostID: "host", preview: "Private message", working: true)
        session.lastFinishedAt = Date(timeIntervalSince1970: 10)
        XCTAssertEqual(SessionPresentationRules.detail(for: session), "Working")
        session.activity = "  Reviewing changes  "
        XCTAssertEqual(SessionPresentationRules.detail(for: session), "Reviewing changes")
        session.awaitingInput = true
        XCTAssertEqual(SessionPresentationRules.detail(for: session), "Waiting for response")
    }

    func testPullRequestBadgeHonorsDraftAndTerminalState() {
        var request = PullRequest(number: 42, title: "Change", url: "", state: "OPEN")
        XCTAssertEqual(PullRequestPresentationState(request), .open)
        request.isDraft = true
        XCTAssertEqual(PullRequestPresentationState(request), .draft)
        request.state = "merged"
        XCTAssertEqual(PullRequestPresentationState(request), .merged)
        request.state = "closed"
        XCTAssertEqual(PullRequestPresentationState(request), .closed)
        request.isDraft = false; request.state = " draft "
        XCTAssertEqual(PullRequestPresentationState(request), .draft)
        request.state = "unknown-host-state"
        XCTAssertEqual(PullRequestPresentationState(request), .unknown)
    }
}
