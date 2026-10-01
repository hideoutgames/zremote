import SwiftUI
import SkipAuthenticationServices
import ZRemoteCore

struct SignInView: View {
    @Bindable var model: AppModel
    @Environment(\.webAuthenticationSession) private var authentication
    @State private var authorizing = false
    @State private var selectingOrganization = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "square.stack.3d.up").font(.system(size: 38, weight: .ultraLight))
            Text("Zeron").font(.system(size: 38, weight: .medium))
            Text("A little closer to your work.")
                .font(.body).foregroundStyle(Palette.secondary)
            Spacer()
            if !model.organizations.isEmpty {
                Text("Choose your organization").font(.headline)
                ForEach(model.organizations) { organization in
                    PrimaryButton(title: organization.name) {
                        guard !selectingOrganization else { return }
                        selectingOrganization = true
                        Task {
                            await model.chooseOrganization(organization.id)
                            selectingOrganization = false
                        }
                    }.disabled(selectingOrganization || model.busy)
                }
                if selectingOrganization { ProgressView().tint(Palette.text) }
            } else {
                PrimaryButton(title: authorizing || model.busy ? "Signing in…" : "Sign in") {
                    Task { await signIn() }
                }.disabled(authorizing || model.busy)
                Button("Try test mode") { Task { await model.enterDemo() } }
                    .font(.subheadline).foregroundStyle(Palette.secondary)
                    .padding(.vertical, 10).disabled(authorizing || model.busy)
                Text("Test mode stays on this device.")
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
        }
        .frame(maxWidth: 380).padding(28).padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(Palette.text)
    }

    private func signIn() async {
        guard !authorizing else { return }
        authorizing = true
        defer { authorizing = false }
        let state = UUID().uuidString
        do {
            let url = try model.authorizeURL(state: state)
            let callback = try await authentication.authenticate(using: url, callbackURLScheme: "zeron", preferredBrowserSession: .shared)
            let code = try AuthenticationCallback.code(from: callback, expectedState: state)
            await model.signIn(code: code)
        } catch {
            if let cancelled = error as? ASWebAuthenticationSessionError, cancelled.code == .canceledLogin { return }
            model.error = "Sign-in didn't complete. Please try again."
        }
    }
}
