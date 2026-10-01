import Foundation
import XCTest
import ZRemoteCore

final class SessionsRefreshTests: XCTestCase {
    @MainActor
    func testRefreshPublishesSessionChangesWithoutReplacingComposer() async {
        let client = SessionsRefreshClient()
        let model = AppModel(client: client, makeLiveClient: { SessionsRefreshClient() })
        await model.start()
        model.selectedSessionID = "existing"
        model.draft = "Keep this draft"
        model.busy = true
        let started = expectation(description: "Refresh reaches the peer")
        client.onRefreshStarted = { started.fulfill() }
        let refresh = Task { await model.refreshSessions() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(model.refreshingSessions)
        XCTAssertEqual(model.workspace.sessions.map(\.id), ["existing"])

        client.snapshot.sessions = [
            Session(id: "existing", title: "Updated title", hostID: "host"),
            Session(id: "new", title: "New remote session", hostID: "host"),
        ]
        client.finishRefresh(.success(()))
        await refresh.value

        XCTAssertEqual(model.workspace.sessions.map(\.id), ["existing", "new"])
        XCTAssertEqual(model.session?.title, "Updated title")
        XCTAssertEqual(model.selectedSessionID, "existing")
        XCTAssertEqual(model.draft, "Keep this draft")
        XCTAssertTrue(model.busy)
        XCTAssertFalse(model.refreshingSessions)
        XCTAssertNil(model.error)
        await model.disconnect()
    }

    @MainActor
    func testConcurrentRefreshesShareFailureAndAllowRetry() async {
        let client = SessionsRefreshClient()
        let model = AppModel(client: client, makeLiveClient: { SessionsRefreshClient() })
        await model.start()
        let started = expectation(description: "First refresh reaches the peer")
        client.onRefreshStarted = { started.fulfill() }
        let first = Task { await model.refreshSessions() }
        await fulfillment(of: [started], timeout: 3)
        let joined = expectation(description: "Second gesture joins the pending refresh")
        let second = Task {
            joined.fulfill()
            await model.refreshSessions()
        }
        await fulfillment(of: [joined], timeout: 3)
        XCTAssertEqual(client.refreshCount, 1)
        XCTAssertTrue(model.refreshingSessions)
        client.finishRefresh(.failure(ClientFailure("Peer is unavailable")))
        await first.value
        await second.value
        XCTAssertFalse(model.refreshingSessions)
        XCTAssertEqual(model.error, "Couldn't refresh sessions. Try again when your connection is restored.")
        XCTAssertEqual(model.workspace.sessions.map(\.id), ["existing"])

        model.error = nil
        let retried = expectation(description: "Retry reaches the peer")
        client.onRefreshStarted = { retried.fulfill() }
        let retry = Task { await model.refreshSessions() }
        await fulfillment(of: [retried], timeout: 3)
        XCTAssertEqual(client.refreshCount, 2)
        client.finishRefresh(.success(()))
        await retry.value
        XCTAssertFalse(model.refreshingSessions)
        XCTAssertNil(model.error)
        await model.disconnect()
    }

    @MainActor
    func testLateRefreshFailureCannotChangeNewAccountsRefreshState() async {
        let oldClient = SessionsRefreshClient()
        let newClient = SessionsRefreshClient()
        let model = AppModel(client: oldClient, makeLiveClient: { newClient })
        await model.start()
        let oldStarted = expectation(description: "Old account begins refresh")
        oldClient.onRefreshStarted = { oldStarted.fulfill() }
        let oldRefresh = Task { await model.refreshSessions() }
        await fulfillment(of: [oldStarted], timeout: 3)
        await model.disconnect()
        XCTAssertFalse(model.refreshingSessions)
        await model.start()
        let newStarted = expectation(description: "New account begins its own refresh")
        newClient.onRefreshStarted = { newStarted.fulfill() }
        let newRefresh = Task { await model.refreshSessions() }
        await fulfillment(of: [newStarted], timeout: 3)

        // This peer deliberately ignores task cancellation to simulate a late reply.
        oldClient.finishRefresh(.failure(ClientFailure("Old account disconnected")))
        await oldRefresh.value
        XCTAssertTrue(model.refreshingSessions)
        XCTAssertNil(model.error)
        XCTAssertEqual(newClient.refreshCount, 1)
        newClient.finishRefresh(.success(()))
        await newRefresh.value
        XCTAssertFalse(model.refreshingSessions)
        await model.disconnect()
    }

    @MainActor
    func testSignedOutRefreshAndCancelledRequestsDoNotShowConnectionErrors() async {
        let client = SessionsRefreshClient()
        let model = AppModel(client: client, makeLiveClient: { SessionsRefreshClient() })
        await model.refreshSessions()
        XCTAssertEqual(client.refreshCount, 0)
        XCTAssertFalse(model.refreshingSessions)
        await model.start()
        let started = expectation(description: "Refresh reaches the peer")
        client.onRefreshStarted = { started.fulfill() }
        let refresh = Task { await model.refreshSessions() }
        await fulfillment(of: [started], timeout: 3)
        client.finishRefresh(.failure(CancellationError()))
        await refresh.value
        XCTAssertFalse(model.refreshingSessions)
        XCTAssertNil(model.error)
        await model.disconnect()
    }
}

@MainActor private final class SessionsRefreshClient: ClientService {
    var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    let isDemo = false
    let accountKey: String? = nil
    var snapshot = WorkspaceState(connection: .online, sessions: [
        Session(id: "existing", title: "Existing session", hostID: "host"),
    ])
    var onRefreshStarted: (() -> Void)?
    private(set) var refreshCount = 0
    private var pendingRefresh: CheckedContinuation<Void, Error>?

    func restore() async throws { onUpdate?(.workspace(snapshot)) }
    func refresh() async throws {
        refreshCount += 1
        try await withCheckedThrowingContinuation { continuation in
            pendingRefresh = continuation
            onRefreshStarted?()
        }
        onUpdate?(.workspace(snapshot))
    }
    func finishRefresh(_ result: Result<Void, Error>) {
        let pending = pendingRefresh
        pendingRefresh = nil
        pending?.resume(with: result)
    }
    func signOut() async throws { onUpdate?(.workspace(WorkspaceState())) }
    func models(hostID: String) async throws -> [AgentModel] { [] }
    func authorizationURL(state: String) throws -> URL { throw ClientFailure("Unsupported") }
    func exchangeCode(_ code: String) async throws -> [Organization] { [] }
    func selectOrganization(_ id: String) async throws {}
    func openSession(_ id: String) async throws {}
    func closeSession(_ id: String) {}
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String { "new" }
    func send(sessionID: String, text: String) async throws {}
    func interrupt(sessionID: String) async throws {}
    func retryDelivery(sessionID: String) async throws {}
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws {}
    func setModel(sessionID: String, selection: ModelSelection) async throws {}
    func listFolders(hostID: String, path: String?) async throws -> FolderPage { throw ClientFailure("Unsupported") }
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String { "project" }
    func createRepository(hostID: String, name: String) async throws -> String { "project" }
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff { throw ClientFailure("Unsupported") }
    func setForeground(_ foreground: Bool) {}
}
