import Foundation
import XCTest
import ZRemoteCore

final class SessionConfigurationTests: XCTestCase {
    @MainActor
    func testCheckoutLoadsCannotReplaceAnotherProjectOrSilentlyChangeDestination() async {
        let client = ConfigurationClient()
        let model = AppModel(client: client, makeLiveClient: { ConfigurationClient() })
        await model.start()
        model.selectProject(client.projects[0])
        let originalContext = model.checkoutContext
        let firstStarted = expectation(description: "First project starts loading")
        client.onCheckoutStarted = { firstStarted.fulfill() }
        let first = Task { await model.loadCheckouts() }
        await fulfillment(of: [firstStarted], timeout: 3)
        await model.loadCheckouts()
        XCTAssertEqual(client.checkoutRequests, ["first"])
        model.selectProject(client.projects[1])
        XCTAssertFalse(model.loadingCheckouts)
        XCTAssertTrue(model.checkouts.isEmpty)
        let secondStarted = expectation(description: "Second project starts loading")
        client.onCheckoutStarted = { secondStarted.fulfill() }
        let second = Task { await model.loadCheckouts() }
        await fulfillment(of: [secondStarted], timeout: 3)
        client.finishCheckouts(0, .success([ProjectCheckout(branch: "stale", path: "/old")]))
        await first.value
        XCTAssertTrue(model.loadingCheckouts)
        XCTAssertTrue(model.checkouts.isEmpty)
        let destination = ProjectCheckout(branch: "feature", path: "/projects/second-feature")
        client.finishCheckouts(1, .success([destination]))
        await second.value
        XCTAssertEqual(model.checkouts, [destination])
        XCTAssertFalse(model.selectCheckout(.newWorktree, context: originalContext))
        XCTAssertFalse(model.selectCheckout(.existing(ProjectCheckout(branch: "forged", path: "/other")), context: model.checkoutContext))
        XCTAssertTrue(model.selectCheckout(.existing(destination), context: model.checkoutContext))
        model.newSelection = ModelSelection(providerID: "codex", modelID: "model")
        model.draft = "Use this checkout"
        XCTAssertTrue(model.canSend)
        let refreshed = expectation(description: "Refresh revalidates selected checkout")
        client.onCheckoutStarted = { refreshed.fulfill() }
        let refresh = Task { await model.loadCheckouts() }
        await fulfillment(of: [refreshed], timeout: 3)
        client.finishCheckouts(2, .success([]))
        await refresh.value
        XCTAssertEqual(model.checkoutSelection, .existing(destination))
        XCTAssertFalse(model.canSend)
        XCTAssertNotNil(model.checkoutError)
        XCTAssertTrue(model.selectCheckout(.current, context: model.checkoutContext))
        XCTAssertTrue(model.canSend)
        await model.disconnect()
    }

    @MainActor
    func testDemoCreatesSessionsInSelectedCheckoutOrNewWorktreeAndRenamesThem() async throws {
        let client = DemoClient(intervalNanoseconds: 0)
        let model = AppModel(client: client, makeLiveClient: { ConfigurationClient() })
        await model.start()
        let project = try XCTUnwrap(model.workspace.projects.first)
        model.selectProject(project)
        await model.loadCheckouts()
        let existing = try XCTUnwrap(model.checkouts.first { !$0.isCurrent })
        XCTAssertTrue(model.selectCheckout(.existing(existing), context: model.checkoutContext))
        model.newSelection = ModelSelection(providerID: "codex", modelID: "gpt-6-astra")
        model.draft = "Use the existing checkout"
        await model.send()
        let existingSession = try XCTUnwrap(model.session)
        XCTAssertEqual(existingSession.path, existing.path)
        XCTAssertEqual(existingSession.branch, existing.branch)
        await model.stop()
        try await model.renameSession(sessionID: existingSession.id, title: "  Updated title  ", context: model.sessionDetailsContext(existingSession.id))
        XCTAssertEqual(model.session?.title, "Updated title")
        model.newSession()
        XCTAssertEqual(model.checkoutSelection, .existing(existing))
        XCTAssertTrue(model.selectCheckout(.newWorktree, context: model.checkoutContext))
        model.newSelection = ModelSelection(providerID: "codex", modelID: "gpt-6-astra")
        model.draft = "Use an isolated worktree"
        await model.send()
        let isolated = try XCTUnwrap(model.session)
        XCTAssertNotEqual(isolated.id, existingSession.id)
        XCTAssertNotEqual(isolated.path, project.path)
        XCTAssertNotEqual(isolated.path, existing.path)
        XCTAssertTrue(isolated.branch?.hasPrefix("zeron/") == true)
        XCTAssertEqual(isolated.projectID, project.id)
        await model.stop()
        XCTAssertNil(model.error)
        await model.disconnect()
    }

    @MainActor
    func testRenameValidationRetryAndAccountChangesKeepOldEditsIsolated() async throws {
        let oldClient = ConfigurationClient(), newClient = ConfigurationClient()
        let model = AppModel(client: oldClient, makeLiveClient: { newClient })
        await model.start()
        let oldContext = model.sessionDetailsContext("session")
        do {
            try await model.renameSession(sessionID: "session", title: " \n", context: oldContext)
            XCTFail("Blank names must be rejected")
        } catch {}
        XCTAssertTrue(oldClient.renameTitles.isEmpty)
        let oldStarted = expectation(description: "Original account starts rename")
        oldClient.onRenameStarted = { oldStarted.fulfill() }
        let oldRename = Task {
            do { try await model.renameSession(sessionID: "session", title: " Old title ", context: oldContext); return false }
            catch is CancellationError { return true }
            catch { return false }
        }
        await fulfillment(of: [oldStarted], timeout: 3)
        XCTAssertEqual(oldClient.renameTitles, ["Old title"])
        await model.disconnect()
        await model.start()
        do {
            try await model.renameSession(sessionID: "session", title: "Stale task", context: oldContext)
            XCTFail("An old edit context cannot rename a new account's session")
        } catch is CancellationError {} catch { XCTFail("Expected cancellation for stale context") }
        XCTAssertTrue(newClient.renameTitles.isEmpty)
        let newContext = model.sessionDetailsContext("session")
        let newStarted = expectation(description: "New account starts rename")
        newClient.onRenameStarted = { newStarted.fulfill() }
        let newRename = Task { try await model.renameSession(sessionID: "session", title: "New title", context: newContext) }
        await fulfillment(of: [newStarted], timeout: 3)
        oldClient.finishRename(.failure(ClientFailure("Old account disconnected")))
        let wasCancelled = await oldRename.value
        XCTAssertTrue(wasCancelled)
        newClient.finishRename(.failure(ClientFailure("Temporarily unavailable")))
        do { try await newRename.value; XCTFail("The failure should remain retryable") } catch {}
        let retryStarted = expectation(description: "Rename can be retried")
        newClient.onRenameStarted = { retryStarted.fulfill() }
        let retry = Task { try await model.renameSession(sessionID: "session", title: "New title", context: newContext) }
        await fulfillment(of: [retryStarted], timeout: 3)
        newClient.finishRename(.success(()))
        try await retry.value
        XCTAssertEqual(newClient.renameTitles, ["New title", "New title"])
        XCTAssertEqual(model.workspace.sessions.first?.title, "New title")
        XCTAssertNil(model.error)
        await model.disconnect()
    }

    func testFailedFirstSendRetainsWorktreeIntentAcrossRestartAndAccounts() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let account = root.appendingPathComponent("first-account", isDirectory: true)
        let store = PendingWorktreeStore(directory: account)
        let intent = PendingWorktreeIntent(projectID: "project", repoPath: "/projects/repository")
        try store.save(["session": intent])
        // A failed initial send never removes the intent. A freshly constructed
        // client/store must still target an isolated worktree for this session.
        let recovered = try PendingWorktreeStore(directory: account).load()
        XCTAssertEqual(recovered["session"], intent)
        XCTAssertTrue(try PendingWorktreeStore(directory: root.appendingPathComponent("second-account")).load().isEmpty)
        try store.save([:])
        XCTAssertTrue(try PendingWorktreeStore(directory: account).load().isEmpty)
        try Data("broken metadata".utf8).write(to: account.appendingPathComponent("pending-worktrees.json"))
        XCTAssertThrowsError(try store.load(), "Corrupt destination data must not silently become a current-checkout send")
    }
}

@MainActor final class ConfigurationClient: ClientService {
    var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    let isDemo = false
    var accountKey: String? = nil
    var completionRequests: [(kind: ComposerTokenKind, sessionID: String?, projectID: String?)] = []
    var failCompletions = false
    var failSend = false
    var automaticCheckouts: [ProjectCheckout]?

    let projects = [
        Project(id: "first", name: "First", path: "/projects/first", hostID: "host", isRepository: true),
        Project(id: "second", name: "Second", path: "/projects/second", hostID: "host", isRepository: true)
    ]
    var onCheckoutStarted: (() -> Void)?
    var onRenameStarted: (() -> Void)?
    private(set) var checkoutRequests: [String] = []
    private(set) var renameTitles: [String] = []
    private var pendingCheckouts: [Int: CheckedContinuation<[ProjectCheckout], Error>] = [:]
    private var pendingRename: CheckedContinuation<Void, Error>?
    private var title = "Original title"
    func restore() async throws { publish() }
    private func publish() {
        onUpdate?(.workspace(WorkspaceState(connection: .online, hosts: [Host(id: "host", name: "Mac", online: true)], projects: projects,
            sessions: [Session(id: "session", title: title, projectID: "first", hostID: "host")])))
    }
    func checkouts(projectID: String, hostID: String) async throws -> [ProjectCheckout] {
        let index = checkoutRequests.count
        checkoutRequests.append(projectID)
        if let automaticCheckouts { return automaticCheckouts }
        return try await withCheckedThrowingContinuation { continuation in
            pendingCheckouts[index] = continuation
            onCheckoutStarted?()
        }
    }
    func finishCheckouts(_ index: Int, _ result: Result<[ProjectCheckout], Error>) { pendingCheckouts.removeValue(forKey: index)?.resume(with: result) }
    func renameSession(sessionID: String, title: String) async throws {
        renameTitles.append(title)
        try await withCheckedThrowingContinuation { continuation in pendingRename = continuation; onRenameStarted?() }
        self.title = title
        publish()
    }
    func finishRename(_ result: Result<Void, Error>) { let continuation = pendingRename; pendingRename = nil; continuation?.resume(with: result) }
    func signOut() async throws {}
    func refresh() async throws { publish() }
    func models(hostID: String) async throws -> [AgentModel] { [AgentModel(providerID: "codex", providerName: "Codex", modelID: "model", name: "Model")] }
    func authorizationURL(state: String) throws -> URL { throw ClientFailure("Unsupported") }
    func exchangeCode(_ code: String) async throws -> [Organization] { [] }
    func selectOrganization(_ id: String) async throws {}
    func openSession(_ id: String) async throws {}
    func closeSession(_ id: String) {}
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String { "new" }
    func send(sessionID: String, text: String) async throws { if failSend { throw ClientFailure("Offline") } }
    func complete(kind: ComposerTokenKind, query: String, hostID: String, sessionID: String?, projectID: String?, providerID: String) async throws -> [ComposerCompletion] {
        completionRequests.append((kind, sessionID, projectID))
        if failCompletions { throw ClientFailure("Unavailable") }
        return [ComposerCompletion(id: kind.rawValue, kind: kind, title: "Match", insertion: "Match")]
    }
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
