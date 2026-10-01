import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
#endif

struct PullRequestMenu: View {
    let requests: [PullRequest]
    let select: @MainActor (PullRequest) -> Void
    @Environment(\.colorScheme) private var colorScheme

    @ViewBuilder var body: some View {
        #if os(iOS)
        NativeGlassMenu(content: PullRequestIcon(request: requests.last, size: 18), menu: nativeMenu,
                        accessibilityLabel: "Session pull requests", accessibilityValue: "", enabled: !requests.isEmpty, size: 44)
            .frame(width: 44, height: 44)
        #else
        standardMenu
        #endif
    }

    private var standardMenu: some View {
        Menu {
            ForEach(requests) { request in
                Button { select(request) } label: {
                    HStack {
                        PullRequestIcon(request: request, size: 18)
                        Text("#\(request.number) · \(request.title)")
                    }
                }
            }
        } label: {
            PullRequestIcon(request: requests.last, size: 18)
                .frame(width: 44, height: 44).nativeGlassControl()
        }
        .disabled(requests.isEmpty).accessibilityLabel("Session pull requests")
    }

    #if os(iOS)
    private var nativeMenu: UIMenu {
        let action = select
        return UIMenu(children: requests.map { request in
            UIAction(title: "#\(request.number) · \(request.title)", image: PullRequestIcon.menuImage(for: request, colorScheme: colorScheme)) { _ in
                Task { @MainActor in action(request) }
            }
        })
    }
    #endif
}

#if os(iOS)
@available(iOS 26.0, *)
struct NativeProfileMenu<Avatar: View>: View {
    let avatar: Avatar
    let name: String
    let signingOut: Bool
    let settings: @MainActor () -> Void
    let signOut: @MainActor () -> Void

    var body: some View {
        NativeGlassMenu(content: avatar.frame(width: 30, height: 30).clipShape(Circle()), menu: menu,
                        accessibilityLabel: "Account", accessibilityValue: name, enabled: true, size: 46)
    }

    private var menu: UIMenu {
        let showSettings = settings, disconnect = signOut
        return UIMenu(children: [
            UIAction(title: "Settings", image: UIImage(systemName: "gearshape")) { _ in
                Task { @MainActor in showSettings() }
            },
            UIAction(title: "Sign out", attributes: signingOut ? [.destructive, .disabled] : [.destructive]) { _ in
                Task { @MainActor in disconnect() }
            },
        ])
    }
}

/// Give UIKit ownership of both the glass control and its primary-action menu.
/// No SwiftUI button-style padding or separate glass overlay enlarges the source.
private struct NativeGlassMenu<Content: View>: UIViewRepresentable {
    let content: Content
    let menu: UIMenu
    let accessibilityLabel: String
    let accessibilityValue: String
    let enabled: Bool
    let size: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIButton {
        var configuration: UIButton.Configuration
        if #available(iOS 26.0, *) { configuration = .glass() }
        else {
            configuration = .filled()
            configuration.baseBackgroundColor = UIColor(Palette.surface)
        }
        configuration.cornerStyle = .capsule
        configuration.contentInsets = .zero
        let button = UIButton(configuration: configuration)
        button.showsMenuAsPrimaryAction = true
        button.tintColor = UIColor(Palette.text)
        let hosted = UIHostingConfiguration { content }.margins(.all, 0).makeContentView()
        hosted.isUserInteractionEnabled = false
        hosted.translatesAutoresizingMaskIntoConstraints = false
        button.addSubview(hosted)
        NSLayoutConstraint.activate([
            hosted.leadingAnchor.constraint(equalTo: button.leadingAnchor),
            hosted.trailingAnchor.constraint(equalTo: button.trailingAnchor),
            hosted.topAnchor.constraint(equalTo: button.topAnchor),
            hosted.bottomAnchor.constraint(equalTo: button.bottomAnchor),
        ])
        context.coordinator.contentView = hosted
        return button
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        CGSize(width: size, height: size)
    }

    func updateUIView(_ button: UIButton, context: Context) {
        button.menu = menu
        button.isEnabled = enabled
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityValue = accessibilityValue
        context.coordinator.contentView?.configuration = UIHostingConfiguration { content }.margins(.all, 0)
    }

    @MainActor final class Coordinator {
        var contentView: (UIView & UIContentView)?
    }
}
#endif
