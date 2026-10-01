import SwiftUI
import ZRemoteCore

struct ConversationView: View {
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var inputFocused = false
    @State private var inputComposing = false
    @State private var cursor = 0
    @State private var selectionRequest = 0
    @State private var suggestions: [ComposerCompletion] = []
    @State private var suggestionToken: ComposerToken?
    @State private var loadingSuggestions = false
    @State private var viewportHeight: CGFloat = 600
    @State private var following = true
    @State private var userScrolling = false
    @State private var tailPosition: CGFloat = .infinity
    @State private var headerHeight: CGFloat = 72
    @State private var statusHeight: CGFloat = 0
    @State private var dismissQuestionFocus = 0

    private var wallpaper: Bool {
        PresentationRules.showsBackground(enabled: model.preferences.backgroundEnabled, hasSession: model.selectedSessionID != nil, sessionsVisible: model.sessionsVisible, secondaryVisible: model.route != nil)
    }
    private var modelLabel: String {
        ModelPresentation.composerLabel(model: ModelPresentation.resolvedModel(in: model.catalog, selection: model.selection), selection: model.selection)
    }
    private var completionRequest: String {
        [model.selectedSessionID ?? "new", model.selectedHostID, model.selectedProjectID ?? "",
         model.selection.providerID, model.draft, String(cursor), String(inputFocused), String(inputComposing)].joined(separator: "\u{1F}")
    }
    private var completionUnavailableMessage: String? {
        guard !model.isDemo else { return nil }
        let host = model.session?.hostID ?? model.selectedHostID
        if host.isEmpty { return "Choose a project to see suggestions." }
        if model.workspace.connection != .online || model.workspace.hosts.first(where: { $0.id == host })?.online == false {
            return "Reconnect to your desktop to see suggestions."
        }
        if suggestionToken?.kind == .file && model.selectedSessionID == nil && model.selectedProjectID == nil {
            return "Choose a project to find files."
        }
        return nil
    }
    var body: some View {
        GeometryReader { geometry in
            layout(questionHeight: min(420, max(0, geometry.size.height - headerHeight - 20)))
                .onAppear { viewportHeight = geometry.size.height }
                .onChange(of: geometry.size.height) { _, height in viewportHeight = height }
        }
        .background {
            ZStack {
                Palette.background
                if wallpaper {
                    ComposerBackground(data: model.preferences.backgroundImageData,
                                       effect: model.preferences.backgroundEffect)
                }
            }.ignoresSafeArea()
        }
        .foregroundStyle(Palette.text)
        .onAppear { cursor = (model.draft as NSString).length; selectionRequest += 1 }
        .onChange(of: model.selectedSessionID) { _, _ in
            following = true; userScrolling = false
            cursor = (model.draft as NSString).length; selectionRequest += 1
            suggestions = []; suggestionToken = nil
        }
        .onChange(of: model.sessionsVisible) { _, open in
            if open { inputFocused = false; dismissQuestionFocus += 1 }
        }
        .onChange(of: model.state?.input) { _, input in if input != nil { inputFocused = false } }
        .onChange(of: model.route?.id) { _, route in
            if route != nil { inputFocused = false; dismissQuestionFocus += 1 }
        }
        .task(id: completionRequest) { await updateSuggestions() }
    }

    @ViewBuilder private func layout(questionHeight: CGFloat) -> some View {
        #if os(Android)
        // Skip's native ScrollView does not yet expose safeAreaInset or unclipped
        // scrolling. Retain native keyboard sizing on this platform.
        VStack(spacing: 0) {
            header
            content
            bottomChrome(questionHeight: questionHeight)
        }
        #elseif os(iOS)
        if #available(iOS 26.0, *) {
            content
                // Register the custom bar with the scroll view's real backdrop
                // effect. A material painted on top adds an unwanted color wash.
                .safeAreaBar(edge: .top, spacing: 0) { header }
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomChrome(questionHeight: questionHeight) }
                .scrollEdgeEffectStyle(.soft, for: .top)
                .scrollEdgeEffectHidden(true, for: .bottom)
        } else {
            insetLayout(questionHeight: questionHeight)
        }
        #else
        insetLayout(questionHeight: questionHeight)
        #endif
    }

    #if !os(Android)
    private func insetLayout(questionHeight: CGFloat) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                header.background {
                    ChromeFade(edge: .top).padding(.bottom, -24).ignoresSafeArea(edges: .top)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomChrome(questionHeight: questionHeight) }
    }
    #endif

    private var content: some View {
        VStack(spacing: 0) {
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
        }
    }

    private func bottomChrome(questionHeight: CGFloat) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                if let status = model.state?.delivery, !status.isEmpty {
                    HStack(spacing: 12) {
                        Text(status).font(.caption).foregroundStyle(Palette.secondary)
                        if model.state?.deliveryFailed == true {
                            Button("Retry") { Task { await model.retryDelivery() } }
                                .font(.caption.weight(.medium)).disabled(model.busy)
                        }
                    }.padding(.bottom, 8)
                }
                if let warning = model.usageWarning {
                    UsageLimitBanner(warning: warning, dismiss: model.dismissUsageWarning)
                        .frame(maxWidth: 700).padding(.horizontal, 16)
                }
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { statusHeight = $0 }
            if let input = model.state?.input, let sessionID = model.selectedSessionID {
                AgentQuestionView(input: input, providerID: model.state?.selection.providerID ?? model.selection.providerID,
                                  sending: model.answering, submitted: model.answerSubmitted,
                                  maximumHeight: max(0, questionHeight - statusHeight),
                                  dismissFocus: dismissQuestionFocus,
                                  reload: { Task { await model.refreshSessions() } }) { answers in
                    await model.answer(sessionID: sessionID, input: input, answers: answers)
                }.id([sessionID, input.id])
            } else {
                composer
            }
        }
        .background {
            ChromeFade(edge: .bottom).padding(.top, -40).ignoresSafeArea(edges: .bottom)
        }
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
            if let session = model.session {
                if !model.sessionPullRequests.isEmpty {
                    PullRequestMenu(requests: model.sessionPullRequests) { request in
                        inputFocused = false; model.route = .pullRequest(request)
                    }
                }
                Menu {
                    Button { Task { await model.setPinned(session, pinned: !session.pinned) } } label: {
                        Label(session.pinned ? "Unpin session" : "Pin session", systemImage: session.pinned ? "pin.slash" : "pin")
                    }
                    Button { NativeClipboard.copy(model.transcriptText) } label: {
                        Label("Copy transcript", systemImage: "doc.on.doc")
                    }.disabled(model.state?.messages.isEmpty != false)
                    Button { Task { await model.archive(session) } } label: {
                        Label("Archive session", systemImage: "archivebox")
                    }
                } label: { headerIcon("ellipsis") }
                    .accessibilityLabel("Session actions")
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { headerHeight = $0 }
    }

    private func headerIcon(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.system(size: 18, weight: .medium))
            .foregroundStyle(Palette.text).frame(width: 44, height: 44)
            .nativeGlassControl()
            .contentShape(Circle())
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
                            if !message.text.isEmpty { TranscriptRow(message: message).equatable() }
                            if !message.attachments.isEmpty, let sessionID = model.selectedSessionID {
                                MessageAttachments(attachments: message.attachments) {
                                    try await model.attachmentData(sessionID: sessionID, attachment: $0)
                                }
                            }
                            ForEach(message.subagents) { agent in
                                SessionEventCard(symbol: "person.2", title: agent.title,
                                                 subtitle: agent.detail.isEmpty ? agent.status.capitalized : "\(agent.status.capitalized) · \(agent.detail)",
                                                 active: agent.status == "running")
                            }
                            if let turn = model.changesAfterMessage[message.id] {
                                ChangedFilesCard(turn: turn, openFile: { model.route = .diff($0.document) }, showAll: { model.route = .changes(turn) })
                            }
                            ForEach(model.pullRequestsAfterMessage[message.id] ?? []) { request in
                                PullRequestCard(request: request) { model.route = .pullRequest(request) }
                            }
                        }
                        if model.working { ActivityGlyph().padding(.leading, 4) }
                        ForEach(model.unanchoredPullRequests) { request in
                            PullRequestCard(request: request) { model.route = .pullRequest(request) }
                        }
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
                #if !os(Android)
                .scrollClipDisabled()
                #endif
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
                .onChange(of: model.pullRequestsAfterMessage) { _, _ in
                    if following, !userScrolling { proxy.scrollTo("tail", anchor: .bottom) }
                }
                .onChange(of: model.unanchoredPullRequests) { _, _ in
                    if following, !userScrolling { proxy.scrollTo("tail", anchor: .bottom) }
                }
                .onChange(of: model.state?.messages.flatMap(\.subagents)) { _, _ in
                    if following, !userScrolling { proxy.scrollTo("tail", anchor: .bottom) }
                }
                .onChange(of: model.state?.messages.flatMap(\.attachments)) { _, _ in
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
            if inputFocused, !inputComposing, let token = ChatText.activeToken(in: model.draft, cursorUTF16: cursor) {
                ComposerSuggestions(kind: token.kind, items: ComposerCompletionPresentation.filter(suggestions, kind: token.kind, query: token.query),
                                    loading: loadingSuggestions, maximumHeight: viewportHeight * 0.3,
                                    unavailableMessage: completionUnavailableMessage, choose: insertSuggestion)
            }
            if !model.attachments.isEmpty {
                ComposerAttachments(attachments: model.attachments, remove: model.removeAttachment)
            }
            ComposerTextInput(text: $model.draft, cursor: $cursor, isFocused: $inputFocused,
                              isComposing: $inputComposing, selectionRequest: selectionRequest)
                .id(model.selectedSessionID ?? "new")
                .padding(.horizontal, 6)
            HStack(spacing: 10) {
                AttachmentPicker(model: model)
                Button { model.route = .models } label: {
                    HStack(spacing: 7) {
                        ProviderIcon(providerID: model.selection.providerID, size: 17)
                        Text(modelLabel).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2)
                    }.font(.subheadline).foregroundStyle(Palette.secondary)
                        .padding(.horizontal, 6).frame(minHeight: 44)
                }.buttonStyle(.plain).accessibilityLabel("Choose model, \(modelLabel)")
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
                #if !os(Android)
                .keyboardShortcut(.return, modifiers: [.command])
                #endif
            }
        }
        .padding(14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28).strokeBorder(Palette.line))
        .frame(maxWidth: 700)
        .padding(.horizontal, 16).padding(.bottom, 12).padding(.top, 8)
        .frame(maxWidth: .infinity)
    }

    private func updateSuggestions() async {
        suggestions = []
        guard inputFocused, !inputComposing, let token = ChatText.activeToken(in: model.draft, cursorUTF16: cursor) else {
            suggestionToken = nil; loadingSuggestions = false; return
        }
        suggestionToken = token
        loadingSuggestions = true
        try? await Task.sleep(nanoseconds: 180_000_000)
        guard !Task.isCancelled else { return }
        let values = await model.complete(kind: token.kind, query: token.query)
        guard !Task.isCancelled, ChatText.activeToken(in: model.draft, cursorUTF16: cursor) == token else { return }
        suggestions = ComposerCompletionPresentation.filter(values, kind: token.kind, query: token.query)
        loadingSuggestions = false
    }

    private func insertSuggestion(_ item: ComposerCompletion) {
        guard !inputComposing, let token = suggestionToken, token == ChatText.activeToken(in: model.draft, cursorUTF16: cursor),
              let next = ChatText.inserting(item.insertion, for: token, in: model.draft) else { return }
        model.draft = next.text
        cursor = next.cursorUTF16
        selectionRequest += 1
        suggestions = []; suggestionToken = nil
        inputFocused = true
    }

}

private struct UsageLimitBanner: View {
    let warning: UsageWarning
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 7) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).accessibilityHidden(true)
                Text("Usage limits approaching.").lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 4)
                Button("Dismiss", action: dismiss).fontWeight(.semibold)
                    .foregroundStyle(Palette.text).frame(minHeight: 44)
            }.font(.caption)
            HStack(spacing: 10) {
                UsageProgressBar(remaining: warning.remainingFraction)
                Text("\(warning.percentRemaining)%").font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Palette.secondary).accessibilityHidden(true)
            }
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.orange.opacity(0.2)))
    }
}

private struct TranscriptTailPosition: PreferenceKey {
    static let defaultValue: CGFloat? = nil
    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) { value = nextValue() ?? value }
}

private struct TranscriptRow: View, Equatable {
    let message: TranscriptMessage
    var body: some View {
        MessageContentView(message: message)
            .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
    }
}
