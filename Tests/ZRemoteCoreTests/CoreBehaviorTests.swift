import Foundation
import Observation
import XCTest
import ZRemoteCore

final class CoreBehaviorTests: XCTestCase {
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
    let accountKey: String? = "test-user:test-organization"
    var submittedText: String?
    private enum Failure: Error { case unavailable }
    func restore() async throws { onUpdate?(.workspace(WorkspaceState(connection: .online, hosts: [Host(id: "host", name: "Mac", online: true)]))) }
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
}
