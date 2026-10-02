import Foundation
import SwiftUI
import ZRemoteCore

struct ArchivedSessionsView: View {
    @Bindable var model: AppModel
    @State var search = ""

    private var query: String {
        search.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var sessions: [Session] {
        model.workspace.sessions.filter {
            $0.archived && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query))
        }.sorted {
            if $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
            return $0.id < $1.id
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            searchBar
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            if sessions.isEmpty {
                EmptyState(symbol: query.isEmpty ? "archivebox" : "magnifyingglass",
                           title: query.isEmpty ? "No archived chats" : "No matching chats",
                           detail: query.isEmpty ? "Chats you archive in Zeron appear here." : "Try a different search.")
            } else {
                List {
                    ForEach(sessions) { session in
                        sessionRow(session)
                            .listRowBackground(Palette.surface)
                    }
                }
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Archived")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("archived-sessions")
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.secondary)
                .accessibilityHidden(true)
            TextField("Search archived chats", text: $search)
                .font(.subheadline)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("archived-search")
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Palette.secondary)
                        .frame(width: 36, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, search.isEmpty ? 16 : 4)
        .frame(height: 46)
        .background(Palette.raised, in: RoundedRectangle(cornerRadius: 16))
    }

    private func sessionRow(_ session: Session) -> some View {
        Button {
            model.route = nil
            Task { await model.open(session.id) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ProviderIcon(providerID: session.providerID, size: 18)
                    .padding(.top, 2)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.title)
                        .font(.body.weight(session.unread ? .medium : .regular))
                        .lineLimit(2)
                    if let project = model.workspace.projects.first(where: { $0.id == session.projectID }) {
                        Text(project.name)
                            .font(.caption)
                            .foregroundStyle(Palette.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.secondary)
                    .accessibilityHidden(true)
            }
            .multilineTextAlignment(.leading)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue("Archived")
    }
}
