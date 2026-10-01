import SwiftUI
import ZRemoteCore
import ZRemoteNative
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if os(iOS)
import UIKit
#endif

/* SKIP @bridge */
public struct ZRemoteRootView: View {
    // Skip's generated bridge accesses this view's state and environment storage.
    #if os(iOS)
    @State var model = AppModel(client: NativeClient(), makeLiveClient: { NativeClient() }, notifications: AppleSessionNotifications.shared)
    #else
    @State var model = AppModel(client: NativeClient(), makeLiveClient: { NativeClient() })
    #endif
    @Environment(\.scenePhase) var scenePhase
    public init() {}

    public var body: some View {
        GeometryReader { geometry in
            let tablet = isTablet(width: geometry.size.width)
            ZStack {
                Palette.background.ignoresSafeArea()
                if model.restoring {
                    ProgressView().tint(Palette.text)
                } else if model.signedIn {
                    workspace(tablet: tablet, size: geometry.size)
                } else {
                    SignInView(model: model)
                }
                if !tablet, model.sessionsVisible, model.route == nil {
                    ModalBackHandler { model.sessionsVisible = false }
                }
                if tablet, let route = model.route {
                    ModalBackHandler { model.route = nil }
                    Color.black.opacity(0.55).ignoresSafeArea()
                        .onTapGesture { model.route = nil }
                    secondary(route)
                        .frame(width: min(760, max(280, geometry.size.width - 48)), height: max(300, geometry.size.height * 0.84))
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Palette.line))
                        .shadow(color: .black.opacity(0.35), radius: 28, y: 12)
                        .accessibilityAddTraits(.isModal)
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }
            }
            .sheet(item: Binding(get: {
                guard !tablet, let route = model.route else { return nil }
                if case .settings = route { return nil }
                return route
            }, set: { value in
                // Dismissing a previous sheet must not clear a full-page Settings route.
                if case .settings? = model.route { return }
                model.route = value
            })) { route in
                secondary(route)
                    #if os(Android)
                    // Skip's native sheet currently supports one detent.
                    .presentationDetents([.large])
                    #else
                    .presentationDetents([.medium, .large])
                    .presentationBackground(Palette.background)
                    #endif
                    .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: Binding(get: {
                guard !tablet else { return false }
                if case .settings? = model.route { return true }
                return false
            }, set: { presented in
                if !presented, case .settings? = model.route { model.route = nil }
            })) {
                secondary(.settings)
            }
            .onAppear { model.usesSessionPanel = tablet }
            .onChange(of: tablet) { _, value in model.usesSessionPanel = value; model.sessionsVisible = value }
        }
        .preferredColorScheme(preferredColorScheme)
        .tint(Palette.text)
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in model.setForeground(phase == .active) }
        .alert("Something needs attention", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private func isTablet(width: CGFloat) -> Bool {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .pad
        #elseif os(Android)
        androidIsTablet()
        #else
        true
        #endif
    }

    private var preferredColorScheme: ColorScheme? {
        switch model.preferences.theme {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    @ViewBuilder private func workspace(tablet: Bool, size: CGSize) -> some View {
        if tablet {
            HStack(spacing: 0) {
                if model.sessionsVisible {
                    SessionListView(model: model)
                        .frame(width: min(310, size.width * 0.38))
                        .transition(.move(edge: .leading).combined(with: .opacity))
                    Rectangle().fill(Palette.line).frame(width: 1)
                }
                ConversationView(model: model)
            }
            .onAppear { model.sessionsVisible = true }
            .accessibilityHidden(model.route != nil)
        } else {
            PhoneSessionDrawer(isOpen: $model.sessionsVisible) {
                SessionListView(model: model)
            } content: {
                ConversationView(model: model)
            }
            .accessibilityHidden(model.route != nil)
        }
    }

    private func secondary(_ route: SecondaryRoute) -> some View {
        NavigationStack {
            Group {
                switch route {
                case .models: ModelPickerView(model: model)
                case .projects: ProjectPickerView(model: model)
                case .settings: SettingsView(model: model)
                case .pullRequest(let request):
                    PullRequestDetailView(request: model.sessionPullRequests.first(where: { $0.id == request.id }) ?? request)
                case .changes(let turn): ChangedFilesList(turn: turn)
                case .diff(let document): NativeDiffView(document: document).navigationTitle("Changes")
                }
            }
            .background(Palette.background)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { model.route = nil }
                        #if !os(Android)
                        .keyboardShortcut(.cancelAction)
                        #endif
                }
            }
            .toolbarBackground(Palette.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .preferredColorScheme(preferredColorScheme)
        .tint(Palette.text)
    }
}

/* SKIP @bridge */
public final class ZRemoteAppDelegate: Sendable {
    public static let shared = ZRemoteAppDelegate()
    public init() {}
    public func onInit() {}
    public func onLaunch() {}
    public func onResume() {}
    public func onPause() {}
    public func onStop() {}
    public func onDestroy() {}
    public func onLowMemory() { URLCache.shared.removeAllCachedResponses() }
}

#if SKIP
/* SKIP @bridge */
public func androidIsTablet() -> Bool {
    ProcessInfo.processInfo.androidContext.resources.configuration.smallestScreenWidthDp >= 600
}
#endif
