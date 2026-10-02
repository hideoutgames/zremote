import Foundation
import Observation
import XCTest
import ZRemoteCore

final class CoreBehaviorTests: XCTestCase {
    func testHapticsPreferenceDefaultsEnabledAndPreservesOptOut() throws {
        let legacy = Data("{\"theme\":\"dark\",\"drafts\":{\"new\":\"Saved draft\"}}".utf8)
        var preferences = try JSONDecoder().decode(LocalPreferences.self, from: legacy)
        XCTAssertTrue(preferences.hapticsEnabled)
        XCTAssertEqual(preferences.drafts["new"], "Saved draft")
        preferences.hapticsEnabled = false
        let restored = try JSONDecoder().decode(LocalPreferences.self, from: JSONEncoder().encode(preferences))
        XCTAssertFalse(restored.hapticsEnabled)
        XCTAssertEqual(restored.theme, .dark)
    }

    func testHapticsPreferenceStaysAccountLocal() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-haptics-accounts-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = LocalStateStore(accountKey: "first", root: root)
        let second = LocalStateStore(accountKey: "second", root: root)
        var preferences = LocalPreferences()
        preferences.hapticsEnabled = false
        try await first.save(preferences)
        let firstRestored = try await first.load()
        let secondRestored = try await second.load()
        XCTAssertFalse(firstRestored.hapticsEnabled)
        XCTAssertTrue(secondRestored.hapticsEnabled)
    }

    @MainActor
    func testHapticsEditBeforeRestorationSurvivesLoadAndResetsAtSignOut() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-haptics-restore-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = AppModelTestClient()
        let store = LocalStateStore(accountKey: client.accountKey!, root: root)
        var saved = LocalPreferences()
        saved.drafts["new"] = "Persisted draft"
        saved.hapticsEnabled = true
        try await store.save(saved)
        let model = AppModel(client: client, makeLiveClient: { AppModelTestClient() },
                             makeStore: { LocalStateStore(accountKey: $0, root: root) })
        model.setHapticsEnabled(false)
        await model.start()
        let restore = DraftRestorationExpectation(model: model, draft: "Persisted draft")
        let result = await restore.wait()
        XCTAssertEqual(result, .completed)
        XCTAssertFalse(model.preferences.hapticsEnabled)
        await model.disconnect()
        XCTAssertTrue(model.preferences.hapticsEnabled)
    }

    func testNewComposerDecorationNeverAppearsBehindNavigationAndSummaryStopsAtSix() {
        XCTAssertTrue(PresentationRules.showsBackground(enabled: true, hasSession: false, sessionsVisible: false, secondaryVisible: false))
        for state in [(false, false, false, false), (true, true, false, false),
                      (true, false, true, false), (true, false, false, true)] {
            XCTAssertFalse(PresentationRules.showsBackground(enabled: state.0, hasSession: state.1,
                                                             sessionsVisible: state.2, secondaryVisible: state.3))
        }
        XCTAssertEqual(PresentationRules.visibleFileCount(5), 5)
        XCTAssertEqual(PresentationRules.visibleFileCount(6), 6)
        XCTAssertEqual(PresentationRules.visibleFileCount(7), 6)
    }

    func testTabletPanelKeepsBlankComposerDecorationWithoutDecoratingChatsOrModals() {
        for sessionsVisible in [false, true] {
            XCTAssertTrue(PresentationRules.showsBackground(enabled: true, hasSession: false,
                                                            sessionsVisible: sessionsVisible, secondaryVisible: false,
                                                            usesSessionPanel: true))
            for state in [(false, false, false), (true, true, false), (true, false, true)] {
                XCTAssertFalse(PresentationRules.showsBackground(enabled: state.0, hasSession: state.1,
                                                                 sessionsVisible: sessionsVisible, secondaryVisible: state.2,
                                                                 usesSessionPanel: true))
            }
        }
    }

    func testSessionPanelRequiresTabletCapabilityAndEnoughWindowWidth() {
        XCTAssertFalse(PresentationRules.usesSessionPanel(deviceSupportsPanel: false, availableWidth: 1024))
        XCTAssertFalse(PresentationRules.usesSessionPanel(deviceSupportsPanel: true, availableWidth: 699))
        XCTAssertTrue(PresentationRules.usesSessionPanel(deviceSupportsPanel: true, availableWidth: 700))
        XCTAssertFalse(PresentationRules.usesSessionPanel(deviceSupportsPanel: true, availableWidth: .infinity))
    }

    func testModelFavoritesKeepProviderIdentityAndSelectionRejectsUnsupportedConfiguration() {
        let alpha = AgentModel(providerID: "alpha", providerName: "Alpha", modelID: "shared", name: "Balanced",
                               efforts: ["medium"], options: [
                                ModelOption(id: "tier", label: "Tier", choices: [ModelChoice(id: "standard", label: "Standard")], defaultChoice: "standard"),
                                ModelOption(id: "invalid", label: "Invalid", choices: [ModelChoice(id: "valid", label: "Valid")], defaultChoice: "missing")
                               ])
        let beta = AgentModel(providerID: "beta", providerName: "Beta", modelID: "shared", name: "Balanced")
        let favorites: Set<String> = [beta.id]
        XCTAssertEqual(ModelCatalogRules.filtered([alpha, beta], provider: nil, query: "bal", favorites: favorites,
                                                  favoritesOnly: true, lockedProvider: nil).map(\.id), [beta.id])
        XCTAssertTrue(ModelCatalogRules.filtered([alpha, beta], provider: nil, query: "", favorites: favorites,
                                                 favoritesOnly: true, lockedProvider: "alpha").isEmpty)
        let next = ModelCatalogRules.selecting(alpha, previous: ModelSelection(providerID: "alpha", modelID: "previous",
                                                                               effort: "high", options: ["tier": "fast", "removed": "yes"]))
        XCTAssertEqual(next.modelID, "shared")
        XCTAssertNil(next.effort)
        XCTAssertEqual(next.options, ["tier": "standard"])
    }

    func testAuthenticationCallbackRequiresExactEndpointAndUnambiguousMatchingState() throws {
        let valid = try XCTUnwrap(URL(string: "zeron://callback?state=expected&code=one%2Btwo"))
        XCTAssertEqual(try AuthenticationCallback.code(from: valid, expectedState: "expected"), "one+two")
        let invalid = [
            "zeron://callback?state=another&code=value",
            "zeron://callback?state=expected&state=expected&code=value",
            "zeron://callback?state=expected&code=value&code=second",
            "zeron://callback?state=expected&code=",
            "zeron://callback/elsewhere?state=expected&code=value",
            "zeron://user@callback?state=expected&code=value",
            "zeron://callback?state=expected&code=value#error",
            "zeron://callback?state=expected&code=value&error=denied",
            "https://callback?state=expected&code=value"
        ]
        for raw in invalid {
            XCTAssertThrowsError(try AuthenticationCallback.code(from: XCTUnwrap(URL(string: raw)), expectedState: "expected"))
        }
    }

    func testLocalDraftsAndCapturedChangesRemainIsolatedAcrossAccounts() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-notice-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = LocalStateStore(accountKey: "user-a:organization-a", root: root)
        let second = LocalStateStore(accountKey: "user-a:organization-b", root: root)
        var a = LocalPreferences()
        a.drafts["shared-session-id"] = "First organization draft"
        a.favorites = ["provider:model"]
        a.changes = [CapturedTurnChanges(sessionID: "shared-session-id", turnID: "turn",
                                        files: [CapturedFileChange(id: "revision", path: "a.swift", patch: nil)],
                                        capturedAt: Date(timeIntervalSince1970: 10))]
        var b = LocalPreferences()
        b.drafts["shared-session-id"] = "Second organization draft"
        try await first.save(a)
        try await second.save(b)
        let restoredA = try await first.load()
        let restoredB = try await second.load()
        XCTAssertEqual(restoredA.drafts, a.drafts)
        XCTAssertEqual(restoredA.changes, a.changes)
        XCTAssertEqual(restoredB.drafts, b.drafts)
        XCTAssertTrue(restoredB.changes.isEmpty)
        try await first.clear()
        let cleared = try await first.load()
        let remaining = try await second.load()
        XCTAssertTrue(cleared.drafts.isEmpty)
        XCTAssertEqual(remaining.drafts, b.drafts)
    }

    @MainActor
    func testSwitchingAccountsSelectsSavedAccountAndUpdatesProfile() async {
        let client = AppModelTestClient()
        let model = AppModel(client: client, makeLiveClient: { AppModelTestClient() })
        await model.start()
        await model.switchAccount("second-user/second-organization")
        XCTAssertEqual(client.accountKey, "second-user/second-organization")
        XCTAssertEqual(model.workspace.profile?.email, "second@example.com")
        XCTAssertEqual(model.zeronAccounts.first(where: \.active)?.id, "second-user/second-organization")
    }

    @MainActor
    func testDemoInterruptedNextTurnNeverReusesCompletedTurnsDiff() async throws {
        let client = DemoClient(intervalNanoseconds: 1_000_000)
        try await client.restore()
        let id = try await client.createSession(projectID: "demo-project", hostID: "demo-mac", selection: .init(providerID: "codex"))
        var latest: SessionState?
        let completed = XCTestExpectation(description: "First demo reply completes")
        client.onUpdate = { update in
            if case .session(let state) = update {
                latest = state
                if state.turnID != nil && !state.working { completed.fulfill() }
            }
        }
        try await client.send(sessionID: id, text: "First reply")
        let result = await XCTWaiter.fulfillment(of: [completed], timeout: 3)
        XCTAssertEqual(result, .completed)
        let firstTurn = try XCTUnwrap(latest?.turnID)
        let firstDiff = try await client.turnDiff(sessionID: id, turnID: firstTurn)
        XCTAssertEqual(firstDiff.paths.count, 7)
        client.onUpdate = { update in if case .session(let state) = update { latest = state } }
        try await client.send(sessionID: id, text: "Stop this reply")
        let nextTurn = try XCTUnwrap(latest?.turnID)
        XCTAssertNotEqual(firstTurn, nextTurn)
        try await client.interrupt(sessionID: id)
        XCTAssertFalse(latest?.working ?? true)
        do {
            _ = try await client.turnDiff(sessionID: id, turnID: nextTurn)
            XCTFail("A stopped turn must not reuse a previous turn's patch")
        } catch { /* No patch exists for the interrupted turn. */ }
        try await client.signOut()
    }

    @MainActor
    func testLeavingDemoCancelsItsRunAndDropsOldSessionData() async throws {
        let client = DemoClient(intervalNanoseconds: 1_000_000_000)
        try await client.restore()
        let id = try await client.createSession(projectID: "demo-project", hostID: "demo-mac", selection: .init())
        var connection: ClientConnection?
        client.onUpdate = { if case .workspace(let state) = $0 { connection = state.connection } }
        try await client.send(sessionID: id, text: "A run still in progress")
        try await client.signOut()
        XCTAssertEqual(connection, .signedOut)
        XCTAssertNil(client.accountKey)
        try await client.restore()
        do {
            try await client.openSession(id)
            XCTFail("A session from a previous demo must be discarded")
        } catch { /* Demo restore starts from isolated fixtures. */ }
        try await client.signOut()
    }

    @MainActor
    func testFailedFirstSendKeepsDraftInTheCreatedSession() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-draft-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = AppModelTestClient()
        let model = AppModel(client: client, makeLiveClient: { AppModelTestClient() },
                             makeStore: { LocalStateStore(accountKey: $0, root: root) })
        await model.start()
        model.newSelection = ModelSelection(providerID: "provider", modelID: "model")
        model.draft = "Keep my first message"
        await model.send()

        XCTAssertEqual(model.selectedSessionID, "created-session")
        XCTAssertEqual(model.draft, "Keep my first message")
        XCTAssertNil(model.preferences.drafts["new"])
        XCTAssertEqual(client.submittedText, "Keep my first message")
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.busy)
        await model.disconnect()
    }

    @MainActor
    func testExpiredAuthenticationClearsAccountStateAndRestoresSameAccountAgain() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-expiry-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = AppModelTestClient()
        let store = LocalStateStore(accountKey: client.accountKey!, root: root)
        var saved = LocalPreferences()
        saved.drafts["new"] = "Persisted draft"
        saved.favorites = ["provider:model"]
        try await store.save(saved)
        let model = AppModel(client: client, makeLiveClient: { AppModelTestClient() },
                             makeStore: { LocalStateStore(accountKey: $0, root: root) })
        await model.start()
        let firstRestore = DraftRestorationExpectation(model: model, draft: "Persisted draft")
        let firstResult = await firstRestore.wait()
        XCTAssertEqual(firstResult, .completed)
        model.selectedSessionID = "created-session"
        model.selectedProjectID = "project"
        model.catalog = [AgentModel(providerID: "provider", providerName: "Provider", modelID: "model", name: "Model")]
        model.changesAfterMessage["message"] = CapturedTurnChanges(sessionID: "created-session", turnID: "turn", files: [], capturedAt: Date())

        client.onUpdate?(.authenticationExpired)

        XCTAssertFalse(model.signedIn)
        XCTAssertNil(model.selectedSessionID)
        XCTAssertNil(model.selectedProjectID)
        XCTAssertEqual(model.selectedHostID, "")
        XCTAssertTrue(model.catalog.isEmpty)
        XCTAssertTrue(model.preferences.drafts.isEmpty)
        XCTAssertTrue(model.changesAfterMessage.isEmpty)

        await model.start()
        let secondRestore = DraftRestorationExpectation(model: model, draft: "Persisted draft")
        let secondResult = await secondRestore.wait()
        XCTAssertEqual(secondResult, .completed)
        XCTAssertTrue(model.signedIn)
        XCTAssertEqual(model.preferences.favorites, saved.favorites)
        await model.disconnect()
    }
    @MainActor
    func testAttachmentOnlySendPreservesBytesAndRejectsStalePickerContext() async throws {
        let client = DemoClient(intervalNanoseconds: 1_000_000_000)
        let model = AppModel(client: client, makeLiveClient: { DemoClient() })
        await model.start()
        await model.open("demo-welcome")
        let attachment = LocalAttachment(name: "notes.txt", mimeType: "text/plain", data: Data("Exact attachment bytes".utf8))
        let context = model.attachmentContext
        try model.addAttachment(attachment, context: context)
        model.newSession()
        XCTAssertThrowsError(try model.addAttachment(attachment, context: context))
        await model.open("demo-welcome")
        XCTAssertEqual(model.attachments.map(\.id), [attachment.id])
        XCTAssertTrue(model.canSend)
        await model.send()
        let sent = try XCTUnwrap(model.state?.messages.last(where: { $0.role == "user" })?.attachments.first)
        let bytes = try await model.attachmentData(sessionID: "demo-welcome", attachment: sent)
        XCTAssertEqual(bytes, attachment.data)
        XCTAssertTrue(model.attachments.isEmpty)
        XCTAssertThrowsError(try LocalAttachment(name: "too-big.bin", mimeType: "application/octet-stream", data: Data(count: LocalAttachment.maximumBytes + 1)).validate())
        await model.disconnect()
        XCTAssertTrue(model.attachments.isEmpty)
    }

    @MainActor
    func testPinAndArchiveActionsFollowPeerStateAndRestore() async throws {
        let client = DemoClient()
        let model = AppModel(client: client, makeLiveClient: { DemoClient() })
        await model.start()
        let session = try XCTUnwrap(model.workspace.sessions.first)
        await model.togglePin(session)
        XCTAssertEqual(model.workspace.sessions.first(where: { $0.id == session.id })?.pinned, true)
        await model.archive(session)
        XCTAssertEqual(model.workspace.sessions.first(where: { $0.id == session.id })?.archived, true)
        await model.unarchive(session)
        XCTAssertEqual(model.workspace.sessions.first(where: { $0.id == session.id })?.archived, false)
        await model.disconnect()
    }

    @MainActor
    func testObservedPullRequestsKeepFirstAnchorAndUpdateStateWithoutDuplicating() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-pr-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = AppModelTestClient()
        let model = AppModel(client: client, makeLiveClient: { AppModelTestClient() }, makeStore: { LocalStateStore(accountKey: $0, root: root) })
        await model.start()
        await model.open("session")
        let first = PullRequest(number: 1, title: "First", url: "https://example.test/pull/1", state: "open")
        let second = PullRequest(number: 2, title: "Second", url: "https://example.test/pull/2", state: "open")
        func publish(_ request: PullRequest) {
            client.onUpdate?(.workspace(WorkspaceState(connection: .online, sessions: [Session(id: "session", title: "Work", hostID: "host", pullRequest: request)])))
        }
        client.onUpdate?(.session(SessionState(id: "session", messages: [TranscriptMessage(id: "one", role: "assistant", text: "First result")])))
        publish(first)
        client.onUpdate?(.session(SessionState(id: "session", messages: [TranscriptMessage(id: "one", role: "assistant", text: "First result"), TranscriptMessage(id: "two", role: "assistant", text: "Follow-up")])))
        publish(second)
        var merged = first; merged.state = "merged"
        publish(merged)
        XCTAssertEqual(model.sessionPullRequests.count, 2)
        XCTAssertEqual(model.pullRequestsAfterMessage["one"]?.first?.state, "merged")
        XCTAssertEqual(model.pullRequestsAfterMessage["two"]?.first?.id, second.id)
        let oldPreferences = Data("{\"drafts\":{\"new\":\"saved\"},\"favorites\":[],\"backgroundEnabled\":false,\"changes\":[]}".utf8)
        XCTAssertEqual(try JSONDecoder().decode(LocalPreferences.self, from: oldPreferences).drafts["new"], "saved")
        let restored = try JSONDecoder().decode(LocalPreferences.self, from: JSONEncoder().encode(model.preferences))
        XCTAssertEqual(restored.pullRequests.count, 2)
        await model.disconnect()
    }
}

extension CoreBehaviorTests {
    @MainActor
    func testTryFixturesCoverProvidersProjectsStatesAndLocalAttachments() async throws {
        let client = DemoClient()
        var workspace = WorkspaceState()
        var state: SessionState?
        client.onUpdate = {
            switch $0 {
            case .workspace(let value): workspace = value
            case .session(let value): state = value
            case .authenticationExpired: XCTFail("Try mode must not access authentication")
            }
        }
        try await client.restore()
        XCTAssertEqual(workspace.sessions.count, 16)
        XCTAssertEqual(Set(workspace.sessions.map(\.id)).count, 16)
        XCTAssertEqual(workspace.projects.count, 5)
        XCTAssertEqual(workspace.hosts.filter { !$0.online }.count, 1)
        XCTAssertEqual(Set(workspace.sessions.compactMap(\.providerID)), ["codex", "claude-code", "devin"])
        XCTAssertEqual(workspace.sessions.filter(\.archived).count, 2)
        XCTAssertEqual(workspace.sessions.filter(\.awaitingInput).count, 2)
        XCTAssertEqual(workspace.sessions.filter(\.working).map(\.id), ["demo-running"])
        XCTAssertTrue(workspace.sessions.contains(where: \.unread))
        XCTAssertTrue(workspace.sessions.contains(where: \.failed))
        XCTAssertEqual(Set(workspace.sessions.compactMap { $0.pullRequest?.state }), ["open", "merged", "closed"])
        XCTAssertTrue(workspace.sessions.contains { $0.pullRequest?.isDraft == true })
        let catalog = try await client.models(hostID: "demo-mac")
        for row in workspace.sessions {
            try await client.openSession(row.id)
            let current = try XCTUnwrap(state)
            XCTAssertTrue(catalog.contains { $0.providerID == current.selection.providerID && $0.modelID == current.selection.modelID })
            XCTAssertTrue(current.queueCapabilities.canQueueAttachments)
        }
        try await client.openSession("demo-attachments")
        let attachment = try XCTUnwrap(state?.messages.first?.attachments.first)
        let bytes = try await client.readAttachment(sessionID: "demo-attachments", attachment: attachment)
        XCTAssertTrue(String(decoding: bytes, as: UTF8.self).contains("Offline review checklist"))
        do {
            _ = try await client.readAttachment(sessionID: "demo-welcome", attachment: attachment)
            XCTFail("Attachments must remain scoped to their session")
        } catch {}
        let diff = try await client.turnDiff(sessionID: "demo-welcome", turnID: "demo-history-turn")
        XCTAssertEqual(diff.paths.count, 7)
        try await client.signOut()
    }

    @MainActor
    func testShowcaseRemainsWorkingSuspendsAndStopsWithoutDrainingQueue() async throws {
        let client = DemoClient(showcaseIntervalNanoseconds: 1_000_000)
        var state: SessionState?
        var pulses = 0
        let progressed = XCTestExpectation(description: "Showcase cycles progress")
        client.onUpdate = {
            if case .session(let value) = $0, value.id == "demo-running" {
                state = value
                pulses += 1
                if pulses == 12 { progressed.fulfill() }
            }
        }
        try await client.restore()
        try await client.openSession("demo-running")
        await fulfillment(of: [progressed], timeout: 3)
        XCTAssertEqual(state?.working, true)
        XCTAssertEqual(state?.messages.last?.streaming, true)
        XCTAssertEqual(state?.messages.last?.subagents.first?.status, "running")
        XCTAssertEqual(state?.queue.count, 3)
        let waiting = XCTestExpectation(description: "No background progress")
        waiting.isInverted = true
        client.setForeground(false)
        client.onUpdate = { if case .session(let value) = $0, value.id == "demo-running" { waiting.fulfill() } }
        await fulfillment(of: [waiting], timeout: 0.03)
        let resumed = XCTestExpectation(description: "Progress resumes")
        client.onUpdate = { if case .session(let value) = $0, value.id == "demo-running" { state = value; resumed.fulfill() } }
        client.setForeground(true)
        await fulfillment(of: [resumed], timeout: 3)
        client.onUpdate = { if case .session(let value) = $0 { state = value } }
        try await client.interrupt(sessionID: "demo-running")
        XCTAssertEqual(state?.working, false)
        XCTAssertEqual(state?.messages.last?.streaming, false)
        XCTAssertEqual(state?.messages.last?.subagents.first?.status, "done")
        XCTAssertEqual(state?.queue.count, 3)
        let stopped = XCTestExpectation(description: "Stop survives foreground changes")
        stopped.isInverted = true
        client.onUpdate = { if case .session = $0 { stopped.fulfill() } }
        client.setForeground(false)
        client.setForeground(true)
        await fulfillment(of: [stopped], timeout: 0.03)
        try await client.signOut()
    }

    @MainActor
    func testTrySignOutDiscardsChangesAndRestoreReseedsTheWorkspace() async throws {
        let client = DemoClient(showcaseIntervalNanoseconds: 1_000_000)
        var workspace = WorkspaceState()
        var state: SessionState?
        client.onUpdate = {
            switch $0 {
            case .workspace(let value): workspace = value
            case .session(let value): state = value
            case .authenticationExpired: XCTFail("Try mode must not access authentication")
            }
        }
        try await client.restore()
        try await client.renameSession(sessionID: "demo-running", title: "Changed title")
        try await client.setArchived(sessionID: "demo-archive-ui", archived: false)
        try await client.deleteQueuedMessage(sessionID: "demo-running", id: "demo-queue-notes")
        try await client.signOut()
        XCTAssertTrue(workspace.sessions.isEmpty)
        XCTAssertNil(workspace.profile)
        let stale = XCTestExpectation(description: "Cancelled tasks never publish after sign-out")
        stale.isInverted = true
        client.onUpdate = { _ in stale.fulfill() }
        await fulfillment(of: [stale], timeout: 0.03)
        do {
            try await client.openSession("demo-running")
            XCTFail("Signed-out fixture must be inaccessible")
        } catch {}
        client.onUpdate = {
            switch $0 {
            case .workspace(let value): workspace = value
            case .session(let value): state = value
            case .authenticationExpired: XCTFail("Try mode must not access authentication")
            }
        }
        try await client.restore()
        XCTAssertEqual(workspace.sessions.count, 16)
        XCTAssertEqual(workspace.sessions.first?.title, "Live agent playground")
        XCTAssertEqual(workspace.sessions.filter(\.archived).count, 2)
        try await client.openSession("demo-running")
        XCTAssertEqual(state?.queue.count, 3)
        XCTAssertEqual(state?.working, true)
        let queued = try XCTUnwrap(state?.queue.first { !$0.attachments.isEmpty })
        let edit = try await client.beginQueuedMessageEdit(sessionID: "demo-running", id: queued.id)
        XCTAssertTrue(edit.hasAttachments)
        try await client.finishQueuedMessageEdit(edit, text: nil)
        try await client.signOut()
    }

    @MainActor
    func testRetrySampleFinishesWithoutDuplicatingTheUserMessage() async throws {
        let client = DemoClient(intervalNanoseconds: 1_000_000)
        var state: SessionState?
        var workspace = WorkspaceState()
        let finished = XCTestExpectation(description: "Retried turn completes")
        client.onUpdate = {
            switch $0 {
            case .workspace(let value): workspace = value
            case .authenticationExpired: XCTFail("Try mode must not access authentication")
            case .session(let value):
                guard value.id == "demo-failed" else { return }
                state = value
                if !value.working && value.turnID != nil { finished.fulfill() }
            }
        }
        try await client.restore()
        try await client.openSession("demo-failed")
        XCTAssertEqual(state?.deliveryFailed, true)
        try await client.retryDelivery(sessionID: "demo-failed")
        XCTAssertEqual(state?.deliveryFailed, false)
        XCTAssertEqual(state?.working, true)
        await fulfillment(of: [finished], timeout: 3)
        XCTAssertEqual(state?.messages.filter { $0.role == "user" }.count, 1)
        XCTAssertEqual(state?.messages.last?.streaming, false)
        XCTAssertEqual(workspace.sessions.first { $0.id == "demo-failed" }?.failed, false)
        let turn = try XCTUnwrap(state?.turnID)
        let diff = try await client.turnDiff(sessionID: "demo-failed", turnID: turn)
        XCTAssertEqual(diff.paths.count, 7)
        try await client.signOut()
    }
}

/// Waits for an observable outcome, without assuming when disk IO is scheduled.
@MainActor private final class DraftRestorationExpectation {
    let expectation = XCTestExpectation(description: "Account draft is restored")
    private let model: AppModel
    private let draft: String
    private var completed = false
    init(model: AppModel, draft: String) {
        self.model = model
        self.draft = draft
        observe()
    }
    private func observe() {
        guard !completed else { return }
        let current = withObservationTracking { model.draft } onChange: { [weak self] in
            Task { @MainActor in self?.observe() }
        }
        if current == draft { completed = true; expectation.fulfill() }
    }
    func wait() async -> XCTWaiter.Result {
        let result = await XCTWaiter.fulfillment(of: [expectation], timeout: 3)
        withExtendedLifetime(self) {}
        return result
    }
}

@MainActor private final class AppModelTestClient: ClientService {
    var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    let isDemo = false
    var accountKey: String? = "test-user:test-organization"
    var zeronAccounts: [ZeronAccount] {
        [
            ZeronAccount(id: "test-user:test-organization",
                         profile: UserProfile(id: "test-user", displayName: "Test User", email: "test@example.com"),
                         organizationID: "test-organization", active: accountKey == "test-user:test-organization"),
            ZeronAccount(id: "second-user/second-organization",
                         profile: UserProfile(id: "second-user", displayName: "Second User", email: "second@example.com"),
                         organizationID: "second-organization", active: accountKey == "second-user/second-organization"),
        ]
    }
    var submittedText: String?
    private enum Failure: Error { case unavailable }
    func restore() async throws { publishWorkspace() }
    func switchAccount(_ id: String) async throws { accountKey = id; publishWorkspace() }
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String { "created-session" }
    func openSession(_ id: String) async throws { onUpdate?(.session(SessionState(id: id))) }
    func send(sessionID: String, text: String) async throws { submittedText = text; throw Failure.unavailable }
    func retryDelivery(sessionID: String) async throws {}
    func models(hostID: String) async throws -> [AgentModel] { [] }
    func signOut() async throws { onUpdate?(.workspace(WorkspaceState())) }
    func closeSession(_ id: String) {}
    func setForeground(_ foreground: Bool) {}
    func authorizationURL(state: String) throws -> URL { throw Failure.unavailable }
    func exchangeCode(_ code: String) async throws -> [Organization] { throw Failure.unavailable }
    func selectOrganization(_ id: String) async throws { throw Failure.unavailable }
    func refresh() async throws { try await restore() }
    func interrupt(sessionID: String) async throws { throw Failure.unavailable }
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws { throw Failure.unavailable }
    func setModel(sessionID: String, selection: ModelSelection) async throws { throw Failure.unavailable }
    func listFolders(hostID: String, path: String?) async throws -> FolderPage { throw Failure.unavailable }
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String { throw Failure.unavailable }
    func createRepository(hostID: String, name: String) async throws -> String { throw Failure.unavailable }
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff { throw Failure.unavailable }
    private func publishWorkspace() {
        onUpdate?(.workspace(WorkspaceState(connection: .online, hosts: [Host(id: "host", name: "Mac", online: true)],
                                            profile: zeronAccounts.first(where: \.active)?.profile)))
    }
}
