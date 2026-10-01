import Foundation
import XCTest
import ZRemoteCore

final class UsageNotificationTests: XCTestCase {
    func testPlanQuotaUsesMostRestrictiveWindowAndNeverContextTokenUsage() throws {
        let now = Date(timeIntervalSince1970: 2_000)
        let account = AgentAccount(id: "a", harness: "codex", usageWindows: [
            AgentUsageWindow(label: "Hourly", usedFraction: 0.5),
            AgentUsageWindow(label: "Weekly", usedFraction: 0.93)
        ], usageFetchedAt: 2_000_000)
        let remaining = try XCTUnwrap(UsageLimitRules.remaining(accounts: [account], selection: ModelSelection(providerID: "codex"), now: now))
        XCTAssertEqual(remaining, 0.07, accuracy: 0.000_001)
        XCTAssertEqual(UsageLimitRules.warning(remaining: remaining)?.percentRemaining, 7)
        XCTAssertNil(UsageLimitRules.warning(remaining: 0.11))
        XCTAssertEqual(UsageLimitRules.warning(remaining: 0.1)?.percentRemaining, 10)
    }

    func testStaleFailedAmbiguousAndWrongProviderQuotaNeverShowsWarning() {
        let now = Date(timeIntervalSince1970: 2_000)
        var account = AgentAccount(id: "a", harness: "codex", usageWindows: [.init(label: "Plan", usedFraction: 0.95)], usageFetchedAt: 2_000_000)
        let selection = ModelSelection(providerID: "codex")
        XCTAssertNil(UsageLimitRules.remaining(accounts: [account, account], selection: selection, now: now))
        XCTAssertNil(UsageLimitRules.remaining(accounts: [account], selection: ModelSelection(providerID: "claude-code"), now: now))
        account.usageFetchedAt = 1_000_000
        XCTAssertNil(UsageLimitRules.remaining(accounts: [account], selection: selection, now: now))
        account.usageFetchedAt = 2_000_000; account.usageError = "Rate limited"
        XCTAssertNil(UsageLimitRules.remaining(accounts: [account], selection: selection, now: now))
        account.usageError = nil; account.active = false
        XCTAssertNil(UsageLimitRules.remaining(accounts: [account], selection: selection, now: now))
    }

    func testMultiproviderQuotaBelongsToSelectedModelProvider() throws {
        let accounts = [
            AgentAccount(id: "openai", harness: "opencode", usageWindows: [.init(label: "Plan", usedFraction: 0.95)], usageFetchedAt: 2_000_000, provider: "openai"),
            AgentAccount(id: "anthropic", harness: "opencode", usageWindows: [.init(label: "Plan", usedFraction: 0.2)], usageFetchedAt: 2_000_000, provider: "anthropic")
        ]
        XCTAssertEqual(try XCTUnwrap(UsageLimitRules.remaining(accounts: accounts, selection: ModelSelection(providerID: "opencode", modelID: "openai/gpt-6"), now: Date(timeIntervalSince1970: 2_000))), 0.05, accuracy: 0.000_001)
        XCTAssertNil(UsageLimitRules.remaining(accounts: accounts, selection: ModelSelection(providerID: "opencode", modelID: "unqualified"), now: Date(timeIntervalSince1970: 2_000)))
    }

    func testThresholdAlertRequiresObservedCrossingDuringWorkAndDeduplicatesSession() {
        XCTAssertTrue(UsageLimitRules.crossedThreshold(previous: 1 - 0.9, remaining: 1 - 0.91, working: true, alreadyNotified: false))
        XCTAssertFalse(UsageLimitRules.crossedThreshold(previous: 0.2, remaining: 1 - 0.9, working: true, alreadyNotified: false))
        XCTAssertTrue(UsageLimitRules.crossedThreshold(previous: 0.1, remaining: 0.09, working: true, alreadyNotified: false))
        XCTAssertFalse(UsageLimitRules.crossedThreshold(previous: nil, remaining: 0.09, working: true, alreadyNotified: false))
        XCTAssertFalse(UsageLimitRules.crossedThreshold(previous: 0.2, remaining: 0.1, working: true, alreadyNotified: false))
        XCTAssertFalse(UsageLimitRules.crossedThreshold(previous: 0.2, remaining: 0.09, working: false, alreadyNotified: false))
        XCTAssertFalse(UsageLimitRules.crossedThreshold(previous: 0.2, remaining: 0.09, working: true, alreadyNotified: true))
        XCTAssertFalse(UsageLimitRules.crossedThreshold(previous: 0.08, remaining: 0.07, working: true, alreadyNotified: false))
        XCTAssertNil(AgentUsageWindow(label: "Invalid", usedFraction: .nan).remainingFraction)
        XCTAssertNil(AgentUsageWindow(label: "Invalid", usedFraction: -0.1).remainingFraction)
    }

    func testExistingPreferencesAndPullRequestsDecodeWithSafeDefaults() throws {
        let preferences = try JSONDecoder().decode(LocalPreferences.self, from: Data("{\"drafts\":{\"new\":\"Draft\"},\"backgroundEnabled\":true}".utf8))
        XCTAssertEqual(preferences.drafts["new"], "Draft")
        XCTAssertTrue(preferences.backgroundEnabled)
        XCTAssertNil(preferences.backgroundImageData)
        XCTAssertEqual(preferences.backgroundEffect, "none")
        XCTAssertFalse(preferences.notifications.enabled)
        let pr = try JSONDecoder().decode(PullRequest.self, from: Data("{\"number\":42,\"title\":\"PR\",\"url\":\"\",\"state\":\"open\"}".utf8))
        XCTAssertFalse(pr.isDraft)
    }

    func testBackgroundAndNotificationPreferencesStayAccountScoped() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let a = LocalStateStore(accountKey: "a", root: root), b = LocalStateStore(accountKey: "b", root: root)
        var preferences = LocalPreferences()
        preferences.backgroundImageData = Data([1, 2, 3]); preferences.backgroundImageName = "Personal image"
        preferences.backgroundEffect = "dither"; preferences.notifications.enabled = true
        preferences.dismissedUsageSessions = ["session"]
        preferences.sessionFinishedAt = ["session": Date(timeIntervalSince1970: 42)]
        try await a.save(preferences)
        let restored = try await a.load(), other = try await b.load()
        XCTAssertEqual(restored.backgroundImageData, preferences.backgroundImageData)
        XCTAssertEqual(restored.sessionFinishedAt["session"], Date(timeIntervalSince1970: 42))
        XCTAssertTrue(restored.notifications.enabled)
        XCTAssertTrue(restored.dismissedUsageSessions.contains("session"))
        XCTAssertNil(other.backgroundImageData)
        XCTAssertFalse(other.notifications.enabled)
        XCTAssertTrue(other.dismissedUsageSessions.isEmpty)
    }
    @MainActor func testConnectedNotificationsIgnoreHistoryAndDeliverEachQuestionAndSuccessfulTurnOnce() async throws {
        let client = NotificationTestClient(), notifications = RecordingNotifications()
        client.rows = [Session(id: "s", title: "Session", hostID: "host", completedTurnID: "historical", providerID: "codex")]
        let model = AppModel(client: client, makeLiveClient: { NotificationTestClient() }, notifications: notifications)
        var preferences = NotificationPreferences(); preferences.enabled = true
        model.setNotifications(preferences)
        try await client.restore()
        await settle()
        XCTAssertTrue(notifications.events.isEmpty, "Restored completed history must not alert")
        client.rows[0].working = true; client.emit()
        client.rows[0].working = false; client.rows[0].awaitingInput = true; client.rows[0].inputRequestID = "question-1"; client.emit()
        client.emit()
        await settle()
        XCTAssertEqual(notifications.events.map(\.kind), [.question])
        client.rows[0].awaitingInput = false; client.rows[0].inputRequestID = nil; client.rows[0].working = true; client.emit()
        client.rows[0].working = false; client.emit()
        await settle()
        XCTAssertEqual(notifications.events.count, 1, "Stopping alone is not a successful completion")
        client.rows[0].completedTurnID = "turn-1"; client.emit()
        client.emit()
        await settle()
        XCTAssertEqual(notifications.events.map(\.kind), [.question, .finished])
        // An interrupted or stale run has no new completion marker.
        client.rows[0].working = true; client.emit()
        client.rows[0].working = false; client.emit()
        await settle()
        XCTAssertEqual(notifications.events.count, 2)
        model.route = .settings
        notifications.onSession?("s")
        await settle()
        XCTAssertNil(model.route)
        XCTAssertEqual(model.selectedSessionID, "s")
        await model.enterDemo()
        XCTAssertTrue(model.isDemo)
        XCTAssertGreaterThan(notifications.stopCount, 0)
        XCTAssertEqual(notifications.events.count, 2)
    }

    @MainActor func testUsageCrossingNotifiesOncePerSessionAndDismissalIsIndependent() async throws {
        let client = NotificationTestClient(), notifications = RecordingNotifications()
        client.rows = [Session(id: "s", title: "Session", hostID: "host", working: true, providerID: "codex")]
        let model = AppModel(client: client, makeLiveClient: { NotificationTestClient() }, notifications: notifications)
        var preferences = NotificationPreferences(); preferences.enabled = true
        model.setNotifications(preferences)
        await model.start()
        await model.open("s")
        await settle()
        await model.refreshAgentAccounts()
        client.usedFraction = 0.94
        await model.refreshAgentAccounts()
        await settle()
        XCTAssertEqual(notifications.events.filter { $0.kind == .usageLimit }.map(\.sessionID), ["s"])
        XCTAssertEqual(model.usageWarning?.percentRemaining, 6)
        model.dismissUsageWarning()
        XCTAssertNil(model.usageWarning)
        client.usedFraction = 0.8; await model.refreshAgentAccounts()
        client.usedFraction = 0.95; await model.refreshAgentAccounts()
        await settle()
        XCTAssertEqual(notifications.events.filter { $0.kind == .usageLimit }.count, 1)
        client.rows.append(Session(id: "second", title: "Second", hostID: "host", working: true, providerID: "codex")); client.emit()
        client.usedFraction = 0.8; await model.refreshAgentAccounts()
        client.usedFraction = 0.96; await model.refreshAgentAccounts()
        await settle()
        XCTAssertEqual(notifications.events.filter { $0.kind == .usageLimit }.map(\.sessionID), ["s", "second"])
        model.setForeground(false)
    }

    @MainActor func testRepeatedQuestionsWithinOneRunHaveDistinctStableFallbackIdentities() async throws {
        var identity = InputNotificationIdentity()
        let first = identity.resolve(awaitingInput: true, requestID: nil, updatedAtMs: 1_000)
        XCTAssertEqual(identity.resolve(awaitingInput: true, requestID: nil, updatedAtMs: 2_000), first)
        XCTAssertEqual(identity.resolve(awaitingInput: true, requestID: "request-1", updatedAtMs: 2_000), "request-1")
        XCTAssertEqual(identity.resolve(awaitingInput: true, requestID: nil, updatedAtMs: 2_050), "request-1", "Closing or evicting a warm session must retain the question identity")
        _ = identity.resolve(awaitingInput: false, requestID: nil, updatedAtMs: 2_100)
        let second = identity.resolve(awaitingInput: true, requestID: nil, updatedAtMs: 3_000)
        XCTAssertNotEqual(first, second)
        let client = NotificationTestClient(), notifications = RecordingNotifications()
        client.rows = [Session(id: "s", title: "Session", hostID: "host", working: true)]
        let model = AppModel(client: client, makeLiveClient: { NotificationTestClient() }, notifications: notifications)
        var preferences = NotificationPreferences(); preferences.enabled = true; model.setNotifications(preferences)
        await model.start(); await settle()
        client.rows[0].working = false; client.rows[0].awaitingInput = true; client.rows[0].inputRequestID = first; client.emit()
        await settle()
        client.rows[0].inputRequestID = "actual-request-1"; client.emit(); await settle()
        XCTAssertEqual(notifications.events.count, 1, "Warm-doc hydration must not duplicate the fallback alert")
        client.rows[0].working = true; client.rows[0].awaitingInput = false; client.rows[0].inputRequestID = nil; client.emit()
        client.rows[0].working = false; client.rows[0].awaitingInput = true; client.rows[0].inputRequestID = second; client.emit()
        await settle()
        XCTAssertEqual(notifications.events.map(\.kind), [.question, .question])
        model.setForeground(false)
    }

    @MainActor func testWorkspaceOnlyRunStartsQuotaMonitoring() async {
        let client = NotificationTestClient()
        client.rows = [Session(id: "closed", title: "Closed session", hostID: "host", providerID: "codex")]
        let model = AppModel(client: client, makeLiveClient: { NotificationTestClient() })
        await model.start(); await settle()
        let before = client.accountRequestCount
        XCTAssertNil(model.selectedSessionID)
        client.rows[0].working = true; client.emit()
        await settle()
        XCTAssertGreaterThan(client.accountRequestCount, before)
        model.setForeground(false)
    }

    @MainActor func testOtherWorkingHostReceivesUsageAlertWithoutChangingCurrentComposerQuota() async {
        let client = NotificationTestClient(), notifications = RecordingNotifications()
        client.rows = [
            Session(id: "visible", title: "Visible", hostID: "host", providerID: "codex"),
            Session(id: "elsewhere", title: "Elsewhere", hostID: "other", working: true, providerID: "codex")
        ]
        client.usedFraction = 0.4; client.usedFractionsByHost["other"] = 0.8
        let model = AppModel(client: client, makeLiveClient: { NotificationTestClient() }, notifications: notifications)
        var preferences = NotificationPreferences(); preferences.enabled = true; model.setNotifications(preferences)
        await model.start(); await model.open("visible"); await settle()
        client.usedFractionsByHost["other"] = 0.95
        model.setForeground(true); await settle()
        XCTAssertEqual(notifications.events.filter { $0.kind == .usageLimit }.map(\.sessionID), ["elsewhere"])
        XCTAssertNil(model.usageWarning)
        XCTAssertEqual(model.selectedSessionID, "visible")
        model.setForeground(false)
    }

    @MainActor private func settle() async { for _ in 0..<40 { await Task.yield() } }

}


@MainActor private final class RecordingNotifications: NotificationService {
    var onSession: (@MainActor (String) -> Void)?
    let supported = true
    var events: [SessionNotification] = []
    var stopCount = 0
    func authorization(request: Bool) async -> NotificationAuthorization { .authorized }
    func deliver(_ event: SessionNotification) async throws { events.append(event) }
    func stop() { stopCount += 1 }
}

@MainActor private final class NotificationTestClient: ClientService {
    var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    let isDemo = false
    let accountKey: String? = nil
    var rows: [Session] = []
    var usedFraction = 0.8
    var accountRequestCount = 0
    var usedFractionsByHost: [String: Double] = [:]
    private enum Failure: Error { case unavailable }
    func emit() { onUpdate?(.workspace(WorkspaceState(connection: .online, hosts: [Host(id: "host", name: "Mac", online: true)], sessions: rows))) }
    func restore() async throws { emit() }
    func agentAccounts(hostID: String) async throws -> AgentAccountsSnapshot {
        accountRequestCount += 1
        return AgentAccountsSnapshot(accounts: [AgentAccount(id: "account", harness: "codex", usageWindows: [.init(label: "Plan", usedFraction: usedFractionsByHost[hostID] ?? usedFraction)], usageFetchedAt: Int64(Date().timeIntervalSince1970 * 1000))])
    }
    func openSession(_ id: String) async throws { onUpdate?(.session(SessionState(id: id, selection: ModelSelection(providerID: "codex"), working: rows.first { $0.id == id }?.working ?? false))) }
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String { throw Failure.unavailable }
    func send(sessionID: String, text: String) async throws { throw Failure.unavailable }
    func retryDelivery(sessionID: String) async throws {}
    func models(hostID: String) async throws -> [AgentModel] { [] }
    func signOut() async throws {}
    func closeSession(_ id: String) {}
    func setForeground(_ foreground: Bool) {}
    func authorizationURL(state: String) throws -> URL { throw Failure.unavailable }
    func exchangeCode(_ code: String) async throws -> [Organization] { throw Failure.unavailable }
    func selectOrganization(_ id: String) async throws { throw Failure.unavailable }
    func refresh() async throws { emit() }
    func interrupt(sessionID: String) async throws { throw Failure.unavailable }
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws { throw Failure.unavailable }
    func setModel(sessionID: String, selection: ModelSelection) async throws { throw Failure.unavailable }
    func listFolders(hostID: String, path: String?) async throws -> FolderPage { throw Failure.unavailable }
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String { throw Failure.unavailable }
    func createRepository(hostID: String, name: String) async throws -> String { throw Failure.unavailable }
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff { throw Failure.unavailable }
}
