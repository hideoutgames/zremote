import Foundation
import XCTest
import ZRemoteCore

final class AppModelMessageQueueTests: XCTestCase {
    @MainActor private func configure(_ model: AppModel) {
        model.workspace = WorkspaceState(connection: .online, hosts: [Host(id: "host", name: "Host", online: true)],
                                         sessions: [Session(id: "s", title: "Session", hostID: "host", providerID: "codex", modelID: "gpt-6")])
        model.selectedSessionID = "s"
        model.state = SessionState(id: "s", selection: .init(providerID: "codex", modelID: "gpt-6"), working: true,
                                   queue: [QueuedMessage(id: "a", text: "First"), QueuedMessage(id: "b", text: "Second")],
                                   queueCapabilities: .init(canQueue: true, canQueueAttachments: true, canSteer: true, canEdit: true, canAct: true))
    }

    @MainActor func testWorkingDraftQueuesByDefaultAndSteerNeverStops() async {
        let client = QueueModelClient()
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        XCTAssertTrue(model.composerStops)
        XCTAssertFalse(model.canSend)
        model.draft = "Next turn"
        XCTAssertTrue(model.canSend)
        XCTAssertFalse(model.composerStops)
        await model.send()
        XCTAssertEqual(client.sentModes, [.queue])
        XCTAssertEqual(model.draft, "")
        model.busyMessageMode = .steer
        model.draft = "Change direction"
        await model.send()
        XCTAssertEqual(client.sentModes, [.queue, .steer])
        XCTAssertEqual(client.interrupts, 0)
    }

    @MainActor func testExplicitQueueNeverFallsBackToSteering() async {
        let client = QueueModelClient()
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        model.busyMessageMode = .steer
        model.draft = "Next turn"
        await model.send(busyMode: .queue)
        XCTAssertEqual(client.sentModes, [.queue])
        model.state?.queueCapabilities.canQueue = false
        model.draft = "Keep for later"
        await model.send(busyMode: .queue)
        XCTAssertEqual(client.sentModes, [.queue])
        XCTAssertEqual(model.draft, "Keep for later")
        XCTAssertEqual(client.interrupts, 0)
    }

    @MainActor func testAttachmentsForceQueueAndRemainWhenHostCannotQueueFiles() async throws {
        let client = QueueModelClient()
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        model.busyMessageMode = .steer
        let attachment = LocalAttachment(name: "notes.txt", mimeType: "text/plain", data: Data("notes".utf8))
        try model.addAttachment(attachment)
        XCTAssertFalse(model.canSteerDraft)
        XCTAssertTrue(model.canSend, "A file-only draft must be queueable")
        XCTAssertEqual(model.messageSendMode, .queue)
        model.state?.queueCapabilities.canQueueAttachments = false
        XCTAssertFalse(model.canSend)
        await model.send()
        XCTAssertTrue(client.sentModes.isEmpty)
        XCTAssertEqual(model.attachments, [attachment])
        model.state?.queueCapabilities.canQueueAttachments = true
        await model.send()
        XCTAssertEqual(client.sentModes, [.queue])
        XCTAssertEqual(client.sentFiles, [[attachment]])
        XCTAssertTrue(model.attachments.isEmpty)
    }

    @MainActor func testPendingSendPreventsDuplicatesAndPreservesLaterDraftOnFailure() async {
        let client = QueueModelClient()
        client.suspendSend = true
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        model.busyMessageMode = .steer; model.draft = "First draft"
        let started = expectation(description: "Send started")
        client.onStarted = { started.fulfill() }
        let first = Task { await model.send() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(model.busy)
        model.draft = "Later draft"
        await model.send()
        XCTAssertEqual(client.sentModes, [.steer])
        client.pendingSend?.resume(throwing: ClientFailure("Unavailable")); client.pendingSend = nil
        await first.value
        XCTAssertFalse(model.busy)
        XCTAssertEqual(model.draft, "Later draft")
        XCTAssertNotNil(model.error)
        XCTAssertEqual(client.interrupts, 0)
    }

    @MainActor func testSendNowUsesQueueDeliveryWithoutInterruptAndGuardsDuplicateActions() async {
        let client = QueueModelClient()
        client.suspendAction = true
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        let started = expectation(description: "Queue delivery started")
        client.onStarted = { started.fulfill() }
        let first = Task { await model.sendQueuedNow(sessionID: "s", id: "a") }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(model.queueActionPending(sessionID: "s", id: "a"))
        await model.sendQueuedNow(sessionID: "s", id: "a")
        await model.deleteQueuedMessage(sessionID: "s", id: "a")
        XCTAssertEqual(client.queueActions, ["send:s:a"])
        client.pendingAction?.resume(); client.pendingAction = nil
        await first.value
        XCTAssertFalse(model.queueActionPending(sessionID: "s", id: "a"))
        XCTAssertEqual(client.interrupts, 0)
        client.suspendAction = false
        await model.moveQueuedMessage(sessionID: "s", id: "b", delta: -1)
        await model.deleteQueuedMessage(sessionID: "s", id: "a")
        XCTAssertEqual(client.queueActions, ["send:s:a", "move:s:b:-1", "delete:s:a"])
    }

    @MainActor func testDelayedQueueFailureDoesNotAffectAnotherAccount() async {
        let old = QueueModelClient(), next = QueueModelClient()
        old.suspendAction = true
        let model = AppModel(client: old, makeLiveClient: { next })
        configure(model)
        let started = expectation(description: "Old action started")
        old.onStarted = { started.fulfill() }
        let action = Task { await model.sendQueuedNow(sessionID: "s", id: "a") }
        await fulfillment(of: [started], timeout: 3)
        await model.disconnect(); configure(model)
        old.pendingAction?.resume(throwing: ClientFailure("Old connection closed")); old.pendingAction = nil
        await action.value
        XCTAssertNil(model.error)
        XCTAssertFalse(model.queueActionPending(sessionID: "s", id: "a"))
        XCTAssertTrue(next.queueActions.isEmpty)
    }

    @MainActor func testEditFailureIsRetryableAndCancelReleasesItsLease() async throws {
        let client = QueueModelClient()
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        let acquired = await model.beginQueuedMessageEdit(sessionID: "s", id: "a")
        let lease = try XCTUnwrap(acquired)
        let renewed = await model.renewQueuedMessageEdit(lease)
        XCTAssertTrue(renewed)
        client.failFinish = true
        let failed = await model.finishQueuedMessageEdit(lease, text: "Keep these edits")
        XCTAssertFalse(failed)
        XCTAssertNotNil(model.error)
        client.failFinish = false
        let saved = await model.finishQueuedMessageEdit(lease, text: "Keep these edits")
        XCTAssertTrue(saved)
        let acquiredSecond = await model.beginQueuedMessageEdit(sessionID: "s", id: "b")
        let second = try XCTUnwrap(acquiredSecond)
        await model.finishQueuedMessageEdit(second, text: nil)
        XCTAssertEqual(client.finishedText, ["Keep these edits", "Keep these edits", nil])
    }

    @MainActor func testEditAcquisitionAfterSessionChangeIsReleasedBeforeOpening() async {
        let client = QueueModelClient()
        client.suspendBegin = true
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        configure(model)
        let started = expectation(description: "Lease acquisition started")
        client.onStarted = { started.fulfill() }
        let opening = Task { await model.beginQueuedMessageEdit(sessionID: "s", id: "a") }
        await fulfillment(of: [started], timeout: 3)
        model.selectedSessionID = "other"
        client.pendingBegin?.resume(returning: client.lease(id: "a")); client.pendingBegin = nil
        let result = await opening.value
        XCTAssertNil(result)
        XCTAssertEqual(client.finishedText, [nil])
    }

    @MainActor func testOldEditSaveReplyCannotPublishIntoNewAccount() async throws {
        let old = QueueModelClient(), next = QueueModelClient()
        let model = AppModel(client: old, makeLiveClient: { next })
        configure(model)
        let acquired = await model.beginQueuedMessageEdit(sessionID: "s", id: "a")
        let lease = try XCTUnwrap(acquired)
        old.suspendFinish = true
        let started = expectation(description: "Old save started")
        old.onStarted = { started.fulfill() }
        let saving = Task { await model.finishQueuedMessageEdit(lease, text: "Old edits") }
        await fulfillment(of: [started], timeout: 3)
        await model.disconnect(); configure(model)
        old.pendingFinish?.resume(throwing: ClientFailure("Old host gone")); old.pendingFinish = nil
        let saved = await saving.value
        XCTAssertFalse(saved)
        XCTAssertNil(model.error)
        XCTAssertTrue(next.finishedText.isEmpty)
    }
}

final class ChangeCaptureTests: XCTestCase {
    @MainActor func testCompletionShowsPendingFilesBeforeHostReplyThenCapturedFiles() async throws {
        let client = QueueModelClient()
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        model.selectedSessionID = "s"
        client.suspendDiff = true
        let requested = expectation(description: "Captured turn diff requested")
        client.onStarted = { requested.fulfill() }
        let messages = [TranscriptMessage(id: "turn", role: "user", text: "Edit"),
                        TranscriptMessage(id: "answer", role: "assistant", text: "Done")]
        client.onUpdate?(.session(SessionState(id: "s", messages: messages, working: true, turnID: "turn")))
        XCTAssertTrue(model.pendingChangeMessageIDs.isEmpty)
        client.onUpdate?(.session(SessionState(id: "s", messages: messages, working: false, turnID: "turn")))
        XCTAssertEqual(model.pendingChangeMessageIDs, ["answer"])
        XCTAssertTrue(model.changesAfterMessage.isEmpty)
        await fulfillment(of: [requested], timeout: 3)
        client.pendingDiff?.resume(returning: TurnDiff(patch: "", paths: ["file.swift"], additions: 0, deletions: 0))
        client.pendingDiff = nil
        let published = expectation(description: "Captured files published")
        Task { @MainActor in
            for _ in 0..<200 {
                if model.changesAfterMessage["answer"] != nil { published.fulfill(); return }
                try? await Task.sleep(nanoseconds: 10_000_000)
            }
        }
        await fulfillment(of: [published], timeout: 3)
        XCTAssertTrue(model.pendingChangeMessageIDs.isEmpty)
        XCTAssertEqual(model.changesAfterMessage["answer"]?.files.map(\.path), ["file.swift"])
    }

    @MainActor func testUnavailableDiffRemovesPendingRowWithoutInventingChanges() async {
        let client = QueueModelClient()
        let model = AppModel(client: client, makeLiveClient: { QueueModelClient() })
        model.selectedSessionID = "s"
        client.suspendDiff = true
        let requested = expectation(description: "Diff requested")
        client.onStarted = { requested.fulfill() }
        client.onUpdate?(.session(SessionState(id: "s", messages: [TranscriptMessage(id: "turn", role: "user", text: "Read")], turnID: "turn")))
        XCTAssertEqual(model.pendingChangeMessageIDs, ["turn"])
        await fulfillment(of: [requested], timeout: 3)
        client.pendingDiff?.resume(throwing: ClientFailure("Unavailable"))
        client.pendingDiff = nil
        let cleared = expectation(description: "Pending row cleared")
        Task { @MainActor in
            for _ in 0..<200 {
                if model.pendingChangeMessageIDs.isEmpty { cleared.fulfill(); return }
                try? await Task.sleep(nanoseconds: 10_000_000)
            }
        }
        await fulfillment(of: [cleared], timeout: 3)
        XCTAssertTrue(model.changesAfterMessage.isEmpty)
        XCTAssertTrue(model.preferences.changes.isEmpty)
    }
}

@MainActor private final class QueueModelClient: ClientService {
    var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    let isDemo = false
    let accountKey: String? = nil
    var sentModes: [MessageSendMode] = []
    var sentFiles: [[LocalAttachment]] = []
    var queueActions: [String] = []
    var finishedText: [String?] = []
    var interrupts = 0
    var suspendSend = false, suspendAction = false, suspendBegin = false, suspendFinish = false, failFinish = false
    var pendingSend: CheckedContinuation<Void, Error>?
    var pendingAction: CheckedContinuation<Void, Error>?
    var pendingBegin: CheckedContinuation<QueuedMessageEdit, Error>?
    var pendingFinish: CheckedContinuation<Void, Error>?
    var suspendDiff = false
    var pendingDiff: CheckedContinuation<TurnDiff, Error>?
    var onStarted: (() -> Void)?
    func lease(id: String) -> QueuedMessageEdit {
        .init(id: id, sessionID: "s", leaseID: "lease-" + id, text: "Original", baseTextHash: "hash", expiresAtMilliseconds: 60_000)
    }
    func send(sessionID: String, text: String, attachments: [LocalAttachment], busy: MessageSendMode) async throws {
        sentModes.append(busy); sentFiles.append(attachments)
        if suspendSend { try await withCheckedThrowingContinuation { pendingSend = $0; onStarted?() } }
    }
    func sendQueuedNow(sessionID: String, id: String) async throws {
        queueActions.append("send:\(sessionID):\(id)")
        if suspendAction { try await withCheckedThrowingContinuation { pendingAction = $0; onStarted?() } }
    }
    func moveQueuedMessage(sessionID: String, id: String, delta: Int) async throws { queueActions.append("move:\(sessionID):\(id):\(delta)") }
    func deleteQueuedMessage(sessionID: String, id: String) async throws { queueActions.append("delete:\(sessionID):\(id)") }
    func beginQueuedMessageEdit(sessionID: String, id: String) async throws -> QueuedMessageEdit {
        if suspendBegin { return try await withCheckedThrowingContinuation { pendingBegin = $0; onStarted?() } }
        return lease(id: id)
    }
    func renewQueuedMessageEdit(_ edit: QueuedMessageEdit) async throws -> Bool { true }
    func finishQueuedMessageEdit(_ edit: QueuedMessageEdit, text: String?) async throws {
        finishedText.append(text)
        if suspendFinish { try await withCheckedThrowingContinuation { pendingFinish = $0; onStarted?() } }
        if failFinish { throw ClientFailure("Temporary failure") }
    }
    func restore() async throws {}
    func signOut() async throws {}
    func refresh() async throws {}
    func models(hostID: String) async throws -> [AgentModel] { [] }
    func authorizationURL(state: String) throws -> URL { throw ClientFailure("Unsupported") }
    func exchangeCode(_ code: String) async throws -> [Organization] { [] }
    func selectOrganization(_ id: String) async throws {}
    func openSession(_ id: String) async throws {}
    func closeSession(_ id: String) {}
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String { "new" }
    func send(sessionID: String, text: String) async throws {}
    func interrupt(sessionID: String) async throws { interrupts += 1 }
    func retryDelivery(sessionID: String) async throws {}
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws {}
    func setModel(sessionID: String, selection: ModelSelection) async throws {}
    func listFolders(hostID: String, path: String?) async throws -> FolderPage { throw ClientFailure("Unsupported") }
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String { "project" }
    func createRepository(hostID: String, name: String) async throws -> String { "project" }
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff {
        if suspendDiff { return try await withCheckedThrowingContinuation { pendingDiff = $0; onStarted?() } }
        throw ClientFailure("Unsupported")
    }
    func setForeground(_ foreground: Bool) {}
}
