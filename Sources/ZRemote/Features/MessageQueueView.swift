import SwiftUI
import ZRemoteCore

struct MessageQueueView: View {
    @Bindable var model: AppModel
    let sessionID: String
    @State private var edit: QueuedMessageEdit?
    @State private var editText = ""
    @State private var saving = false
    @State private var openingEdit = false
    @State private var leaseValid = true
    @State private var visible = false
    @FocusState private var editorFocused: Bool

    private var rows: [QueuedMessage] { model.queuedMessages(sessionID: sessionID) }
    private var capabilities: MessageQueueCapabilities { model.queueCapabilities(sessionID: sessionID) }

    var body: some View {
        Group {
            if let edit { editor(edit) }
            else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if rows.isEmpty {
                            Text("Nothing queued").foregroundStyle(Palette.secondary).padding(.vertical, 24)
                        }
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            queueRow(row, index: index)
                        }
                    }.padding(20)
                }
            }
        }
        .frame(maxWidth: 700).frame(maxWidth: .infinity)
        .foregroundStyle(Palette.text)
        .navigationTitle(edit == nil ? "Queue" : "Edit message")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { visible = true }
        .onDisappear {
            visible = false
            if let edit, !saving { Task { await model.finishQueuedMessageEdit(edit, text: nil) } }
        }
        .task(id: edit?.leaseID) {
            guard let lease = edit else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 20_000_000_000) }
                catch { return }
                guard !Task.isCancelled else { return }
                let renewed = await model.renewQueuedMessageEdit(lease)
                guard !Task.isCancelled, edit?.leaseID == lease.leaseID else { return }
                if !renewed { leaseValid = false; return }
            }
        }
    }

    private func queueRow(_ row: QueuedMessage, index: Int) -> some View {
        let pending = model.queueActionPending(sessionID: sessionID, id: row.id)
        let canSend = capabilities.canAct && capabilities.canSteer && row.attachments.isEmpty && !row.deliveryBlocked
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                if !row.text.isEmpty { Text(row.text).lineLimit(3) }
                if !row.attachments.isEmpty {
                    Text("\(row.attachments.count) files").font(.caption).foregroundStyle(Palette.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            ComposerActionButton(busy: pending, enabled: canSend, label: "Send now") {
                Task { await model.sendQueuedNow(sessionID: sessionID, id: row.id) }
            }
            .accessibilityHint("Adds this message to the current turn without stopping it.")
            Menu {
                Button { Task { await beginEdit(row) } } label: { Label("Edit", systemImage: "pencil") }
                    .disabled(!capabilities.canEdit || openingEdit)
                Button {
                    Task { await model.moveQueuedMessage(sessionID: sessionID, id: row.id, delta: -1) }
                } label: { Label("Move up", systemImage: "arrow.up") }
                    .disabled(!capabilities.canQueue || row.deliveryBlocked || index == 0)
                Button {
                    Task { await model.moveQueuedMessage(sessionID: sessionID, id: row.id, delta: 1) }
                } label: { Label("Move down", systemImage: "arrow.down") }
                    .disabled(!capabilities.canQueue || row.deliveryBlocked || index == rows.count - 1)
                Button(role: .destructive) {
                    Task { await model.deleteQueuedMessage(sessionID: sessionID, id: row.id) }
                } label: { Label("Delete", systemImage: "trash") }
                    .disabled(!capabilities.canAct)
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.text).frame(width: 44, height: 44).contentShape(Circle())
            }
            .disabled(pending).accessibilityLabel("Message actions")
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private func beginEdit(_ row: QueuedMessage) async {
        guard !openingEdit, edit == nil else { return }
        openingEdit = true
        defer { openingEdit = false }
        guard let lease = await model.beginQueuedMessageEdit(sessionID: sessionID, id: row.id) else { return }
        guard visible else { await model.finishQueuedMessageEdit(lease, text: nil); return }
        editText = lease.text; leaseValid = true; edit = lease; editorFocused = true
    }

    private func editor(_ lease: QueuedMessageEdit) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            TextEditor(text: $editText)
                .font(.body).focused($editorFocused).disabled(saving)
                .scrollContentBackground(.hidden)
                .accessibilityLabel("Queued message")
            if !leaseValid {
                Text("The edit expired. Copy your changes before closing.")
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
            HStack {
                Button("Cancel") {
                    editorFocused = false
                    Task { await model.finishQueuedMessageEdit(lease, text: nil); edit = nil }
                }.disabled(saving)
                Spacer()
                Button("Save") {
                    saving = true
                    Task {
                        let saved = await model.finishQueuedMessageEdit(lease, text: editText)
                        saving = false
                        if !visible && !saved { await model.finishQueuedMessageEdit(lease, text: nil) }
                        if saved { editorFocused = false; edit = nil }
                    }
                }
                .disabled(saving || !leaseValid || (editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !lease.hasAttachments))
            }.frame(minHeight: 44)
        }.padding(20)
    }
}
