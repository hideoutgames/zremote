import Foundation

/// Unsaved answers for one agent request. The UI owns navigation between its
/// questions; changing pages never discards a choice or an unfinished answer.
public struct QuestionAnswerDraft: Equatable, Sendable {
    public private(set) var selected: [String: [String]] = [:]
    public private(set) var custom: [String: String] = [:]
    public private(set) var writingCustom: Set<String> = []

    public init() {}

    public mutating func select(option: String, for question: InputQuestion) {
        guard !trim(question.id).isEmpty, Self.options(for: question).contains(option) else { return }
        var choices = validSelections(for: question)
        if question.multiple {
            if choices.contains(option) { choices.removeAll { $0 == option } }
            else { choices.append(option) }
        } else {
            choices = [option]
            custom[question.id] = nil
            writingCustom.remove(question.id)
        }
        selected[question.id] = choices.isEmpty ? nil : choices
    }

    public mutating func beginCustom(for question: InputQuestion) {
        guard !trim(question.id).isEmpty else { return }
        writingCustom.insert(question.id)
        if !question.multiple { selected[question.id] = nil }
    }

    public mutating func setCustom(_ text: String, for question: InputQuestion) {
        beginCustom(for: question)
        guard !trim(question.id).isEmpty else { return }
        custom[question.id] = text
    }

    public func values(for question: InputQuestion) -> [String] {
        let usesCustom = writingCustom.contains(question.id) || Self.options(for: question).isEmpty
        let text = trim(custom[question.id] ?? "")
        if !question.multiple, usesCustom { return text.isEmpty ? [] : [text] }
        var values = validSelections(for: question)
        if !question.multiple { return Array(values.prefix(1)) }
        if usesCustom, !text.isEmpty, !values.contains(where: { trim($0) == text }) { values.append(text) }
        return values
    }

    public func answers(for request: InputRequest) -> [String: [String]]? {
        guard Self.isValid(request) else { return nil }
        var result: [String: [String]] = [:]
        for question in request.questions { result[question.id] = values(for: question) }
        return Self.validAnswers(result, for: request) ? result : nil
    }

    /// Retain valid drafts when the peer updates questions under the same request
    /// ID. Ambiguous duplicate IDs cannot safely retain an attributed answer.
    public mutating func reconcile(with request: InputRequest) {
        var counts: [String: Int] = [:]
        for question in request.questions { counts[question.id, default: 0] += 1 }
        let validIDs = Set(counts.compactMap { id, count in count == 1 && !trim(id).isEmpty ? id : nil })
        selected = selected.filter { validIDs.contains($0.key) }
        custom = custom.filter { validIDs.contains($0.key) }
        writingCustom.formIntersection(validIDs)
        for question in request.questions where validIDs.contains(question.id) {
            var choices = validSelections(for: question)
            if !question.multiple {
                if writingCustom.contains(question.id) { choices = [] }
                else {
                    choices = Array(choices.prefix(1))
                    if !Self.options(for: question).isEmpty { custom[question.id] = nil }
                }
            }
            selected[question.id] = choices.isEmpty ? nil : choices
        }
    }

    public static func isValid(_ request: InputRequest) -> Bool {
        guard !trim(request.id).isEmpty, !request.questions.isEmpty else { return false }
        var ids: Set<String> = []
        return request.questions.allSatisfy { !trim($0.id).isEmpty && ids.insert($0.id).inserted }
    }

    /// Stable display choices preserve the original wire value. Blank labels
    /// and repeated labels are omitted rather than becoming duplicate UI IDs.
    public static func options(for question: InputQuestion) -> [String] {
        var labels: Set<String> = []
        return question.options.filter {
            let label = trim($0)
            return !label.isEmpty && labels.insert(label).inserted
        }
    }

    /// Custom text is allowed for every question; validate completeness and
    /// cardinality without incorrectly requiring answers to be listed options.
    public static func validAnswers(_ answers: [String: [String]], for request: InputRequest) -> Bool {
        guard isValid(request), Set(answers.keys) == Set(request.questions.map(\.id)) else { return false }
        return request.questions.allSatisfy { question in
            guard let values = answers[question.id], !values.isEmpty,
                  question.multiple || values.count == 1 else { return false }
            var distinct: Set<String> = []
            return values.allSatisfy {
                let value = trim($0)
                return !value.isEmpty && distinct.insert(value).inserted
            }
        }
    }

    private func validSelections(for question: InputQuestion) -> [String] {
        let options = Set(Self.options(for: question))
        var distinct: Set<String> = []
        return (selected[question.id] ?? []).filter { options.contains($0) && distinct.insert(trim($0)).inserted }
    }
}

private func trim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
