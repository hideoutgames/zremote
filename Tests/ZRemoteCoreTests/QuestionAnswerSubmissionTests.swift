import Foundation
import XCTest
import ZRemoteCore

final class QuestionAnswerSubmissionTests: XCTestCase {
    @MainActor
    func testRepliesRequireCurrentSessionAndCompleteCurrentQuestionSchema() async {
        let client = QuestionReplyClient()
        client.holdReplies = false
        let model = AppModel(client: client, makeLiveClient: { QuestionReplyClient() })
        await model.start()
        await model.open("first")
        let input = client.input

        let wrongSession = await model.answer(sessionID: "second", input: input, answers: ["choice": ["One"]])
        let missingAnswer = await model.answer(sessionID: "first", input: input, answers: [:])
        let blankAnswer = await model.answer(sessionID: "first", input: input, answers: ["choice": [" \n"]])
        let tooManyAnswers = await model.answer(sessionID: "first", input: input, answers: ["choice": ["One", "Two"]])
        XCTAssertFalse(wrongSession)
        XCTAssertFalse(missingAnswer)
        XCTAssertFalse(blankAnswer)
        XCTAssertFalse(tooManyAnswers)

        let replacement = InputRequest(id: input.id, questions: [InputQuestion(id: "replacement", title: "Updated question")])
        client.publish("first", input: replacement)
        let staleSchema = await model.answer(sessionID: "first", input: input, answers: ["choice": ["One"]])
        XCTAssertFalse(staleSchema)
        await model.open("second")
        let staleSession = await model.answer(sessionID: "first", input: input, answers: ["choice": ["One"]])
        XCTAssertFalse(staleSession)
        XCTAssertTrue(client.replies.isEmpty)
        XCTAssertFalse(model.answering)
        XCTAssertFalse(model.answerSubmitted)
        await model.disconnect()
    }

    @MainActor
    func testFailedRepliesCanRetryAndQueuedRepliesCannotBeSubmittedAgain() async {
        let client = QuestionReplyClient()
        let model = AppModel(client: client, makeLiveClient: { QuestionReplyClient() })
        await model.start()
        await model.open("first")
        let input = client.input
        let answers = ["choice": ["Use host defaults"]]
        let started = expectation(description: "First reply reaches the peer")
        client.onReplyStarted = { started.fulfill() }
        let first = Task { await model.answer(sessionID: "first", input: input, answers: answers) }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(model.answering)
        XCTAssertFalse(model.answerSubmitted)
        let overlapping = await model.answer(sessionID: "first", input: input, answers: answers)
        XCTAssertFalse(overlapping)
        XCTAssertEqual(client.replies.count, 1)

        client.finishReply(0, .failure(ClientFailure("Queue is unavailable")))
        let firstResult = await first.value
        XCTAssertFalse(firstResult)
        XCTAssertFalse(model.answering)
        XCTAssertFalse(model.answerSubmitted)
        XCTAssertEqual(model.error, "Couldn't send your answer. Please try again.")

        model.error = nil
        let retried = expectation(description: "Retry reaches the peer")
        client.onReplyStarted = { retried.fulfill() }
        let retry = Task { await model.answer(sessionID: "first", input: input, answers: answers) }
        await fulfillment(of: [retried], timeout: 3)
        XCTAssertEqual(client.replies[1].answers, answers)
        client.finishReply(1, .success(()))
        let retryResult = await retry.value
        XCTAssertTrue(retryResult)
        XCTAssertFalse(model.answering)
        XCTAssertTrue(model.answerSubmitted)
        let duplicate = await model.answer(sessionID: "first", input: input, answers: answers)
        XCTAssertFalse(duplicate)
        XCTAssertEqual(client.replies.count, 2)

        await model.open("second")
        XCTAssertFalse(model.answerSubmitted)
        await model.open("first")
        XCTAssertTrue(model.answerSubmitted)
        client.publish("first", input: input)
        XCTAssertTrue(model.answerSubmitted)
        client.publish("first", input: nil)
        XCTAssertFalse(model.answerSubmitted)
        client.publish("first", input: input)
        client.holdReplies = false
        client.resolveOnReply = true
        let resolvedImmediately = await model.answer(sessionID: "first", input: input, answers: answers)
        XCTAssertTrue(resolvedImmediately)
        XCTAssertNil(model.state?.input)
        XCTAssertFalse(model.answering)
        XCTAssertFalse(model.answerSubmitted)
        XCTAssertEqual(client.replies.count, 3)
        XCTAssertNil(model.error)
        await model.disconnect()
    }

    @MainActor
    func testLateRepliesCannotChangeAnotherSessionOrReplacementQuestion() async {
        let client = QuestionReplyClient()
        let model = AppModel(client: client, makeLiveClient: { QuestionReplyClient() })
        await model.start()
        await model.open("first")
        let input = client.input
        let started = expectation(description: "First session reply reaches the peer")
        client.onReplyStarted = { started.fulfill() }
        let first = Task { await model.answer(sessionID: "first", input: input, answers: ["choice": ["One"]]) }
        await fulfillment(of: [started], timeout: 3)

        await model.open("second")
        XCTAssertFalse(model.answering)
        let secondStarted = expectation(description: "Second session may answer its own question")
        client.onReplyStarted = { secondStarted.fulfill() }
        let second = Task { await model.answer(sessionID: "second", input: input, answers: ["choice": ["Two"]]) }
        await fulfillment(of: [secondStarted], timeout: 3)
        client.finishReply(0, .failure(ClientFailure("Late failure from first session")))
        let firstResult = await first.value
        XCTAssertFalse(firstResult)
        XCTAssertNil(model.error)
        XCTAssertTrue(model.answering)

        let replacement = InputRequest(id: input.id, questions: [InputQuestion(id: "replacement", title: "Updated question")])
        client.publish("second", input: replacement)
        XCTAssertFalse(model.answering)
        let replacementStarted = expectation(description: "Replacement schema may be answered")
        client.onReplyStarted = { replacementStarted.fulfill() }
        let latest = Task { await model.answer(sessionID: "second", input: replacement, answers: ["replacement": ["Updated answer"]]) }
        await fulfillment(of: [replacementStarted], timeout: 3)
        client.finishReply(1, .success(()))
        let secondResult = await second.value
        XCTAssertTrue(secondResult)
        XCTAssertTrue(model.answering)
        XCTAssertFalse(model.answerSubmitted)
        client.finishReply(2, .success(()))
        let latestResult = await latest.value
        XCTAssertTrue(latestResult)
        XCTAssertFalse(model.answering)
        XCTAssertTrue(model.answerSubmitted)
        XCTAssertEqual(client.replies.map(\.sessionID), ["first", "second", "second"])
        XCTAssertNil(model.error)
        await model.disconnect()
    }

    @MainActor
    func testAccountChangesIsolateLateRepliesWithIdenticalSessionAndRequestIDs() async {
        let lateResults: [Result<Void, Error>] = [.success(()), .failure(ClientFailure("Old account disconnected"))]
        for result in lateResults {
            let oldClient = QuestionReplyClient()
            let newClient = QuestionReplyClient()
            let model = AppModel(client: oldClient, makeLiveClient: { newClient })
            await model.start()
            await model.open("first")
            let input = oldClient.input
            let oldStarted = expectation(description: "Old account starts reply")
            oldClient.onReplyStarted = { oldStarted.fulfill() }
            let oldReply = Task { await model.answer(sessionID: "first", input: input, answers: ["choice": ["One"]]) }
            await fulfillment(of: [oldStarted], timeout: 3)
            await model.disconnect()
            await model.start()
            await model.open("first")
            XCTAssertFalse(model.answering)
            XCTAssertFalse(model.answerSubmitted)
            let newStarted = expectation(description: "New account starts its own reply")
            newClient.onReplyStarted = { newStarted.fulfill() }
            let newReply = Task { await model.answer(sessionID: "first", input: input, answers: ["choice": ["Two"]]) }
            await fulfillment(of: [newStarted], timeout: 3)

            oldClient.finishReply(0, result)
            let oldResult = await oldReply.value
            XCTAssertFalse(oldResult)
            XCTAssertTrue(model.answering)
            XCTAssertFalse(model.answerSubmitted)
            XCTAssertNil(model.error)
            newClient.finishReply(0, .success(()))
            let newResult = await newReply.value
            XCTAssertTrue(newResult)
            XCTAssertTrue(model.answerSubmitted)
            await model.disconnect()
        }
    }
}

@MainActor private final class QuestionReplyClient: ClientService {
    struct Reply {
        let sessionID: String
        let requestID: String
        let answers: [String: [String]]
    }
    var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    let isDemo = false
    let accountKey: String? = nil
    let input = InputRequest(id: "request", questions: [InputQuestion(id: "choice", title: "Choose a direction", options: ["One", "Two"])])
    var holdReplies = true
    var resolveOnReply = false
    var onReplyStarted: (() -> Void)?
    private(set) var replies: [Reply] = []
    private var pending: [Int: CheckedContinuation<Void, Error>] = [:]

    func restore() async throws {
        onUpdate?(.workspace(WorkspaceState(connection: .online, sessions: [
            Session(id: "first", title: "First session", hostID: "host"),
            Session(id: "second", title: "Second session", hostID: "host"),
        ])))
    }
    func publish(_ sessionID: String, input: InputRequest?) { onUpdate?(.session(SessionState(id: sessionID, input: input))) }
    func openSession(_ id: String) async throws { publish(id, input: input) }
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws {
        let index = replies.count
        replies.append(Reply(sessionID: sessionID, requestID: requestID, answers: answers))
        guard holdReplies else {
            if resolveOnReply { publish(sessionID, input: nil) }
            return
        }
        try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
            onReplyStarted?()
        }
    }
    func finishReply(_ index: Int, _ result: Result<Void, Error>) { pending.removeValue(forKey: index)?.resume(with: result) }
    func signOut() async throws {}
    func refresh() async throws {}
    func models(hostID: String) async throws -> [AgentModel] { [] }
    func authorizationURL(state: String) throws -> URL { throw ClientFailure("Unsupported") }
    func exchangeCode(_ code: String) async throws -> [Organization] { [] }
    func selectOrganization(_ id: String) async throws {}
    func closeSession(_ id: String) {}
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String { "new" }
    func send(sessionID: String, text: String) async throws {}
    func interrupt(sessionID: String) async throws {}
    func retryDelivery(sessionID: String) async throws {}
    func setModel(sessionID: String, selection: ModelSelection) async throws {}
    func listFolders(hostID: String, path: String?) async throws -> FolderPage { throw ClientFailure("Unsupported") }
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String { "project" }
    func createRepository(hostID: String, name: String) async throws -> String { "project" }
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff { throw ClientFailure("Unsupported") }
    func setForeground(_ foreground: Bool) {}
}
