import Foundation
import SwiftUI
import ZRemoteCore

struct SessionDetailsView: View {
    @Bindable var model: AppModel
    let sessionID: String
    @State var editing = false
    @State var title = ""
    @State var saving = false
    @State var error: String?
    @State var renameContext: String?
    @State var focusDismissal = 0
    @FocusState var titleFocused: Bool

    private var session: Session? { model.workspace.sessions.first { $0.id == sessionID } }

    var body: some View {
        ScrollView {
            if let session {
                VStack(spacing: 28) {
                    heading(session)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Info").font(.subheadline.weight(.medium)).foregroundStyle(Palette.secondary)
                            .padding(.horizontal, 4)
                        VStack(spacing: 0) {
                            info("Project", value: projectName(session))
                            separator
                            info("Checkout", value: nonempty(session.branch) ?? "Unknown", detail: nonempty(session.path))
                            separator
                            modelInfo(session)
                            separator
                            info("Host", value: hostName(session))
                            separator
                            info("Created", value: dateLabel(session.createdAt))
                            separator
                            info("Updated", value: dateLabel(session.updatedAt))
                        }
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20))
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.line))
                    }
                }
                .frame(maxWidth: 660)
                .padding(24)
                .frame(maxWidth: .infinity)
            } else {
                EmptyState(symbol: "info.circle", title: "Session unavailable", detail: "This session is no longer available.")
                    .padding(24)
            }
        }
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if let session, !editing {
                    Button {
                        title = session.title
                        error = nil
                        renameContext = model.sessionDetailsContext(sessionID)
                        editing = true
                    } label: {
                        Image(systemName: "pencil").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Edit session title")
                    .accessibilityIdentifier("edit-session-title")
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        #if os(Android)
        .composeModifier { AndroidQuestionFocusModifier(dismissal: focusDismissal) }
        #endif
        .accessibilityIdentifier("session-details")
        .onChange(of: model.sessionDetailsContext(sessionID)) { _, current in
            if editing, renameContext != current {
                titleFocused = false
                focusDismissal += 1
                error = "This session changed. Close the editor and try again."
            }
        }
    }

    @ViewBuilder private func heading(_ session: Session) -> some View {
        if editing {
            VStack(spacing: 14) {
                TextField("Session title", text: $title, axis: .vertical)
                    .font(.title2.weight(.semibold)).lineLimit(3)
                    .multilineTextAlignment(.center)
                    .textFieldStyle(.plain).focused($titleFocused)
                    .padding(16)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.line))
                    .disabled(saving)
                    .accessibilityLabel("Session title")
                    .accessibilityIdentifier("session-title-editor")
                    .task {
                        await Task.yield()
                        if !Task.isCancelled, editing, !saving { titleFocused = true }
                    }
                if let error {
                    Text(error).font(.caption).foregroundStyle(Palette.deletion)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 16) {
                    Button("Cancel") { finishEditing() }
                        .font(.subheadline.weight(.medium)).buttonStyle(.plain)
                        .frame(minWidth: 60, minHeight: 48).disabled(saving)
                    PrimaryButton(title: saving ? "Saving…" : "Save", action: save)
                        .disabled(!canSave(session))
                        .opacity(canSave(session) ? 1 : 0.45)
                        .accessibilityIdentifier("save-session-title")
                }
            }
        } else {
            Text(nonempty(session.title) ?? "Untitled session")
                .font(.title.weight(.semibold)).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
                .padding(.vertical, 12)
        }
    }

    private var separator: some View { Rectangle().fill(Palette.line).frame(height: 0.5).padding(.horizontal, 16) }

    private func info(_ label: String, value: String, detail: String? = nil) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Text(label).font(.subheadline).foregroundStyle(Palette.secondary)
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                Text(value).font(.subheadline).multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail).font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Palette.secondary).multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(minHeight: 24).padding(16)
    }

    private func modelInfo(_ session: Session) -> some View {
        let selection = model.state?.id == sessionID ? model.state?.selection
            : ModelSelection(providerID: session.providerID, modelID: session.modelID)
        let providerID = selection?.providerID ?? session.providerID
        let current = selection.flatMap { value in
            model.state?.id == sessionID ? ModelPresentation.resolvedModel(in: model.catalog, selection: value) : nil
        }
        let name = selection.flatMap { value -> String? in
            guard nonempty(value.modelID) != nil else { return nil }
            return ModelPresentation.composerLabel(model: current, selection: value)
        } ?? "Unknown"
        return HStack(alignment: .top, spacing: 16) {
            Text("Model").font(.subheadline).foregroundStyle(Palette.secondary)
            Spacer(minLength: 4)
            HStack(alignment: .top, spacing: 7) {
                if !providerID.isEmpty { ProviderIcon(providerID: providerID, size: 16).padding(.top, 2) }
                Text(name).font(.subheadline).multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(minHeight: 24).padding(16)
    }

    private func projectName(_ session: Session) -> String {
        model.workspace.projects.first { $0.id == session.projectID && $0.hostID == session.hostID }
            .flatMap { nonempty($0.name) } ?? "Unknown"
    }

    private func hostName(_ session: Session) -> String {
        model.workspace.hosts.first { $0.id == session.hostID }.flatMap { nonempty($0.name) } ?? "Unknown"
    }

    private func dateLabel(_ date: Date) -> String {
        guard date.timeIntervalSince1970.isFinite, date.timeIntervalSince1970 > 0 else { return "Unknown" }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }

    private func nonempty(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }

    private func canSave(_ session: Session) -> Bool {
        !saving && renameContext == model.sessionDetailsContext(sessionID)
            && nonempty(title) != nil && title.trimmingCharacters(in: .whitespacesAndNewlines) != session.title
    }

    private func finishEditing() {
        titleFocused = false
        focusDismissal += 1
        editing = false
        error = nil
        renameContext = nil
    }

    private func save() {
        guard let session, let context = renameContext, canSave(session) else { return }
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        titleFocused = false
        focusDismissal += 1
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                try await model.renameSession(sessionID: sessionID, title: value, context: context)
                finishEditing()
            } catch {
                if !Task.isCancelled, !(error is CancellationError) {
                    self.error = "Couldn't rename this session. Please try again."
                }
            }
        }
    }
}
