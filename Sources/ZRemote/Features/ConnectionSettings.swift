import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
#endif

struct ConnectionSettings: View {
    @Bindable var model: AppModel

    var body: some View {
        Section("Connected devices") {
            if model.workspace.devices.isEmpty {
                Text("Your connected devices will appear here.").foregroundStyle(Palette.secondary)
            }
            ForEach(model.workspace.devices) { device in
                HStack(spacing: 12) {
                    Image(systemName: device.isExecutionHost ? "desktopcomputer" : "iphone")
                        .foregroundStyle(Palette.secondary).frame(width: 24)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(device.name)
                        Text(device.isCurrent ? "This device" : device.online ? "Connected" : "Offline")
                            .font(.caption).foregroundStyle(Palette.secondary)
                    }
                    Spacer()
                }
            }
        }.listRowBackground(Palette.surface)
        Section {
            NavigationLink {
                AgentProviderSettings(model: model, showUsage: false)
            } label: { Label("Agent providers", systemImage: "cpu") }
            NavigationLink {
                AgentProviderSettings(model: model, showUsage: true)
            } label: { Label("Usage", systemImage: "chart.bar") }
        }.listRowBackground(Palette.surface)
    }
}

private struct AgentProviderSettings: View {
    @Bindable var model: AppModel
    let showUsage: Bool
    @State private var hostID = ""
    @State private var snapshot = AgentAccountsSnapshot(available: false)
    @State private var loading = false
    @State private var failed = false
    @State private var adding = false
    @State private var revision = 0

    private var selectedHost: String { hostID.isEmpty ? model.session?.hostID ?? model.selectedHostID : hostID }
    private var request: String { "\(selectedHost):\(revision)" }

    var body: some View {
        List {
            if model.workspace.hosts.count > 1 {
                Picker("Host", selection: Binding(get: { selectedHost }, set: { hostID = $0 })) {
                    ForEach(model.workspace.hosts) { host in Text(host.name).tag(host.id) }
                }.listRowBackground(Palette.surface)
            }
            if loading {
                HStack { ProgressView(); Text("Updating…").foregroundStyle(Palette.secondary) }
                    .listRowBackground(Palette.surface)
            } else if failed || !snapshot.available {
                Section {
                    Text(failed ? "Couldn't load agent accounts. Check that your host is connected." : "This host doesn't share agent accounts yet.")
                        .foregroundStyle(Palette.secondary)
                    Button("Try again") { revision += 1 }
                }.listRowBackground(Palette.surface)
            } else if snapshot.accounts.isEmpty {
                Text("No agent accounts are connected on this host.")
                    .foregroundStyle(Palette.secondary).listRowBackground(Palette.surface)
            }
            ForEach(snapshot.accounts) { account in
                Section {
                    HStack(spacing: 12) {
                        ProviderIcon(providerID: account.harness, size: 23)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(account.displayName ?? providerName(account.harness)).fontWeight(.medium)
                            if account.displayName != nil {
                                Text(providerName(account.harness)).font(.caption).foregroundStyle(Palette.secondary)
                            }
                            if let email = account.email { Text(email).font(.caption).foregroundStyle(Palette.secondary) }
                        }
                        Spacer()
                        if let plan = account.planLabel { Text(plan).font(.caption).foregroundStyle(Palette.secondary) }
                    }
                    if showUsage {
                        if account.usageError != nil || account.usageWindows.isEmpty {
                            Text("Usage unavailable").font(.subheadline).foregroundStyle(Palette.secondary)
                        } else {
                            ForEach(Array(account.usageWindows.enumerated()), id: \.offset) { _, window in
                                if let remaining = window.remainingFraction {
                                    VStack(alignment: .leading, spacing: 10) {
                                        HStack {
                                            Text(window.label)
                                            Spacer()
                                            Text("\(Int((remaining * 100).rounded()))% left").font(.system(.caption, design: .monospaced))
                                        }.font(.caption).foregroundStyle(Palette.secondary)
                                        UsageProgressBar(remaining: remaining)
                                    }.padding(.vertical, 4)
                                }
                            }
                        }
                    } else {
                        Text(account.active ? "Active account" : "Connected account").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }.listRowBackground(Palette.surface)
            }
            if !showUsage {
                Section {
                    Button { adding = true } label: { Label("Add agent", systemImage: "plus") }
                }.listRowBackground(Palette.surface)
            }
        }
        .scrollContentBackground(.hidden).background(Palette.background)
        .navigationTitle(showUsage ? "Usage" : "Agent providers")
        .refreshable { revision += 1 }
        .task(id: request) {
            snapshot = AgentAccountsSnapshot(available: false); failed = false; loading = true
            defer { if !Task.isCancelled { loading = false } }
            do {
                let result = try await model.fetchAgentAccounts(hostID: selectedHost)
                guard !Task.isCancelled else { return }
                snapshot = result
            } catch { if !Task.isCancelled { failed = true } }
        }
        .alert("Add an agent", isPresented: $adding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Open Zeron on \(model.workspace.hosts.first(where: { $0.id == selectedHost })?.name ?? "your host"), then connect an account in Agent Accounts. Return here and refresh to see it.")
        }
    }

    private func providerName(_ id: String) -> String {
        switch id {
        case "claude-code": "Claude Code"
        case "codex": "Codex"
        case "cursor": "Cursor"
        case "opencode": "OpenCode"
        default: id.capitalized
        }
    }
}

struct NotificationSettings: View {
    @Bindable var model: AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            Toggle("Notifications", isOn: preference(\.enabled)).disabled(!model.notificationsSupported)
            if model.preferences.notifications.enabled {
                Toggle("Agent asks a question", isOn: preference(\.questions))
                Toggle("Agent finishes working", isOn: preference(\.finished))
                Toggle("Usage limits approaching", isOn: preference(\.usageLimits))
            }
            if model.notificationAuthorization == .denied {
                #if os(iOS)
                Button("Open notification settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
                #endif
                Text("Allow notifications in your device settings.").font(.caption).foregroundStyle(Palette.secondary)
            }
            if let error = model.notificationError {
                Text(error).font(.caption).foregroundStyle(Palette.secondary)
                Button("Try again") { model.syncNotifications() }
            }
        } header: {
            Text("Notifications")
        }
        .tint(Palette.addition).listRowBackground(Palette.surface)
    }

    private func preference(_ key: WritableKeyPath<NotificationPreferences, Bool>) -> Binding<Bool> {
        Binding(get: { model.preferences.notifications[keyPath: key] }, set: { value in
            var next = model.preferences.notifications
            next[keyPath: key] = value
            model.setNotifications(next)
        })
    }
}
