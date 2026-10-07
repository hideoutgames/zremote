import Foundation
import XCTest
import ZRemoteCore

final class SessionExperienceTests: XCTestCase {
    func testUngroupedDefaultHasNoHeaderAndGroupsFollowLatestActivityEvenWhenPinnedOrTitleSorted() throws {
        let preferences = try JSONDecoder().decode(LocalPreferences.self, from: Data("{}".utf8))
        XCTAssertEqual(preferences.sessionList.grouping, .none)
        let projects = [Project(id: "a", name: "A", path: "/a", hostID: "one"), Project(id: "z", name: "Z", path: "/z", hostID: "two")]
        let hosts = [Host(id: "one", name: "A", online: true), Host(id: "two", name: "Z", online: true)]
        let rows = [
            Session(id: "old", title: "A", projectID: "a", hostID: "one", pinned: true, updatedAt: Date(timeIntervalSince1970: 1)),
            Session(id: "new", title: "Z", projectID: "z", hostID: "two", updatedAt: Date(timeIntervalSince1970: 10)),
        ]
        let plain = SessionListPresentation.sections(rows, projects: projects, hosts: hosts, grouping: .none, projectID: nil)
        XCTAssertEqual(plain.flatMap(\.sessions).map(\.id), ["old", "new"])
        XCTAssertFalse(try XCTUnwrap(plain.first).showsHeader)
        XCTAssertEqual(SessionListPresentation.sections(rows, projects: projects, hosts: hosts, grouping: .project, projectID: nil).map(\.id), ["project-z", "project-a"])
        XCTAssertEqual(SessionListPresentation.sections(rows, projects: projects, hosts: hosts, grouping: .host, projectID: nil).map(\.id), ["two", "one"])
    }

    func testReadRowCanStayInAttentionGroupWithGreyIndicatorUntilReleasedAndNewWorkWins() throws {
        var row = Session(id: "read", title: "Read", hostID: "host")
        let held: Set<String> = [row.id]
        func sections(_ held: Set<String>) -> [SessionSection] {
            SessionListPresentation.sections([row], projects: [], hosts: [], grouping: .status, projectID: nil, heldUnreadIDs: held)
        }
        XCTAssertEqual(SessionPresentationRules.indicator(for: row), .idle)
        XCTAssertEqual(sections(held).map(\.title), ["Needs attention"])
        XCTAssertTrue(try XCTUnwrap(sections(held).first).collapsible)
        XCTAssertEqual(sections([]).map(\.title), ["Finished"])
        row.working = true
        XCTAssertEqual(sections(held).map(\.title), ["Working"])
    }

    @MainActor func testAllCompletionKindsUseExclusiveHostTargetsAndFailuresRemainRetryable() async throws {
        let client = ConfigurationClient()
        let model = AppModel(client: client, makeLiveClient: { ConfigurationClient() })
        await model.start()
        model.selectProject(client.projects[0])
        for kind in [ComposerTokenKind.file, .skill, .command] {
            let items = await model.complete(kind: kind, query: "")
            XCTAssertEqual(items.map(\.kind), [kind])
            XCTAssertNil(client.completionRequests.last?.sessionID)
            XCTAssertEqual(client.completionRequests.last?.projectID, "first")
        }
        await model.open("session")
        for kind in [ComposerTokenKind.file, .skill, .command] {
            let items = await model.complete(kind: kind, query: "")
            XCTAssertEqual(items.map(\.kind), [kind])
            XCTAssertEqual(client.completionRequests.last?.sessionID, "session")
            XCTAssertNil(client.completionRequests.last?.projectID)
        }
        client.failCompletions = true
        let failed = await model.complete(kind: .file, query: "")
        XCTAssertTrue(failed.isEmpty)
        XCTAssertNotNil(model.completionError)
        client.failCompletions = false
        let recovered = await model.complete(kind: .file, query: "")
        XCTAssertFalse(recovered.isEmpty)
        XCTAssertNil(model.completionError)
        model.setForeground(false)
    }

    @MainActor func testPreferencesAndValidatedDestinationRestoreWithoutLeakingAcrossAccounts() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalStateStore(accountKey: "first", root: root)
        let checkout = ProjectCheckout(branch: "feature", path: "/projects/first-feature")
        var saved = LocalPreferences()
        saved.drafts["new"] = "Restored"
        saved.sessionList.grouping = .status
        saved.sessionList.status = .unread
        saved.sessionList.sort = .title
        saved.sessionList.compact = false
        saved.sessionList.collapsedSections = [SessionStatusFilter.idle.id]
        saved.soundsEnabled = false
        saved.composerDestination.hostID = "host"
        saved.composerDestination.projectID = "first"
        saved.composerDestination.checkout = .existing(checkout)
        try await store.save(saved)
        let client = ConfigurationClient()
        client.accountKey = "first"; client.automaticCheckouts = [checkout]
        let model = AppModel(client: client, makeLiveClient: { ConfigurationClient() }, makeStore: { LocalStateStore(accountKey: $0, root: root) })
        await model.start()
        await waitUntil { model.draft == "Restored" && model.checkouts == [checkout] }
        XCTAssertEqual(model.sessionList, saved.sessionList)
        XCTAssertFalse(model.preferences.soundsEnabled)
        XCTAssertEqual(model.selectedProjectID, "first")
        XCTAssertEqual(model.checkoutSelection, .existing(checkout))
        XCTAssertTrue(model.canSend)
        model.sessionList.grouping = .host
        model.setSoundsEnabled(true)
        model.setForeground(false)
        // A background flush persists the final edit without waiting for debounce.
        for _ in 0..<100 {
            if try await store.load().sessionList.grouping == .host { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let updated = try await store.load()
        XCTAssertEqual(updated.sessionList.grouping, .host)
        XCTAssertTrue(updated.soundsEnabled)
        let other = try await LocalStateStore(accountKey: "second", root: root).load()
        XCTAssertEqual(other.sessionList.grouping, .none)
        XCTAssertNil(other.composerDestination.projectID)
    }

    @MainActor func testPreferenceEditsDuringRestoreWinAndMissingCheckoutCannotSilentlySendElsewhere() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var saved = LocalPreferences()
        saved.drafts["new"] = "Restored"
        saved.sessionList.grouping = .project
        saved.composerDestination.hostID = "host"
        saved.composerDestination.projectID = "first"
        saved.composerDestination.checkout = .existing(ProjectCheckout(branch: "gone", path: "/gone"))
        try await LocalStateStore(accountKey: "first", root: root).save(saved)
        let client = ConfigurationClient(); client.accountKey = "first"; client.automaticCheckouts = []
        let model = AppModel(client: client, makeLiveClient: { ConfigurationClient() }, makeStore: { LocalStateStore(accountKey: $0, root: root) })
        model.sessionList.grouping = .none
        model.setSoundsEnabled(false)
        await model.start()
        await waitUntil { model.draft == "Restored" && model.checkoutError != nil }
        XCTAssertEqual(model.sessionList.grouping, .none)
        XCTAssertFalse(model.preferences.soundsEnabled)
        XCTAssertFalse(model.canSend)
        XCTAssertNotNil(model.checkoutError)
        await model.disconnect()
        XCTAssertEqual(model.sessionList, SessionListPreferences())
        XCTAssertTrue(model.preferences.soundsEnabled)
    }

    @MainActor func testFeedbackFollowsSuccessfulSendAndObservedCompletionOnlyWhileForeground() async {
        let client = ConfigurationClient()
        let model = AppModel(client: client, makeLiveClient: { ConfigurationClient() })
        await model.start(); await model.open("session")
        model.newSelection = ModelSelection(providerID: "codex", modelID: "model")
        model.draft = "Message"
        client.failSend = true
        await model.send()
        XCTAssertEqual(model.feedbackSerial, 0)
        client.failSend = false
        await model.send()
        XCTAssertEqual(model.feedback, .send)
        var workspace = model.workspace
        workspace.sessions[0].working = true
        client.onUpdate?(.workspace(workspace))
        workspace.sessions[0].working = false
        workspace.sessions[0].completedTurnID = "turn"
        client.onUpdate?(.workspace(workspace))
        XCTAssertEqual(model.feedback, .finished)
        let serial = model.feedbackSerial
        client.onUpdate?(.workspace(workspace))
        XCTAssertEqual(model.feedbackSerial, serial)
        model.setForeground(false)
        model.emitFeedback(.voiceStart)
        XCTAssertEqual(model.feedbackSerial, serial)
    }

    @MainActor private func waitUntil(_ predicate: () -> Bool) async {
        for _ in 0..<300 {
            if predicate() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Expected model state did not arrive")
    }
}
