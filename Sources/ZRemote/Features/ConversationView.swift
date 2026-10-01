import SwiftUI
import ZRemoteCore

struct ConversationView: View {
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var inputFocused: Bool
    @State private var following = true
    @State private var userScrolling = false
    @State private var tailPosition: CGFloat = .infinity

    private var wallpaper: Bool {
        PresentationRules.showsBackground(enabled: model.preferences.backgroundEnabled, hasSession: model.selectedSessionID != nil, sessionsVisible: model.sessionsVisible, secondaryVisible: model.route != nil)
    }
    var body: some View {
        VStack(spacing: 0) {
            header
            if model.selectedSessionID == nil {
                Spacer(minLength: 20)
                VStack(spacing: 12) {
                    Text("What would you like to build?")
                        .font(.system(.largeTitle, design: .default, weight: .medium))
                        .multilineTextAlignment(.center)
                    Text(model.isDemo ? "A little space to try things out." : "Your agents. Your workspace. Wherever you are.")
                        .font(.subheadline).foregroundStyle(Palette.secondary)
                }.padding(.horizontal, 32)
                Spacer(minLength: 20)
                projectContext
            } else {
                transcript
            }
            if let input = model.state?.input {
                AgentQuestionView(input: input, sending: model.answering) { answers in
                    Task { await model.answer(requestID: input.id, answers: answers) }
                }.id(input.id)
            }
            if let status = model.state?.delivery, !status.isEmpty {
                HStack(spacing: 12) {
                    Text(status).font(.caption).foregroundStyle(Palette.secondary)
                    if model.state?.deliveryFailed == true {
                        Button("Retry") { Task { await model.retryDelivery() } }
                            .font(.caption.weight(.medium)).disabled(model.busy)
                    }
                }.padding(.bottom, 8)
            }
            composer
        }
        .background {
            ZStack {
                Palette.background
                if wallpaper {
                    // A native material treatment, with no image or generated artwork.
                    RadialGradient(colors: [Color(white: 0.28).opacity(0.45), .clear], center: .topTrailing, startRadius: 20, endRadius: 580)
                }
            }.ignoresSafeArea()
        }
        .foregroundStyle(Palette.text)
        .onChange(of: model.selectedSessionID) { _, _ in following = true; userScrolling = false }
        .onChange(of: model.sessionsVisible) { _, open in if open { inputFocused = false } }
        .onChange(of: model.route?.id) { _, route in if route != nil { inputFocused = false } }
    }

    private var header: some View {
        HStack(spacing: 14) {
            CircleControl(symbol: "line.3.horizontal", label: model.sessionsVisible ? "Hide sessions" : "Show sessions") {
                inputFocused = false
                withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.9)) { model.sessionsVisible.toggle() }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(model.session?.title ?? "New session").font(.headline).lineLimit(1)
                HStack(spacing: 6) {
                    if model.working { ActivityGlyph() }
                    Text(model.project?.name ?? (model.isDemo ? "Test mode" : "Zeron"))
                    if model.workspace.connection == .offline { Text("· Offline") }
                }.font(.caption).foregroundStyle(Palette.secondary)
            }
            Spacer(minLength: 0)
            if model.selectedSessionID != nil {
                CircleControl(symbol: "square.and.pencil", label: "New session") { model.newSession() }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    private var projectContext: some View {
        Button { model.route = .projects } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder")
                Text(model.project?.name ?? "Choose a project")
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
            }.font(.subheadline).foregroundStyle(Palette.secondary)
                .padding(.horizontal, 16).padding(.vertical, 12)
        }.buttonStyle(.plain)
    }

    private var transcript: some View {
        GeometryReader { viewport in
        ScrollViewReader { proxy in
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(spacing: 0) {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        ForEach(model.state?.messages ?? []) { message in
                            TranscriptRow(message: message).equatable()
                            if let turn = model.changesAfterMessage[message.id] {
                                ChangedFilesCard(turn: turn, openFile: { model.route = .diff($0.document) }, showAll: { model.route = .changes(turn) })
                            }
                        }
                        if model.working { ActivityGlyph().padding(.leading, 4) }
                        if let pr = model.session?.pullRequest { PullRequestCard(request: pr) }
                        #if os(Android)
                        // Skip resolves scroll IDs through its lazy item collector.
                        tailAnchor
                        #endif
                    }
                    #if !os(Android)
                    // Outside the lazy stack: actual viewport geometry, not row mounting,
                    // determines when a reader has returned to the live edge.
                    tailAnchor
                    #endif
                    }
                    .frame(maxWidth: 760, alignment: .leading)
                    .padding(.horizontal, 24).padding(.top, 18).padding(.bottom, 24)
                    .frame(maxWidth: .infinity)
                }
                .coordinateSpace(name: "transcript")
                .onPreferenceChange(TranscriptTailPosition.self) { position in
                    tailPosition = position ?? .infinity
                    guard let position else { return }
                    if !following, !userScrolling { following = position <= viewport.size.height + 64 }
                }
                .simultaneousGesture(DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        if abs(value.translation.height) > abs(value.translation.width) {
                            userScrolling = true
                            following = false
                        }
                    }
                    .onEnded { _ in
                        userScrolling = false
                        following = tailPosition <= viewport.size.height + 64
                    })
                .scrollDismissesKeyboard(.interactively)
                #if os(Android)
                .task(id: model.selectedSessionID) {
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    proxy.scrollTo("tail", anchor: .bottom)
                }
                #else
                .defaultScrollAnchor(.bottom)
                #endif
                .onChange(of: model.state?.messages.last?.text) { _, _ in
                    if following, !userScrolling { proxy.scrollTo("tail", anchor: .bottom) }
                }
                .onChange(of: model.state?.messages.count) { _, _ in
                    if following, !userScrolling { proxy.scrollTo("tail", anchor: .bottom) }
                }
                .onChange(of: model.changesAfterMessage) { _, _ in
                    if following, !userScrolling { proxy.scrollTo("tail", anchor: .bottom) }
                }
                if !following {
                    CircleControl(symbol: "arrow.down", label: "Jump to latest") {
                        following = true
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo("tail", anchor: .bottom) }
                    }.padding(18)
                }
            }
        }
        }
    }

    private var tailAnchor: some View {
        Color.clear.frame(height: 2)
            .background(GeometryReader { tail in
                Color.clear.preference(key: TranscriptTailPosition.self, value: Optional(tail.frame(in: .named("transcript")).maxY))
            })
            .id("tail")
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 13) {
            TextField("Message your agent", text: $model.draft, axis: .vertical)
                .lineLimit(8)
                .font(.body)
                .focused($inputFocused)
                .padding(.horizontal, 6)
                .accessibilityLabel("Message")
                .onSubmit { if model.canSend { Task { await model.send() } } }
            HStack(spacing: 10) {
                Button { model.route = .models } label: {
                    HStack(spacing: 7) {
                        Text(model.modelName).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2)
                    }.font(.subheadline).foregroundStyle(Palette.secondary)
                        .padding(.horizontal, 6).frame(minHeight: 44)
                }.buttonStyle(.plain).accessibilityLabel("Choose model, \(model.modelName)")
                Spacer(minLength: 0)
                Button {
                    Task { if model.working { await model.stop() } else { following = true; await model.send() } }
                } label: {
                    Group {
                        if model.busy { ProgressView().tint(Palette.background) }
                        else { Image(systemName: model.working ? "stop.fill" : "arrow.up").font(.system(size: 18, weight: .semibold)) }
                    }
                    .frame(width: 44, height: 44)
                    .foregroundStyle((model.canSend || model.working) ? Palette.background : Palette.secondary)
                    .background((model.canSend || model.working) ? Palette.text : Palette.raised, in: Circle())
                }
                .buttonStyle(.plain).disabled(!model.canSend && !model.working)
                .accessibilityLabel(model.working ? "Stop agent" : "Send message")
                .keyboardShortcut(.return, modifiers: [.command])
            }
        }
        .padding(14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28).strokeBorder(Palette.line))
        .frame(maxWidth: 700)
        .padding(.horizontal, 16).padding(.bottom, 12).padding(.top, 8)
        .frame(maxWidth: .infinity)
    }

}

private struct TranscriptTailPosition: PreferenceKey {
    static let defaultValue: CGFloat? = nil
    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) { value = nextValue() ?? value }
}

private struct AgentQuestionView: View {
    let input: InputRequest
    let sending: Bool
    let submit: ([String: [String]]) -> Void
    @State private var selected: [String: [String]] = [:]
    @State private var custom: [String: String] = [:]

    private var answers: [String: [String]] {
        Dictionary(uniqueKeysWithValues: input.questions.map { item in
            var values = selected[item.id] ?? []
            let text = (custom[item.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty, !values.contains(text) { values.append(text) }
            return (item.id, values)
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScrollView {
            VStack(alignment: .leading, spacing: 12) {
            ForEach(input.questions) { item in
                Text(item.title).font(.subheadline.weight(.medium))
                if !item.options.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(item.options, id: \.self) { option in
                                Button(option) {
                                    if item.multiple {
                                        var values = selected[item.id] ?? []
                                        if values.contains(option) { values.removeAll { $0 == option } }
                                        else { values.append(option) }
                                        selected[item.id] = values
                                    } else {
                                        selected[item.id] = [option]
                                        custom[item.id] = ""
                                    }
                                }
                                    .buttonStyle(.bordered)
                                    .tint((selected[item.id] ?? []).contains(option) ? Palette.text : Palette.secondary)
                                    .accessibilityValue((selected[item.id] ?? []).contains(option) ? "Selected" : "")
                            }
                        }
                    }
                }
                TextField("Your answer", text: Binding(get: { custom[item.id] ?? "" }, set: {
                    custom[item.id] = $0
                    if !item.multiple { selected[item.id] = [] }
                }))
                    .textFieldStyle(.roundedBorder)
            }
            }
            }
            Button(sending ? "Sending…" : "Send answer") { submit(answers) }
                .frame(minHeight: 44)
                .disabled(sending || input.questions.contains { (answers[$0.id] ?? []).isEmpty })
        }.disabled(sending)
            .padding(16)
            .frame(maxWidth: 700, maxHeight: 280)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20)).padding(.horizontal, 16)
    }
}

private struct TranscriptRow: View, Equatable {
    let message: TranscriptMessage
    var body: some View {
        HStack(alignment: .top) {
            if message.role == "user" { Spacer(minLength: 32) }
            SelectableText(message.text, markdown: !message.streaming)
            .font(message.role == "tool" ? .subheadline : .body)
            .lineSpacing(5)
            .foregroundStyle(message.role == "tool" ? Palette.secondary : Palette.text)
            .padding(message.role == "user" ? 15 : 0)
            .background(message.role == "user" ? Palette.surface : .clear, in: RoundedRectangle(cornerRadius: 22))
            .frame(maxWidth: .infinity, alignment: .leading)
            if message.role != "user" { Spacer(minLength: 0) }
        }
        #if !os(Android)
        .accessibilityElement(children: .combine)
        #endif
    }
}
