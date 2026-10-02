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
    @Environment(\.layoutDirection) var layoutDirection
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    public init() {}

    public var body: some View {
        GeometryReader { geometry in
            layout(in: geometry)
        }
        #if os(iOS)
        .background { NativeKeyboardDismiss() }
        #endif
        .preferredColorScheme(preferredColorScheme)
        #if os(Android)
        .composeModifier { AndroidHapticsModifier(enabled: model.preferences.hapticsEnabled) }
        #endif
        .tint(Palette.text)
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in model.setForeground(phase == .active) }
        .alert("Something needs attention", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private func layout(in geometry: GeometryProxy) -> some View {
        let tablet = isTablet(width: geometry.size.width)
        let frame = geometry.frame(in: .global)
        let insets = geometry.safeAreaInsets
        let leftInset = layoutDirection == .rightToLeft ? insets.trailing : insets.leading
        let sceneFrame = CGRect(x: frame.minX - leftInset, y: frame.minY - insets.top,
                                width: frame.width + insets.leading + insets.trailing,
                                height: frame.height + insets.top + insets.bottom)
        return ZStack {
            Palette.background.ignoresSafeArea()
            if model.restoring {
                ProgressView().tint(Palette.text)
            } else if model.signedIn {
                workspace(tablet: tablet, size: geometry.size, safeAreaInsets: insets)
                    .environment(\.composerSceneFrame, sceneFrame)
            } else {
                SignInView(model: model)
            }
            if !tablet, model.sessionsVisible, model.route == nil {
                ModalBackHandler { model.sessionsVisible = false }
            }
            if tablet {
                tabletModal(size: geometry.size)
            }
        }
        .sheet(item: phoneSheetRoute(tablet: tablet)) { route in
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
        .fullScreenCover(isPresented: phoneSettingsPresented(tablet: tablet)) {
            secondary(.settings)
        }
        .onAppear { model.usesSessionPanel = tablet }
        .onChange(of: tablet) { _, value in model.usesSessionPanel = value; model.sessionsVisible = value }
    }

    private func tabletModal(size: CGSize) -> some View {
        ZStack {
            if let route = model.route {
                ModalBackHandler { model.route = nil }
                Color.black.opacity(0.55).ignoresSafeArea()
                    .onTapGesture { model.route = nil }
                    .transition(.opacity)
                secondary(route)
                    .frame(width: min(760, max(280, size.width - 48)), height: max(300, size.height * 0.84))
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Palette.line))
                    .shadow(color: .black.opacity(0.35), radius: 28, y: 12)
                    .accessibilityAddTraits(.isModal)
                    .transition(reduceMotion ? .opacity : .offset(y: size.height).combined(with: .opacity))
                    .zIndex(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? .easeOut(duration: 0.16) : .spring(response: 0.42, dampingFraction: 0.92),
                   value: model.route != nil)
    }

    // Give the presentation overloads concrete types before composing the view.
    private func phoneSheetRoute(tablet: Bool) -> Binding<SecondaryRoute?> {
        Binding<SecondaryRoute?>(get: {
            guard !tablet, let route = model.route else { return nil }
            if case .settings = route { return nil }
            return route
        }, set: { value in
            // Dismissing a previous sheet must not clear a full-page Settings route.
            if case .settings? = model.route { return }
            model.route = value
        })
    }

    private func phoneSettingsPresented(tablet: Bool) -> Binding<Bool> {
        Binding<Bool>(get: {
            guard !tablet else { return false }
            if case .settings? = model.route { return true }
            return false
        }, set: { presented in
            if !presented, case .settings? = model.route { model.route = nil }
        })
    }

    private func isTablet(width: CGFloat) -> Bool {
        let capable: Bool
        #if os(iOS)
        capable = UIDevice.current.userInterfaceIdiom == .pad
        #elseif os(Android)
        capable = androidIsTablet()
        #else
        capable = true
        #endif
        return PresentationRules.usesSessionPanel(deviceSupportsPanel: capable,
                                                   availableWidth: Double(width))
    }

    private var preferredColorScheme: ColorScheme? {
        switch model.preferences.theme {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    @ViewBuilder private func workspace(tablet: Bool, size: CGSize, safeAreaInsets: EdgeInsets) -> some View {
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
            PhoneSessionDrawer(isOpen: $model.sessionsVisible, safeAreaInsets: safeAreaInsets,
                               gesturesEnabled: model.route == nil && model.error == nil) {
                SessionListView(model: model)
            } content: {
                ConversationView(model: model)
            }
            .accessibilityHidden(model.route != nil)
        }
    }

    private func secondary(_ route: SecondaryRoute) -> some View {
        let navigationBackground: Color
        #if os(iOS)
        if case .settings = route { navigationBackground = .clear }
        else { navigationBackground = Palette.background }
        #else
        navigationBackground = Palette.background
        #endif
        return NavigationStack {
            Group {
                switch route {
                case .models: ModelPickerView(model: model)
                case .projects: ProjectPickerView(model: model)
                case .sessionDetails(let sessionID): SessionDetailsView(model: model, sessionID: sessionID)
                case .queue(let sessionID): MessageQueueView(model: model, sessionID: sessionID)
                case .checkouts: CheckoutPickerView(model: model)
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
            .toolbarBackground(navigationBackground, for: .navigationBar)
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
