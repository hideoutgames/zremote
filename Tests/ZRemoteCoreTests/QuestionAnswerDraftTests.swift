import XCTest
import ZRemoteCore

final class QuestionAnswerDraftTests: XCTestCase {
    func testEveryQuestionNeedsAnAnswerAndNavigationKeepsEarlierChoices() {
        let first = InputQuestion(id: "language", title: "Language?", options: ["Swift", "Kotlin"])
        let second = InputQuestion(id: "notes", title: "Details?")
        let request = InputRequest(id: "request", questions: [first, second])
        var draft = QuestionAnswerDraft()
        XCTAssertTrue(draft.values(for: first).isEmpty)
        XCTAssertNil(draft.answers(for: request))
        draft.select(option: "Swift", for: first)
        XCTAssertNil(draft.answers(for: request))
        draft.setCustom("Keep the original spacing", for: second)
        XCTAssertEqual(draft.answers(for: request), ["language": ["Swift"], "notes": ["Keep the original spacing"]])
        XCTAssertEqual(draft.values(for: first), ["Swift"])
    }

    func testSingleChoiceAndCustomAnswerAreMutuallyExclusive() {
        let question = InputQuestion(id: "layout", title: "Layout?", options: ["Compact", "Spacious"])
        var draft = QuestionAnswerDraft()
        draft.select(option: "Compact", for: question)
        draft.beginCustom(for: question)
        XCTAssertNil(draft.selected[question.id])
        XCTAssertTrue(draft.values(for: question).isEmpty)
        draft.setCustom("  Something between them\n", for: question)
        XCTAssertEqual(draft.values(for: question), ["Something between them"])
        draft.select(option: "Spacious", for: question)
        XCTAssertNil(draft.custom[question.id])
        XCTAssertFalse(draft.writingCustom.contains(question.id))
        XCTAssertEqual(draft.values(for: question), ["Spacious"])
        draft.select(option: "Compact", for: question)
        XCTAssertEqual(draft.values(for: question), ["Compact"])
    }

    func testMultipleChoiceTogglesIndependentlyAndKeepsCustomDraftWithoutDuplicates() {
        let question = InputQuestion(id: "focus", title: "Focus?", options: ["Spacing", "Typography", "Spacing", " \n"], multiple: true)
        XCTAssertEqual(QuestionAnswerDraft.options(for: question), ["Spacing", "Typography"])
        var draft = QuestionAnswerDraft()
        draft.select(option: "Spacing", for: question)
        draft.select(option: "Typography", for: question)
        draft.setCustom("  Motion\n", for: question)
        XCTAssertEqual(draft.values(for: question), ["Spacing", "Typography", "Motion"])
        draft.select(option: "Spacing", for: question)
        XCTAssertEqual(draft.custom[question.id], "  Motion\n")
        XCTAssertEqual(draft.values(for: question), ["Typography", "Motion"])
        draft.setCustom(" Typography ", for: question)
        XCTAssertEqual(draft.values(for: question), ["Typography"])
        draft.select(option: "Unavailable", for: question)
        XCTAssertEqual(draft.values(for: question), ["Typography"])
        draft.setCustom(" \n", for: question)
        XCTAssertEqual(draft.values(for: question), ["Typography"])
    }

    func testFreeformRejectsWhitespaceOnlyAndTrimsFinalAnswer() {
        let question = InputQuestion(id: "details", title: "Details?", options: [" \n"])
        let request = InputRequest(id: "request", questions: [question])
        var draft = QuestionAnswerDraft()
        draft.setCustom(" \n\t", for: question)
        XCTAssertNil(draft.answers(for: request))
        draft.setCustom("  First line\nSecond line  ", for: question)
        XCTAssertEqual(draft.answers(for: request), ["details": ["First line\nSecond line"]])
    }

    func testReconcileDropsRemovedQuestionsAndChoicesAndAppliesChangedCardinality() {
        let old = InputQuestion(id: "focus", title: "Focus?", options: ["Spacing", "Typography", "Motion"], multiple: true)
        let custom = InputQuestion(id: "custom", title: "Other?", options: ["Default"], multiple: true)
        let removed = InputQuestion(id: "removed", title: "Old question")
        var draft = QuestionAnswerDraft()
        for option in old.options { draft.select(option: option, for: old) }
        draft.select(option: "Default", for: custom)
        draft.setCustom("Keep this draft", for: custom)
        draft.setCustom("Old answer", for: removed)
        let updated = InputQuestion(id: "focus", title: "Choose one", options: ["Typography", "Motion"])
        let updatedCustom = InputQuestion(id: "custom", title: "Other?", options: ["Default"])
        let request = InputRequest(id: "request", questions: [updated, updatedCustom])
        draft.reconcile(with: request)
        XCTAssertEqual(draft.selected[updated.id], ["Typography"])
        XCTAssertNil(draft.selected[updatedCustom.id])
        XCTAssertNil(draft.custom[removed.id])
        XCTAssertFalse(draft.writingCustom.contains(removed.id))
        XCTAssertEqual(draft.answers(for: request), ["focus": ["Typography"], "custom": ["Keep this draft"]])
    }

    func testMalformedRequestsAndSubmissionPayloadsAreRejectedWithoutDuplicateKeyCrash() {
        let question = InputQuestion(id: "one", title: "Choose", options: ["A", "B"])
        let valid = InputRequest(id: "request", questions: [question])
        XCTAssertTrue(QuestionAnswerDraft.validAnswers(["one": ["A custom answer"]], for: valid))
        for answers in [[String: [String]](), ["other": ["A"]], ["one": []], ["one": [" \n"]],
                        ["one": ["A", "B"]], ["one": ["A"], "other": ["B"]]] {
            XCTAssertFalse(QuestionAnswerDraft.validAnswers(answers, for: valid))
        }
        let multiple = InputRequest(id: "request", questions: [InputQuestion(id: "one", title: "Choose", multiple: true)])
        XCTAssertFalse(QuestionAnswerDraft.validAnswers(["one": ["A", " A "]], for: multiple))
        let duplicate = InputRequest(id: "request", questions: [question, question])
        var draft = QuestionAnswerDraft()
        draft.select(option: "A", for: question)
        for request in [duplicate, InputRequest(id: "", questions: [question]), InputRequest(id: "request", questions: []),
                        InputRequest(id: "request", questions: [InputQuestion(id: " ", title: "Missing ID")])] {
            XCTAssertFalse(QuestionAnswerDraft.isValid(request))
            XCTAssertNil(draft.answers(for: request))
        }
        draft.reconcile(with: duplicate)
        XCTAssertTrue(draft.selected.isEmpty)
    }
}
