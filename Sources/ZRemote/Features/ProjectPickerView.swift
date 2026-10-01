import SwiftUI
import ZRemoteCore

struct ProjectPickerView: View {
    @Bindable var model: AppModel
    @State private var hostID = ""
    @State private var name = ""
    @State private var page: FolderPage?
    @State private var path: String?
    @State private var busy = false
    @State private var error: String?
    @State private var mode = 0
    @State private var repositoryPaths: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            Picker("Project", selection: $mode) {
                Text("Projects").tag(0)
                Text("New project").tag(1)
            }.pickerStyle(.segmented).padding(16)
            if mode == 0 { projects }
            else { newProject }
        }
        .navigationTitle("Choose a project")
        .navigationBarTitleDisplayMode(.inline)
        .foregroundStyle(Palette.text)
        .onAppear { hostID = model.selectedHostID }
        .task(id: hostID + ":" + (path ?? "")) { await loadFolders() }
    }

    private var projects: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(model.workspace.projects) { project in
                    Button { model.selectProject(project) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "folder").foregroundStyle(Palette.secondary)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(project.name).font(.body)
                                Text(model.workspace.hosts.first { $0.id == project.hostID }?.name ?? "Remote computer")
                                    .font(.caption).foregroundStyle(Palette.secondary)
                            }
                            Spacer()
                            if model.selectedProjectID == project.id { Image(systemName: "checkmark") }
                        }.padding(16).background(Palette.surface, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain)
                }
                if model.workspace.projects.isEmpty {
                    EmptyState(symbol: "folder.badge.plus", title: "Your next project", detail: "Create a project on a connected computer or choose an existing folder.")
                    Button("New project") { mode = 1 }.padding()
                }
            }.padding(16)
        }
    }

    private var newProject: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Picker("Computer", selection: $hostID) {
                    Text("Choose computer").tag("")
                    ForEach(model.workspace.hosts) { host in
                        Text(host.name + (host.online ? "" : " · Offline")).tag(host.id)
                    }
                }
                .onChange(of: hostID) { _, _ in path = nil; page = nil; repositoryPaths = [] }
                TextField("Project name", text: $name)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(14).background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                PrimaryButton(title: busy ? "Creating…" : "Create project", symbol: "folder.badge.plus") {
                    Task {
                        busy = true
                        defer { busy = false }
                        do { try await model.createProject(hostID: hostID, name: name.trimmingCharacters(in: .whitespacesAndNewlines)) }
                        catch { self.error = "Couldn't create the project. \(error.localizedDescription)" }
                    }
                }
                .disabled(busy || !hostOnline || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Text("Created in Zeron’s projects folder on this computer.")
                    .font(.caption).foregroundStyle(Palette.secondary)
                Rectangle().fill(Palette.line).frame(height: 1)
                Text("Or choose an existing folder").font(.subheadline.weight(.medium))
                if let page {
                    HStack {
                        if let parent = page.parent {
                            Button { path = parent } label: { Image(systemName: "arrow.up").frame(width: 44, height: 44) }
                                .accessibilityLabel("Parent folder")
                        }
                        Text(page.path).font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
                            #if !os(Android)
                            .truncationMode(.middle)
                            #endif
                    }
                    Button("Use this folder") {
                        choose(RemoteFolder(name: "", path: page.path, isRepository: repositoryPaths.contains(page.path)))
                    }.disabled(busy || !hostOnline)
                    LazyVStack(spacing: 0) {
                        ForEach(page.folders.filter { $0.name.lowercased() != ".git" }) { folder in
                            Button { path = folder.path } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "folder").foregroundStyle(Palette.secondary)
                                    Text(folder.name).lineLimit(1)
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption)
                                }.padding(.vertical, 14).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                } else if !hostID.isEmpty && error == nil { ProgressView().frame(maxWidth: .infinity) }
                if page?.partial == true {
                    Text("This folder has more entries than the host can show. Choose a subfolder to continue.")
                        .font(.caption).foregroundStyle(Palette.secondary)
                }
                if let error { Text(error).font(.caption).foregroundStyle(Palette.deletion) }
            }.padding(20)
        }
    }
    private var hostOnline: Bool { model.workspace.hosts.first { $0.id == hostID }?.online == true }
    private func choose(_ folder: RemoteFolder) {
        Task {
            busy = true
            defer { busy = false }
            do { try await model.addProject(hostID: hostID, folder: folder) }
            catch { self.error = "Couldn't open this folder as a project." }
        }
    }
    private func loadFolders() async {
        guard !hostID.isEmpty else { return }
        let host = hostID
        let requestedPath = path
        error = nil
        do {
            let result = try await model.folders(hostID: host, path: requestedPath)
            guard !Task.isCancelled, host == hostID, requestedPath == path else { return }
            page = result
            repositoryPaths.formUnion(result.folders.filter(\.isRepository).map(\.path))
        } catch { if !Task.isCancelled { self.error = "Folders aren't available. Check that this computer is online." } }
    }
}
