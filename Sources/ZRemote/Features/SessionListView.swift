import SwiftUI
import ZRemoteCore

struct SessionListView: View {
    @Bindable var model: AppModel
    @State private var search = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var filtered: [Session] {
        model.workspace.sessions.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("Sessions").font(.title2.weight(.semibold))
                Spacer()
                if model.isDemo { Text("Test mode").font(.caption).foregroundStyle(Palette.secondary) }
                CircleControl(symbol: "xmark", label: "Hide sessions") {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { model.sessionsVisible = false }
                }
            }.padding(.top, 16)
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                TextField("Search sessions", text: $search)
                    .autocorrectionDisabled()
            }
            .font(.subheadline)
            .foregroundStyle(Palette.secondary)
            .padding(12)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14))
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(model.workspace.projects) { project in
                        let rows = filtered.filter { $0.projectID == project.id }
                        if !rows.isEmpty {
                            Label(project.name, systemImage: "folder")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Palette.secondary)
                                .padding(.top, 12).padding(.horizontal, 10)
                            ForEach(rows) { session in sessionRow(session) }
                        }
                    }
                    let loose = filtered.filter { value in !model.workspace.projects.contains { $0.id == value.projectID } }
                    if !loose.isEmpty {
                        Text("Recent").font(.subheadline).foregroundStyle(Palette.secondary).padding(10)
                        ForEach(loose) { session in sessionRow(session) }
                    }
                    if filtered.isEmpty {
                        Text(search.isEmpty ? "Your sessions will appear here." : "No matching sessions.")
                            .font(.subheadline).foregroundStyle(Palette.secondary).padding(.vertical, 24)
                    }
                }
            }
            HStack {
                CircleControl(symbol: "slider.horizontal.3", label: "Settings") { model.route = .settings }
                Spacer()
                Button { model.newSession() } label: {
                    Label("New session", systemImage: "square.and.pencil")
                        .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 14)
                        .foregroundStyle(Palette.background).background(Palette.text, in: Capsule())
                }.buttonStyle(.plain)
            }.padding(.bottom, 12)
        }
        .padding(.horizontal, 16)
        .foregroundStyle(Palette.text)
        .background(Palette.background)
    }
    private func sessionRow(_ session: Session) -> some View {
        Button { Task { await model.open(session.id) } } label: {
            HStack(spacing: 10) {
                if session.working { ActivityGlyph() }
                else { Circle().fill(session.unread ? Palette.text : Palette.secondary.opacity(0.4)).frame(width: 5, height: 5) }
                Text(session.title).font(.body).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(model.selectedSessionID == session.id ? Palette.surface : .clear, in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityValue(session.working ? "Agent working" : session.unread ? "Unread" : "")
    }
}
