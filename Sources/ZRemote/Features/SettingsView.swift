import SwiftUI
import Foundation
import ZRemoteCore

struct SettingsView: View {
    @Bindable var model: AppModel
    @State var signingOut = false

    private var version: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        return build.map { "\(version) (\($0))" } ?? version
    }

    var body: some View {
        List {
            Section {
                Picker("Theme", selection: Binding(get: { model.preferences.theme }, set: model.setTheme)) {
                    Text("System").tag(AppTheme.system)
                    Text("Light").tag(AppTheme.light)
                    Text("Dark").tag(AppTheme.dark)
                }
                Toggle("Haptics", isOn: Binding(get: { model.preferences.hapticsEnabled }, set: model.setHapticsEnabled))
            }.listRowBackground(Palette.surface)
            BackgroundSettings(model: model)
            ConnectionSettings(model: model)
            NotificationSettings(model: model)

            Section {
                NavigationLink {
                    AcknowledgementsView()
                } label: {
                    Label("Acknowledgements", systemImage: "heart.text.square")
                }
                HStack {
                    Text("Version")
                    Spacer()
                    Text(version).foregroundStyle(Palette.secondary)
                }
            }
            .listRowBackground(Palette.surface)

            Section {
                Button(role: .destructive) {
                    guard !signingOut else { return }
                    signingOut = true
                    Task { await model.disconnect(); signingOut = false }
                } label: {
                    HStack {
                        Text("Sign out")
                        Spacer()
                        if signingOut { ProgressView() }
                    }
                    .foregroundStyle(Palette.deletion)
                }
                .disabled(signingOut)
            }
            .listRowBackground(Color.clear)
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Settings")
    }
}

struct OpenSourceNotice: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let version: String
    let source: String
    let licenseFiles: [String]
}

struct AcknowledgementsView: View {
    var showAll = false
    @State var notices: [OpenSourceNotice] = []
    @State var featuredIDs: Set<String> = []
    @State var query = ""
    @State var failed = false

    private var filtered: [OpenSourceNotice] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !search.isEmpty { return notices.filter { $0.name.localizedCaseInsensitiveContains(search) } }
        return showAll ? notices : notices.filter { featuredIDs.contains($0.id) }
    }

    var body: some View {
        List {
            Section {
                Text("Made possible by the open source community.")
                    .foregroundStyle(Palette.secondary)
            }
            .listRowBackground(Color.clear)

            if failed {
                Text("Some acknowledgements could not be loaded.")
                    .foregroundStyle(Palette.secondary)
                    .listRowBackground(Palette.surface)
            }
            ForEach(filtered) { notice in
                NavigationLink {
                    LicenseDetailView(notice: notice)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(notice.name).foregroundStyle(Palette.text)
                        Text(notice.version).font(.caption).foregroundStyle(Palette.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Palette.surface)
            }
            if !showAll, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                NavigationLink("Additional open-source licenses") { AcknowledgementsView(showAll: true) }
                    .listRowBackground(Palette.surface)
            }
        }
        .searchable(text: $query, prompt: "Search libraries")
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(showAll ? "Open-source licenses" : "Acknowledgements")
        .task { await load() }
    }

    private func load() async {
        let result = await Task.detached(priority: .userInitiated) {
            let manifests = ["Acknowledgements", "SwiftAcknowledgements", "CargoAcknowledgements", "GradleAcknowledgements"]
            var entries: [String: OpenSourceNotice] = [:]
            var featured: Set<String> = []
            var failed = false
            for name in manifests {
                guard let url = Bundle.module.url(forResource: name, withExtension: "json") else {
                    if name == "Acknowledgements" { failed = true }
                    continue
                }
                do {
                    let decoded = try JSONDecoder().decode([OpenSourceNotice].self, from: Data(contentsOf: url))
                    for notice in decoded { entries[notice.id] = notice }
                    if name == "Acknowledgements" {
                        // Build tooling and additional copies of the same project's
                        // source remain in the complete offline license inventory.
                        featured = Set(decoded.filter { $0.name != "skip" && !$0.id.hasPrefix("source:zeron-model-picker") }.map(\.id))
                    }
                } catch { failed = true }
            }
            return (entries.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }, failed, featured)
        }.value
        guard !Task.isCancelled else { return }
        notices = result.0
        failed = result.1
        featuredIDs = result.2
    }
}

struct LicenseDetailView: View {
    let notice: OpenSourceNotice
    @State var text = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(notice.version).font(.subheadline).foregroundStyle(Palette.secondary)
                if let url = URL(string: notice.source), url.scheme == "https" {
                    Link("Source code", destination: url).foregroundStyle(Palette.text)
                }
                SelectableText(text).font(.footnote).foregroundStyle(Palette.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20)
        }
        .background(Palette.background)
        .navigationTitle(notice.name)
        .task {
            let notice = notice
            let loaded = await Task.detached(priority: .userInitiated) {
                notice.licenseFiles.map { filename in
                    let file = filename as NSString
                    guard let url = Bundle.module.url(forResource: file.deletingPathExtension,
                                                      withExtension: file.pathExtension),
                          let contents = try? String(contentsOf: url, encoding: .utf8) else {
                        return "License text unavailable for \(notice.name)."
                    }
                    return contents
                }.joined(separator: "\n\n")
            }.value
            guard !Task.isCancelled else { return }
            text = loaded
        }
    }
}
