import SwiftUI
import Foundation
import ZRemoteCore

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var signingOut = false

    private var version: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        return build.map { "\(version) (\($0))" } ?? version
    }

    var body: some View {
        List {
            Section {
                Toggle("New composer background", isOn: Binding(
                    get: { model.preferences.backgroundEnabled },
                    set: { model.setBackground($0) }
                ))
                .tint(Palette.addition)
            } footer: {
                Text("Only appears when starting a new conversation.")
            }
            .listRowBackground(Palette.surface)

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
                Button {
                    guard !signingOut else { return }
                    signingOut = true
                    Task { await model.disconnect(); signingOut = false }
                } label: {
                    HStack {
                        Text(model.isDemo ? "Exit test mode" : "Sign out")
                        Spacer()
                        if signingOut { ProgressView() }
                    }
                    .foregroundStyle(Palette.text)
                }
                .disabled(signingOut)
            } footer: {
                if model.isDemo { Text("Test mode uses sample projects and sessions.") }
            }
            .listRowBackground(Palette.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Settings")
    }
}

private struct OpenSourceNotice: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let version: String
    let source: String
    let licenseFiles: [String]
}

private struct AcknowledgementsView: View {
    @State private var notices: [OpenSourceNotice] = []
    @State private var query = ""
    @State private var failed = false

    private var filtered: [OpenSourceNotice] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return search.isEmpty ? notices : notices.filter { $0.name.localizedCaseInsensitiveContains(search) }
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
        }
        .searchable(text: $query, prompt: "Search libraries")
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle("Acknowledgements")
        .task { await load() }
    }

    private func load() async {
        let result = await Task.detached(priority: .userInitiated) {
            let manifests = ["Acknowledgements", "SwiftAcknowledgements", "CargoAcknowledgements", "GradleAcknowledgements"]
            var entries: [String: OpenSourceNotice] = [:]
            var failed = false
            for name in manifests {
                guard let url = Bundle.module.url(forResource: name, withExtension: "json") else {
                    if name == "Acknowledgements" { failed = true }
                    continue
                }
                do {
                    let decoded = try JSONDecoder().decode([OpenSourceNotice].self, from: Data(contentsOf: url))
                    for notice in decoded { entries[notice.id] = notice }
                } catch { failed = true }
            }
            return (entries.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }, failed)
        }.value
        guard !Task.isCancelled else { return }
        notices = result.0
        failed = result.1
    }
}

private struct LicenseDetailView: View {
    let notice: OpenSourceNotice
    @State private var text = ""

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
