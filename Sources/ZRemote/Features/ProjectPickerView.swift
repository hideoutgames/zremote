import SwiftUI
import ZRemoteCore

struct ProjectPickerView: View {
    @Bindable var model: AppModel
    @State private var hostID = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @State private var mode = 0

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
        .onAppear {
            if hostID.isEmpty { hostID = model.selectedHostID }
        }
    }

    private var projects: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(model.workspace.projects) { project in
                    Button { model.selectProject(project) } label: {
                        HStack(spacing: 12) {
                            ProjectFolderIcon(knownProject: true)
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
            VStack(alignment: .leading, spacing: 18) {
                Picker("Computer", selection: $hostID) {
                    Text("Choose computer").tag("")
                    ForEach(model.workspace.hosts) { host in
                        Text(host.name + (host.online ? "" : " · Offline")).tag(host.id)
                    }
                }
                .disabled(busy)
                .onChange(of: hostID) { _, _ in error = nil }
                TextField("Project name", text: $name)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(14).background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                    .disabled(busy)
                PrimaryButton(title: busy ? "Creating…" : "Create project", symbol: "plus") {
                    createProject()
                }
                .disabled(!canCreate)
                .opacity(canCreate ? 1 : 0.45)
                NavigationLink {
                    ProjectFolderBrowser(model: model, hostID: hostID)
                } label: {
                    HStack(spacing: 10) {
                        ProjectFolderIcon()
                        Text("Choose existing folder").font(.body.weight(.medium))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    }
                    .padding(16)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy || !hostOnline)
                .opacity(hostOnline ? 1 : 0.45)
                if let error { Text(error).font(.caption).foregroundStyle(Palette.deletion) }
            }.padding(20)
        }
    }

    private var hostOnline: Bool { model.workspace.hosts.first { $0.id == hostID }?.online == true }
    private var canCreate: Bool { !busy && hostOnline && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func createProject() {
        guard canCreate else { return }
        let host = hostID
        let projectName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await model.createProject(hostID: host, name: projectName) }
            catch { self.error = "Couldn't create the project. Check that this computer is online." }
        }
    }
}

/// A native navigation destination inside the project drawer/modal. Folder
/// selection is separate from disclosure, so browsing never creates a project.
private struct ProjectFolderBrowser: View {
    @Bindable var model: AppModel
    let hostID: String
    @State private var page: FolderPage?
    @State private var path: String?
    @State private var selectedPath: String?
    @State private var foldersByPath: [String: RemoteFolder] = [:]
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?

    private var hostOnline: Bool { model.workspace.hosts.first { $0.id == hostID }?.online == true }
    private var selectedFolder: RemoteFolder? { selectedPath.flatMap { foldersByPath[$0] } }
    private var selectedProject: Project? {
        selectedPath.flatMap { ProjectFolderRules.project(at: $0, hostID: hostID, projects: model.workspace.projects) }
    }
    private var canChoose: Bool { (selectedFolder != nil || selectedProject != nil) && !busy && !loading && hostOnline }

    var body: some View {
        VStack(spacing: 0) {
            if let page {
                location(page)
                Rectangle().fill(Palette.line).frame(height: 0.5)
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(page.folders.filter(ProjectFolderRules.visible)) { folder in
                            folderRow(folder)
                        }
                        if page.folders.filter(ProjectFolderRules.visible).isEmpty {
                            Text("No subfolders").font(.subheadline).foregroundStyle(Palette.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 32)
                        }
                        if page.partial {
                            Text("More folders are available. Open a subfolder to continue.")
                                .font(.caption).foregroundStyle(Palette.secondary).padding(12)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
            } else if loading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Spacer(minLength: 0)
            }
            if let error {
                VStack(spacing: 10) {
                    Text(error).font(.subheadline).foregroundStyle(Palette.secondary)
                        .multilineTextAlignment(.center)
                    if page == nil {
                        Button("Try again") { Task { await loadFolders() } }
                            .disabled(loading || !hostOnline)
                    }
                }.padding(20)
            }
            selectionAction
        }
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Choose a folder")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: path ?? "") { await loadFolders() }
    }

    private func location(_ page: FolderPage) -> some View {
        HStack(spacing: 8) {
            if let parent = page.parent, ProjectFolderRules.visiblePath(parent) {
                Button { browse(parent) } label: {
                    Image(systemName: "arrow.up").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .disabled(busy || loading)
                .accessibilityLabel("Parent folder")
            }
            if foldersByPath[page.path] != nil || ProjectFolderRules.project(at: page.path, hostID: hostID, projects: model.workspace.projects) != nil {
                Button {
                    selectedPath = page.path
                    error = nil
                } label: {
                    currentLocation(page.path, selectable: true)
                }
                .buttonStyle(.plain)
                .disabled(busy || loading)
                .accessibilityLabel("Select current folder, \(page.path)")
                .accessibilityAddTraits(selectedPath == page.path ? .isSelected : [])
            } else {
                // A listing describes its children, not the current directory's
                // repository metadata. Unknown ancestors are display-only.
                currentLocation(page.path, selectable: false)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func currentLocation(_ path: String, selectable: Bool) -> some View {
        HStack(spacing: 10) {
            ProjectFolderIcon(knownProject: ProjectFolderRules.project(at: path, hostID: hostID, projects: model.workspace.projects) != nil)
            Text(path).font(.subheadline).lineLimit(1)
                #if !os(Android)
                .truncationMode(.middle)
                #endif
            Spacer(minLength: 0)
            if selectable {
                Image(systemName: selectedPath == path ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selectedPath == path ? Palette.text : Palette.secondary)
            }
        }
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }

    private func folderRow(_ folder: RemoteFolder) -> some View {
        let known = ProjectFolderRules.project(at: folder.path, hostID: hostID, projects: model.workspace.projects) != nil
        let selected = selectedPath == folder.path
        return HStack(spacing: 0) {
            Button { selectedPath = folder.path; error = nil } label: {
                HStack(spacing: 12) {
                    ProjectFolderIcon(knownProject: known)
                    Text(folder.name).font(.body).lineLimit(1)
                    Spacer(minLength: 4)
                    if selected { Image(systemName: "checkmark").font(.subheadline.weight(.semibold)) }
                }
                .padding(.leading, 14)
                .padding(.trailing, 8)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(known ? "\(folder.name), existing project" : folder.name)
            .accessibilityAddTraits(selected ? .isSelected : [])
            Button { browse(folder.path) } label: {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.secondary).frame(width: 44, height: 52)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(folder.name)")
        }
        .background(selected ? Palette.surface : .clear, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Palette.line : .clear))
        .disabled(busy || loading)
    }

    private var selectionAction: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Palette.line).frame(height: 0.5)
            PrimaryButton(title: busy ? "Creating…" : selectedProject == nil ? "Create project" : "Choose project") {
                chooseSelection()
            }
            .disabled(!canChoose)
            .opacity(canChoose ? 1 : 0.45)
            .padding(20)
        }
        .background(Palette.background)
    }

    private func browse(_ path: String) {
        guard !busy, ProjectFolderRules.visiblePath(path) else { return }
        selectedPath = nil
        page = nil
        error = nil
        self.path = path
    }

    private func chooseSelection() {
        guard canChoose else { return }
        if let project = selectedProject {
            model.selectProject(project)
            return
        }
        guard let folder = selectedFolder else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await model.addProject(hostID: hostID, folder: folder) }
            catch { self.error = "Couldn't create a project from this folder. Check that this computer is online." }
        }
    }

    private func loadFolders() async {
        guard !hostID.isEmpty else { return }
        let requestedPath = path
        loading = true
        error = nil
        defer { if !Task.isCancelled, requestedPath == path { loading = false } }
        do {
            let result = try await model.folders(hostID: hostID, path: requestedPath)
            guard !Task.isCancelled, requestedPath == path else { return }
            guard ProjectFolderRules.visiblePath(result.path) else {
                error = "This folder is unavailable."
                return
            }
            page = result
            for folder in result.folders where ProjectFolderRules.visible(folder) {
                foldersByPath[folder.path] = folder
            }
        } catch {
            if !Task.isCancelled, requestedPath == path {
                self.error = "Folders aren't available. Check that this computer is online."
            }
        }
    }
}

private struct ProjectFolderIcon: View {
    var knownProject = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            #if os(Android)
            ProjectFolderOutline().stroke(style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                .frame(width: 23, height: 19)
            #else
            Image(systemName: "folder").font(.system(size: 21))
            #endif
            if knownProject {
                Image(systemName: "gearshape.fill").font(.system(size: 10, weight: .semibold))
                    .padding(1.5).background(Palette.background, in: Circle())
                    .offset(x: 4, y: 3)
            }
        }
        .frame(width: 28, height: 25)
        .foregroundStyle(knownProject ? Color.purple : Palette.secondary)
        .accessibilityHidden(true)
    }
}

/// Skip's pinned symbol mapping has no folder glyph, so keep the Android
/// fallback as a small native path while retaining its native settings glyph.
private struct ProjectFolderOutline: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.height * 0.2))
        path.addLine(to: CGPoint(x: rect.width * 0.36, y: rect.height * 0.2))
        path.addLine(to: CGPoint(x: rect.width * 0.48, y: rect.height * 0.36))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.height * 0.36))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
