import Foundation
import XCTest
import ZRemoteCore

final class MessageQueueTests: XCTestCase {
    @MainActor
    func testAnsweringInputReleasesTheNextQueuedMessage() async throws {
        let client = DemoClient(intervalNanoseconds: 10_000_000_000)
        var state: SessionState?
        client.onUpdate = { if case .session(let value) = $0 { state = value } }
        try await client.restore()
        try await client.openSession("demo-question")
        try await client.send(sessionID: "demo-question", text: "Continue with these notes")
        let row = try XCTUnwrap(state?.queue.first)
        XCTAssertNotNil(state?.input)
        XCTAssertEqual(state?.working, false)
        try await client.respondInput(sessionID: "demo-question", requestID: "demo-input", answers: ["details": ["Spacing"]])
        XCTAssertNil(state?.input)
        XCTAssertEqual(state?.queue, [])
        XCTAssertEqual(state?.working, true)
        XCTAssertEqual(state?.messages.first(where: { $0.id == row.id })?.text, row.text)
        try await client.signOut()
    }

    @MainActor
    func testQueueSendNowSteersWithoutReplacingTheRunningTurn() async throws {
        let client = DemoClient(intervalNanoseconds: 10_000_000_000)
        var state: SessionState?
        client.onUpdate = { if case .session(let value) = $0 { state = value } }
        try await client.restore()
        try await client.openSession("demo-welcome")
        try await client.send(sessionID: "demo-welcome", text: "Start work")
        let turn = state?.turnID
        let replyID = state?.messages.last?.id
        try await client.send(sessionID: "demo-welcome", text: "Then add tests")
        let queued = try XCTUnwrap(state?.queue.first)
        XCTAssertFalse(state?.messages.contains(where: { $0.text == queued.text }) ?? true)
        try await client.sendQueuedNow(sessionID: "demo-welcome", id: queued.id)
        XCTAssertEqual(state?.turnID, turn)
        XCTAssertEqual(state?.working, true)
        XCTAssertEqual(state?.queue, [])
        XCTAssertEqual(state?.messages.last?.id, queued.id)
        XCTAssertEqual(state?.messages.first(where: { $0.id == replyID })?.streaming, true)
        XCTAssertEqual(state?.messages.first(where: { $0.id == replyID })?.subagents.first?.status, "running")
        try await client.interrupt(sessionID: "demo-welcome")
        XCTAssertEqual(state?.messages.first(where: { $0.id == replyID })?.streaming, false)
        XCTAssertNil(state?.messages.last?.workedDuration)
        XCTAssertEqual(state?.messages.last?.role, "user")
        try await client.signOut()
    }

    @MainActor
    func testQueueEditsAndMovesPreserveIdentityOrderAndFiles() async throws {
        let client = DemoClient(intervalNanoseconds: 10_000_000_000)
        var state: SessionState?
        client.onUpdate = { if case .session(let value) = $0 { state = value } }
        try await client.restore()
        try await client.openSession("demo-welcome")
        try await client.send(sessionID: "demo-welcome", text: "Start work")
        let turn = state?.turnID
        try await client.send(sessionID: "demo-welcome", text: "First queued")
        try await client.send(sessionID: "demo-welcome", text: "Review notes", attachments: [
            LocalAttachment(name: "notes.txt", mimeType: "text/plain", data: Data("notes".utf8))
        ])
        let original = try XCTUnwrap(state?.queue)
        try await client.moveQueuedMessage(sessionID: "demo-welcome", id: original[1].id, delta: -1)
        XCTAssertEqual(state?.queue.map(\.id), [original[1].id, original[0].id])
        let edit = try await client.beginQueuedMessageEdit(sessionID: "demo-welcome", id: original[1].id)
        XCTAssertTrue(edit.hasAttachments)
        XCTAssertEqual(state?.queue.first?.deliveryBlocked, true)
        do {
            try await client.moveQueuedMessage(sessionID: "demo-welcome", id: edit.id, delta: 1)
            XCTFail("A leased row must retain its position while editing")
        } catch {}
        XCTAssertEqual(state?.queue.map(\.id), [original[1].id, original[0].id])
        let renewed = try await client.renewQueuedMessageEdit(edit)
        XCTAssertTrue(renewed)
        try await client.finishQueuedMessageEdit(edit, text: "")
        XCTAssertEqual(state?.queue.first?.id, original[1].id)
        XCTAssertEqual(state?.queue.first?.text, "")
        XCTAssertEqual(state?.queue.first?.attachments, original[1].attachments)
        do {
            try await client.sendQueuedNow(sessionID: "demo-welcome", id: original[1].id)
            XCTFail("Files must never use interrupt-and-send")
        } catch {}
        XCTAssertEqual(state?.turnID, turn)
        XCTAssertEqual(state?.working, true)
        XCTAssertEqual(state?.queue.count, 2)
        let cancel = try await client.beginQueuedMessageEdit(sessionID: "demo-welcome", id: original[0].id)
        try await client.finishQueuedMessageEdit(cancel, text: nil)
        XCTAssertEqual(state?.queue.last?.text, original[0].text)
        XCTAssertEqual(state?.queue.last?.deliveryBlocked, false)
        try await client.deleteQueuedMessage(sessionID: "demo-welcome", id: original[0].id)
        XCTAssertEqual(state?.queue.map(\.id), [original[1].id])
        try await client.signOut()
    }

    @MainActor
    func testRelativeMoveUsesCurrentOrderAfterTheMenuWasOpened() async throws {
        let client = DemoClient(intervalNanoseconds: 10_000_000_000)
        var state: SessionState?
        client.onUpdate = { if case .session(let value) = $0 { state = value } }
        try await client.restore()
        try await client.openSession("demo-welcome")
        try await client.send(sessionID: "demo-welcome", text: "Start work")
        for text in ["First", "Second", "Third"] {
            try await client.send(sessionID: "demo-welcome", text: text)
        }
        let original = try XCTUnwrap(state?.queue)
        // Native menus retain their action while a different peer can reorder
        // the queue. Capture identity and direction, never the rendered index.
        let moveSecondUp = {
            try await client.moveQueuedMessage(sessionID: "demo-welcome", id: original[1].id, delta: -1)
        }
        try await client.moveQueuedMessage(sessionID: "demo-welcome", id: original[2].id, delta: -2)
        XCTAssertEqual(state?.queue.map(\.id), [original[2].id, original[0].id, original[1].id])
        try await moveSecondUp()
        XCTAssertEqual(state?.queue.map(\.id), [original[2].id, original[1].id, original[0].id])
        try await moveSecondUp()
        let atTop = state?.queue
        do {
            try await moveSecondUp()
            XCTFail("An already first message cannot move above the queue")
        } catch {}
        XCTAssertEqual(state?.queue, atTop)
        try await client.signOut()
    }

    @MainActor
    func testEditHoldsTheQueueAcrossCompletionAndCommitReleasesIt() async throws {
        let client = DemoClient(intervalNanoseconds: 1_000_000)
        var state: SessionState?
        client.onUpdate = { if case .session(let value) = $0 { state = value } }
        try await client.restore()
        try await client.openSession("demo-welcome")
        try await client.send(sessionID: "demo-welcome", text: "Start work")
        try await client.send(sessionID: "demo-welcome", text: "Change direction", attachments: [], busy: .steer)
        try await client.send(sessionID: "demo-welcome", text: "Edit before delivery")
        let row = try XCTUnwrap(state?.queue.first)
        let edit = try await client.beginQueuedMessageEdit(sessionID: "demo-welcome", id: row.id)
        let deadline = Date().addingTimeInterval(3)
        while state?.working == true && Date() < deadline { try await Task.sleep(nanoseconds: 5_000_000) }
        XCTAssertEqual(state?.working, false)
        XCTAssertFalse(state?.messages.contains(where: { $0.streaming }) ?? true)
        XCTAssertNil(state?.messages.last(where: { $0.role == "user" })?.workedDuration)
        XCTAssertEqual(state?.queue.map(\.id), [row.id])
        try await client.finishQueuedMessageEdit(edit, text: "Edited instruction")
        XCTAssertEqual(state?.queue, [])
        XCTAssertEqual(state?.working, true)
        XCTAssertEqual(state?.messages.first(where: { $0.id == row.id })?.text, "Edited instruction")
        try await client.signOut()
    }
}
