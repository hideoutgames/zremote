import SwiftUI
import ZRemoteCore

/// One decision at a time, using the same surface and controls as the Composer.
/// Drafts live outside the per-question scroll identity, so Back never loses work.
struct AgentQuestionView: View {
    let input: InputRequest
    let providerID: String
    let sending: Bool
    let submitted: Bool
    let maximumHeight: CGFloat
    let dismissFocus: Int
    let reload: () -> Void
    let submit: @MainActor ([String: [String]]) async -> Bool
    @State var draft = QuestionAnswerDraft()
    @State var index = 0
    @State var submissionToken: UUID?
    @State var focusRequest: String?
    @State var focusDismissal = 0
    @State var contentHeight: CGFloat = 180
    @State var headerHeight: CGFloat = 22
    @State var footerHeight: CGFloat = 48
    @State var cardHeight: CGFloat = 320
    @FocusState var writingAnswer: Bool

    private var question: InputQuestion? {
        guard QuestionAnswerDraft.isValid(input), input.questions.indices.contains(index) else { return nil }
        return input.questions[index]
    }
    private var locked: Bool { sending || submissionToken != nil || submitted }
    private var lastQuestion: Bool { index == input.questions.count - 1 }
    private var ready: Bool {
        guard let question else { return false }
        return lastQuestion ? draft.answers(for: input) != nil : !draft.values(for: question).isEmpty
    }

    var body: some View {
        // The outer viewport lets the whole form scroll in unusually short
        // windows, without moving the editor to a new hierarchy as its keyboard opens.
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                header
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { headerHeight = $0 }
                if submitted {
                    // RespondInput acknowledges local queuing, not host execution.
                    // Keep this receipt until the peer resolves/replaces the request.
                    EmptyView()
                } else if let question {
                    ScrollView {
                        questionContent(question)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { if $0 > 0 { contentHeight = $0 } }
                    }
                    .frame(height: min(contentHeight, max(96, maximumHeight - headerHeight - footerHeight - 64)))
                    .scrollDismissesKeyboard(.interactively)
                    .disabled(locked)
                    footer
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { footerHeight = $0 }
                } else {
                    Text("This question couldn’t be loaded.").font(.subheadline).foregroundStyle(Palette.secondary)
                    PrimaryButton(title: "Refresh", action: reload)
                }
            }
            .padding(16)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { cardHeight = $0 }
        }
        .frame(height: min(cardHeight, max(0, maximumHeight)))
        .scrollDismissesKeyboard(.interactively)
        .foregroundStyle(Palette.text)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28).strokeBorder(Palette.line))
        .frame(maxWidth: 700)
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("agent-question")
        .id(question?.id ?? input.id)
        #if os(Android)
        .composeModifier { AndroidQuestionFocusModifier(dismissal: focusDismissal) }
        #endif
        .onChange(of: input) { old, current in
            let previousID = old.questions.indices.contains(index) ? old.questions[index].id : nil
            draft.reconcile(with: current)
            index = current.questions.firstIndex(where: { draft.values(for: $0).isEmpty })
                ?? current.questions.firstIndex(where: { $0.id == previousID }) ?? 0
            endEditing()
            submissionToken = nil
        }
        .onChange(of: dismissFocus) { _, _ in
            endEditing()
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            ProviderIcon(providerID: providerID, size: 18)
            Text(submitted ? "Answer queued" : "Your input").font(.subheadline.weight(.medium))
            Spacer(minLength: 8)
            if submitted {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.secondary).accessibilityHidden(true)
            } else if input.questions.count > 1 {
                Text("\(index + 1) of \(input.questions.count)")
                    .font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
                    .accessibilityLabel("Question \(index + 1) of \(input.questions.count)")
            }
        }
    }

    private func questionContent(_ question: InputQuestion) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(question.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            let options = QuestionAnswerDraft.options(for: question)
            if question.multiple, !options.isEmpty {
                Text("Select all that apply").font(.caption).foregroundStyle(Palette.secondary)
            }
            ForEach(options, id: \.self) { option in choice(option, question: question) }
            if options.isEmpty || draft.writingCustom.contains(question.id) {
                TextField("Your answer", text: Binding(
                    get: { draft.custom[question.id] ?? "" },
                    set: { draft.setCustom($0, for: question) }
                ), axis: .vertical)
                .font(.body).lineLimit(4).focused($writingAnswer)
                .textFieldStyle(.plain)
                .padding(14).frame(minHeight: 72, alignment: .topLeading)
                .background(Palette.raised, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(writingAnswer ? Palette.text.opacity(0.35) : Palette.line))
                .tint(Palette.text)
                .accessibilityLabel("Your answer to \(question.title)")
                .accessibilityIdentifier("agent-question-custom-answer")
                .task {
                    await Task.yield()
                    guard !Task.isCancelled, focusRequest == question.id else { return }
                    writingAnswer = true
                    focusRequest = nil
                }
            } else {
                Button {
                    draft.beginCustom(for: question)
                    focusRequest = question.id
                } label: {
                    Label("Write your own answer", systemImage: "square.and.pencil")
                        .font(.subheadline).foregroundStyle(Palette.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }

    private func choice(_ option: String, question: InputQuestion) -> some View {
        let selected = (draft.selected[question.id] ?? []).contains(option)
        return Button {
            endEditing()
            draft.select(option: option, for: question)
        } label: {
            HStack(spacing: 12) {
                Text(option).font(.subheadline).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: question.multiple
                      ? (selected ? "checkmark.square.fill" : "square")
                      : (selected ? "checkmark.circle.fill" : "circle"))
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(selected ? Palette.text : Palette.secondary)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14).padding(.vertical, 12).frame(minHeight: 48)
            .background(selected ? Palette.text.opacity(0.08) : Palette.raised,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? Palette.text.opacity(0.3) : Palette.line))
            .contentShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityValue(selected ? "Selected" : "Not selected")
    }

    private var footer: some View {
        HStack(spacing: 16) {
            if index > 0 {
                Button("Back") { move(to: index - 1) }
                    .font(.subheadline.weight(.medium)).buttonStyle(.plain)
                    .frame(minWidth: 52, minHeight: 48)
                    .disabled(locked)
            }
            PrimaryButton(title: sending || submissionToken != nil ? "Sending…" : lastQuestion ? "Send answer" : "Next",
                          symbol: lastQuestion && !locked ? "arrow.up" : nil, action: advance)
                .font(.subheadline)
                .disabled(locked || !ready)
                .opacity(locked || !ready ? 0.45 : 1)
                .accessibilityIdentifier("agent-question-continue")
        }
    }

    private func move(to next: Int) {
        guard !locked, input.questions.indices.contains(next) else { return }
        endEditing()
        index = next
    }

    private func endEditing() {
        writingAnswer = false
        focusRequest = nil
        focusDismissal += 1
    }

    private func advance() {
        guard !locked, ready else { return }
        if !lastQuestion { move(to: index + 1); return }
        guard let answers = draft.answers(for: input) else { return }
        endEditing()
        let token = UUID()
        submissionToken = token
        Task {
            _ = await submit(answers)
            if submissionToken == token { submissionToken = nil }
        }
    }
}
